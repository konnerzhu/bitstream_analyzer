/*
 * BitScope H.264 decoder inspection hooks.
 *
 * This file is part of FFmpeg.
 *
 * FFmpeg is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2.1 of the License, or (at your option) any later version.
 *
 * FFmpeg is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 */
#include "bitscope_h264_inspection.h"
#include "bitscope_h264_inspection_internal.h"

#include "libavutil/buffer.h"
#include "libavutil/intreadwrite.h"
#include "libavutil/mem.h"

#include "h264dec.h"

#include <stdatomic.h>

static atomic_uint_fast64_t next_picture_id = 1;

static AVFrame *inspection_frame(const H264Context *h)
{
    return h->cur_pic_ptr ? h->cur_pic_ptr->f : h->cur_pic.f;
}

static void inspection_free(void *opaque, uint8_t *data)
{
    AVH264Inspection *inspection = (AVH264Inspection *)data;
    int plane;
    (void)opaque;
    if (!inspection)
        return;
    for (plane = 0; plane < 4; plane++) {
        av_freep(&inspection->predicted_planes[plane].data);
        av_freep(&inspection->residual_planes[plane].data);
        av_freep(&inspection->pre_filter_planes[plane].data);
    }
    av_freep(&inspection->transform_blocks);
    av_freep(&inspection->coefficients);
    av_freep(&inspection->slices);
    av_freep(&inspection->references);
    av_freep(&inspection->modifications);
    av_freep(&inspection->dpb_entries);
    av_free(inspection);
}

static int reserve_array(void **array, uint32_t *capacity, uint32_t needed,
                         uint32_t hard_limit, size_t element_size)
{
    uint32_t grown;
    void *replacement;

    if (needed > hard_limit)
        return AVERROR(E2BIG);
    if (needed <= *capacity)
        return 0;
    grown = *capacity ? *capacity : FFMIN(needed, 64u);
    while (grown < needed) {
        const uint32_t increment = FFMAX(grown / 2, 1u);
        if (increment > hard_limit - grown) {
            grown = hard_limit;
            break;
        }
        grown += increment;
    }
    replacement = av_realloc_array(*array, grown, element_size);
    if (!replacement)
        return AVERROR(ENOMEM);
    *array = replacement;
    *capacity = grown;
    return 0;
}

static int allocate_plane(AVH264InspectionPlane *plane, uint32_t width,
                          uint32_t height, unsigned int bytes_per_sample)
{
    size_t stride;
    size_t size;
    if (av_size_mult(width, bytes_per_sample, &stride) < 0 ||
        av_size_mult(stride, height, &size) < 0 || stride > PTRDIFF_MAX)
        return AVERROR(EINVAL);
    plane->data = av_mallocz(size);
    if (!plane->data)
        return AVERROR(ENOMEM);
    plane->stride = (ptrdiff_t)stride;
    plane->width = width;
    plane->height = height;
    return 0;
}

static int allocate_residual_plane(AVH264InspectionResidualPlane *plane,
                                   uint32_t width, uint32_t height)
{
    size_t samples;
    if (av_size_mult(width, height, &samples) < 0)
        return AVERROR(EINVAL);
    plane->data = av_calloc(samples, sizeof(*plane->data));
    if (!plane->data)
        return AVERROR(ENOMEM);
    plane->stride_samples = width;
    plane->width = width;
    plane->height = height;
    return 0;
}

static AVH264Inspection *inspection_for(const H264Context *h)
{
    AVFrame *frame = inspection_frame(h);
    AVFrameSideData *side_data;
    AVBufferRef *buffer;
    AVH264Inspection *inspection;
    const unsigned int bytes_per_sample = 1u << h->pixel_shift;
    const uint32_t requested = h->bitscope_inspection_stages;
    int plane;

    if (!requested || !frame)
        return NULL;
    side_data = av_frame_get_side_data(frame, AV_FRAME_DATA_BITSCOPE_H264_INSPECTION);
    if (side_data)
        return side_data->size >= sizeof(*inspection) ?
            (AVH264Inspection *)side_data->data : NULL;

    inspection = av_mallocz(sizeof(*inspection));
    if (!inspection)
        return NULL;
    inspection->struct_size = sizeof(*inspection);
    inspection->version = AV_H264_INSPECTION_VERSION;
    inspection->available_stages = requested;
    inspection->bit_depth = h->ps.sps->bit_depth_luma;
    inspection->pixel_shift = h->pixel_shift;
    inspection->plane_count = h->ps.sps->chroma_format_idc ? 3 : 1;
    inspection->picture_id = atomic_fetch_add_explicit(&next_picture_id, 1,
                                                        memory_order_relaxed);
    if (!inspection->picture_id)
        inspection->picture_id = atomic_fetch_add_explicit(&next_picture_id, 1,
                                                            memory_order_relaxed);
    if (h->cur_pic_ptr) {
        inspection->frame_num = h->cur_pic_ptr->frame_num;
        inspection->poc = h->cur_pic_ptr->poc;
        inspection->field_poc[0] = h->cur_pic_ptr->field_poc[0];
        inspection->field_poc[1] = h->cur_pic_ptr->field_poc[1];
    }

    for (plane = 0; plane < inspection->plane_count; plane++) {
        const unsigned int x_shift = plane ? h->chroma_x_shift : 0;
        const unsigned int y_shift = plane ? h->chroma_y_shift : 0;
        const uint32_t width = (frame->width + (1u << x_shift) - 1u) >> x_shift;
        const uint32_t height = (frame->height + (1u << y_shift) - 1u) >> y_shift;
        if ((requested & AV_H264_INSPECTION_PREDICTED_PIXELS) &&
            allocate_plane(&inspection->predicted_planes[plane], width, height,
                           bytes_per_sample) < 0)
            goto fail;
        if ((requested & AV_H264_INSPECTION_RESIDUAL_PIXELS) &&
            allocate_residual_plane(&inspection->residual_planes[plane], width, height) < 0)
            goto fail;
        if ((requested & AV_H264_INSPECTION_PRE_FILTER_PIXELS) &&
            allocate_plane(&inspection->pre_filter_planes[plane], width, height,
                           bytes_per_sample) < 0)
            goto fail;
    }

    if (requested & AV_H264_INSPECTION_TRANSFORM_COEFFICIENTS) {
        inspection->transform_block_capacity = h->bitscope_max_transform_blocks;
        inspection->coefficient_capacity = h->bitscope_max_coefficients;
        inspection->transform_blocks = av_calloc(inspection->transform_block_capacity,
                                                 sizeof(*inspection->transform_blocks));
        inspection->coefficients = av_calloc(inspection->coefficient_capacity,
                                             sizeof(*inspection->coefficients));
        if (!inspection->transform_blocks || !inspection->coefficients)
            goto fail;
    }

    buffer = av_buffer_create((uint8_t *)inspection, sizeof(*inspection),
                              inspection_free, NULL, 0);
    if (!buffer)
        goto fail;
    side_data = av_frame_new_side_data_from_buf(
        frame, AV_FRAME_DATA_BITSCOPE_H264_INSPECTION, buffer);
    if (!side_data) {
        av_buffer_unref(&buffer);
        return NULL;
    }
    return inspection;

fail:
    inspection_free(NULL, (uint8_t *)inspection);
    return NULL;
}

static int coefficient_value(const H264Context *h, const int16_t *values, int index)
{
    return h->pixel_shift ? AV_RN32A(((const int32_t *)values) + index) :
                            AV_RN16A(values + index);
}

static void append_block(const H264Context *h, AVH264Inspection *inspection,
                         const int16_t *values, uint32_t x, uint32_t y,
                         uint16_t width, uint16_t height, uint8_t plane,
                         uint8_t flags)
{
    AVH264InspectionTransformBlock *block;
    uint32_t index;
    const uint32_t count = (uint32_t)width * height;
    if (inspection->transform_block_count >= inspection->transform_block_capacity ||
        count > inspection->coefficient_capacity - inspection->coefficient_count) {
        inspection->incomplete_stages |= AV_H264_INSPECTION_TRANSFORM_COEFFICIENTS;
        return;
    }
    block = &inspection->transform_blocks[inspection->transform_block_count++];
    block->x = x;
    block->y = y;
    block->width = width;
    block->height = height;
    block->plane = plane;
    block->flags = flags;
    block->coefficient_offset = inspection->coefficient_count;
    block->coefficient_count = count;
    for (index = 0; index < count; index++)
        inspection->coefficients[inspection->coefficient_count++] =
            coefficient_value(h, values, index);
}

void ff_bitscope_h264_record_coefficients(const H264Context *h, H264SliceContext *sl)
{
    AVH264Inspection *inspection = inspection_for(h);
    const int mb_type = h->cur_pic.mb_type[sl->mb_xy];
    const int chroma_format = h->ps.sps->chroma_format_idc;
    int plane;
    if (!inspection || !(inspection->available_stages &
                         AV_H264_INSPECTION_TRANSFORM_COEFFICIENTS) ||
        IS_INTRA_PCM(mb_type))
        return;
    if (MB_FIELD(sl) || FIELD_PICTURE(h) || FRAME_MBAFF(h))
        inspection->incomplete_stages |= AV_H264_INSPECTION_TRANSFORM_COEFFICIENTS;
    for (plane = 0; plane < inspection->plane_count; plane++) {
        const int blocks = plane == 0 || chroma_format == 3 ? 16 : 4 * chroma_format;
        const int use_8x8 = (plane == 0 || chroma_format == 3) && IS_8x8DCT(mb_type);
        const int step = use_8x8 ? 4 : 1;
        const int block_size = use_8x8 ? 8 : 4;
        int block;
        if ((plane == 0 || chroma_format == 3) && IS_INTRA16x16(mb_type))
            append_block(h, inspection, sl->mb_luma_dc[plane],
                         (uint32_t)sl->mb_x * 16, (uint32_t)sl->mb_y * 16,
                         4, 4, plane, AV_H264_TRANSFORM_BLOCK_DC);
        for (block = 0; block < blocks; block += step) {
            const int raster = use_8x8 ? block / 4 : block;
            const int columns = use_8x8 ? 2 : (plane == 0 || chroma_format == 3 ? 4 : 2);
            const int x = use_8x8 ? raster % columns :
                (plane == 0 || chroma_format == 3 ?
                 (block & 1) + ((block & 4) >> 1) : raster % columns);
            const int y = use_8x8 ? raster / columns :
                (plane == 0 || chroma_format == 3 ?
                 ((block & 2) >> 1) + ((block & 8) >> 2) : raster / columns);
            const int base = plane * 256 + block * 16;
            append_block(h, inspection, sl->mb + (base << h->pixel_shift),
                         (uint32_t)sl->mb_x * (plane && chroma_format != 3 ? 8 : 16) + x * block_size,
                         (uint32_t)sl->mb_y * (plane ? 16 >> h->chroma_y_shift : 16) + y * block_size,
                         block_size, block_size, plane, 0);
        }
    }
}

static void copy_prediction_block(const H264Context *h, AVH264Inspection *inspection,
                                  int plane, const uint8_t *source,
                                  ptrdiff_t source_stride, int width, int height)
{
    const AVFrame *frame = inspection_frame(h);
    AVH264InspectionPlane *destination = &inspection->predicted_planes[plane];
    const ptrdiff_t frame_stride = frame->linesize[plane];
    const unsigned int bytes_per_sample = 1u << h->pixel_shift;
    int row;
    if (!destination->data || frame_stride <= 0 || source_stride <= 0)
        return;
    for (row = 0; row < height; row++) {
        const uint8_t *source_row = source + row * source_stride;
        const ptrdiff_t offset = source_row - frame->data[plane];
        ptrdiff_t x_bytes;
        ptrdiff_t y;
        int column;
        if (offset < 0)
            continue;
        y = offset / frame_stride;
        x_bytes = offset % frame_stride;
        if (x_bytes % bytes_per_sample || y < 0 || y >= destination->height)
            continue;
        for (column = 0; column < width; column++) {
            const ptrdiff_t x = x_bytes / bytes_per_sample + column;
            uint8_t *target;
            if (x < 0 || x >= destination->width)
                continue;
            target = destination->data + y * destination->stride + x * bytes_per_sample;
            if (bytes_per_sample == 1)
                *target = source_row[column];
            else
                AV_WN16A(target, AV_RN16A(source_row + column * 2));
        }
    }
}

void ff_bitscope_h264_record_prediction(const H264Context *h, H264SliceContext *sl,
                                        int plane, const uint8_t *source,
                                        ptrdiff_t source_stride, int width, int height)
{
    AVH264Inspection *inspection = inspection_for(h);
    (void)sl;
    if (!inspection || plane < 0 || plane >= inspection->plane_count ||
        !(inspection->available_stages & AV_H264_INSPECTION_PREDICTED_PIXELS))
        return;
    if (MB_FIELD(sl) || FIELD_PICTURE(h) || FRAME_MBAFF(h)) {
        inspection->incomplete_stages |= AV_H264_INSPECTION_PREDICTED_PIXELS |
                                         AV_H264_INSPECTION_RESIDUAL_PIXELS;
        return;
    }
    copy_prediction_block(h, inspection, plane, source, source_stride, width, height);
}

void ff_bitscope_h264_mark_prediction_incomplete(const H264Context *h)
{
    AVH264Inspection *inspection = inspection_for(h);
    if (inspection)
        inspection->incomplete_stages |= AV_H264_INSPECTION_PREDICTED_PIXELS |
                                         AV_H264_INSPECTION_RESIDUAL_PIXELS;
}

static void record_reconstruction_block(const H264Context *h,
                                        AVH264Inspection *inspection, int plane,
                                        const uint8_t *source, ptrdiff_t source_stride,
                                        int width, int height, int pcm)
{
    const AVFrame *frame = inspection_frame(h);
    const ptrdiff_t frame_stride = frame->linesize[plane];
    const unsigned int bytes_per_sample = 1u << h->pixel_shift;
    AVH264InspectionPlane *prediction = &inspection->predicted_planes[plane];
    AVH264InspectionPlane *pre_filter = &inspection->pre_filter_planes[plane];
    AVH264InspectionResidualPlane *residual = &inspection->residual_planes[plane];
    int row;
    if (frame_stride <= 0 || source_stride <= 0)
        return;
    for (row = 0; row < height; row++) {
        const uint8_t *source_row = source + row * source_stride;
        const ptrdiff_t offset = source_row - frame->data[plane];
        ptrdiff_t x_bytes;
        ptrdiff_t y;
        int column;
        if (offset < 0)
            continue;
        y = offset / frame_stride;
        x_bytes = offset % frame_stride;
        if (x_bytes % bytes_per_sample || y < 0 || y >= frame->height)
            continue;
        for (column = 0; column < width; column++) {
            const ptrdiff_t x = x_bytes / bytes_per_sample + column;
            unsigned int reconstructed;
            unsigned int predicted = 0;
            if (x < 0 || (pre_filter->data && x >= pre_filter->width) ||
                (prediction->data && x >= prediction->width) ||
                (residual->data && x >= residual->width))
                continue;
            reconstructed = bytes_per_sample == 1 ? source_row[column] :
                AV_RN16A(source_row + column * 2);
            if (prediction->data) {
                uint8_t *predicted_at = prediction->data + y * prediction->stride +
                                        x * bytes_per_sample;
                if (pcm) {
                    if (bytes_per_sample == 1)
                        *predicted_at = reconstructed;
                    else
                        AV_WN16A(predicted_at, reconstructed);
                }
                predicted = bytes_per_sample == 1 ? *predicted_at : AV_RN16A(predicted_at);
            }
            if (pre_filter->data) {
                uint8_t *target = pre_filter->data + y * pre_filter->stride +
                                  x * bytes_per_sample;
                if (bytes_per_sample == 1)
                    *target = reconstructed;
                else
                    AV_WN16A(target, reconstructed);
            }
            if (residual->data)
                residual->data[y * residual->stride_samples + x] =
                    pcm ? 0 : (int16_t)((int)reconstructed - (int)predicted);
        }
    }
}

void ff_bitscope_h264_record_reconstruction(const H264Context *h, H264SliceContext *sl)
{
    AVH264Inspection *inspection = inspection_for(h);
    AVFrame *frame = inspection_frame(h);
    const int mb_type = h->cur_pic.mb_type[sl->mb_xy];
    const int pcm = IS_INTRA_PCM(mb_type);
    int plane;
    if (!inspection || !(inspection->available_stages &
        (AV_H264_INSPECTION_PRE_FILTER_PIXELS | AV_H264_INSPECTION_RESIDUAL_PIXELS)))
        return;
    if (MB_FIELD(sl) || FIELD_PICTURE(h) || FRAME_MBAFF(h)) {
        inspection->incomplete_stages |= AV_H264_INSPECTION_PREDICTED_PIXELS |
                                         AV_H264_INSPECTION_RESIDUAL_PIXELS |
                                         AV_H264_INSPECTION_PRE_FILTER_PIXELS;
        return;
    }
    for (plane = 0; plane < inspection->plane_count; plane++) {
        const int x_shift = plane ? h->chroma_x_shift : 0;
        const int y_shift = plane ? h->chroma_y_shift : 0;
        const int width = 16 >> x_shift;
        const int height = 16 >> y_shift;
        const int x = sl->mb_x * width;
        const int y = sl->mb_y * height;
        const uint8_t *source = frame->data[plane] + y * frame->linesize[plane] +
                                (x << h->pixel_shift);
        record_reconstruction_block(h, inspection, plane, source,
                                    frame->linesize[plane], width, height, pcm);
    }
}

static uint64_t picture_id(const H264Picture *picture)
{
    const AVH264Inspection *inspection;
    if (!picture || !picture->f)
        return 0;
    inspection = av_h264_get_inspection(picture->f);
    return inspection ? inspection->picture_id : 0;
}

static uint32_t dpb_count(const H264Context *h)
{
    uint32_t count = h->short_ref_count;
    int slot;
    for (slot = 0; slot < 32; slot++)
        count += h->long_ref[slot] != NULL;
    return count;
}

static void fill_dpb_entry(AVH264DPBEntry *entry, const H264Picture *picture,
                           int slot, int slot_kind)
{
    entry->picture_id = picture_id(picture);
    entry->frame_num = picture->frame_num;
    entry->poc = picture->poc;
    entry->field_poc[0] = picture->field_poc[0];
    entry->field_poc[1] = picture->field_poc[1];
    entry->slot = slot;
    entry->slot_kind = slot_kind;
    entry->reference = picture->reference;
    entry->long_term = picture->long_ref != 0;
    entry->delayed_output = !!(picture->reference & DELAYED_PIC_REF);
    entry->recovered = picture->recovered != 0;
    entry->invalid_gap = picture->invalid_gap != 0;
}

static void append_dpb(const H264Context *h, AVH264Inspection *inspection)
{
    int slot;
    for (slot = 0; slot < h->short_ref_count; slot++)
        fill_dpb_entry(&inspection->dpb_entries[inspection->dpb_entry_count++],
                       h->short_ref[slot], slot, AV_H264_DPB_SHORT_TERM);
    for (slot = 0; slot < 32; slot++) {
        if (h->long_ref[slot])
            fill_dpb_entry(&inspection->dpb_entries[inspection->dpb_entry_count++],
                           h->long_ref[slot], slot, AV_H264_DPB_LONG_TERM);
    }
}

static void reference_slots(const H264Context *h, const H264Picture *picture,
                            int16_t *short_slot, int16_t *long_slot)
{
    int slot;
    *short_slot = -1;
    *long_slot = -1;
    for (slot = 0; slot < h->short_ref_count; slot++) {
        if (h->short_ref[slot] == picture) {
            *short_slot = slot;
            break;
        }
    }
    for (slot = 0; slot < 32; slot++) {
        if (h->long_ref[slot] == picture) {
            *long_slot = slot;
            break;
        }
    }
}

void ff_bitscope_h264_record_references(const H264Context *h,
                                        const H264SliceContext *sl)
{
    AVH264Inspection *inspection = inspection_for(h);
    AVH264SliceReferences *slice;
    const uint32_t new_dpb = dpb_count(h);
    const uint32_t new_references = sl->ref_count[0] +
                                    (sl->list_count > 1 ? sl->ref_count[1] : 0);
    const uint32_t new_modifications = sl->nb_ref_modifications[0] +
        (sl->list_count > 1 ? sl->nb_ref_modifications[1] : 0);
    uint32_t needed;
    int list;

    if (!inspection || !(inspection->available_stages &
        (AV_H264_INSPECTION_REFERENCE_LISTS | AV_H264_INSPECTION_DPB)))
        return;
    if (sl->list_count > 2 || sl->ref_count[0] > 32 || sl->ref_count[1] > 32 ||
        sl->nb_ref_modifications[0] < 0 || sl->nb_ref_modifications[0] > 32 ||
        sl->nb_ref_modifications[1] < 0 || sl->nb_ref_modifications[1] > 32)
        goto incomplete;
    if (inspection->slice_count == UINT32_MAX ||
        new_references > UINT32_MAX - inspection->reference_count ||
        new_modifications > UINT32_MAX - inspection->modification_count ||
        new_dpb > UINT32_MAX - inspection->dpb_entry_count)
        goto incomplete;
    if (reserve_array((void **)&inspection->slices, &inspection->slice_capacity,
                      inspection->slice_count + 1,
                      h->bitscope_max_reference_slices,
                      sizeof(*inspection->slices)) < 0)
        goto incomplete;
    needed = inspection->reference_count + new_references;
    if (reserve_array((void **)&inspection->references,
                      &inspection->reference_capacity, needed,
                      h->bitscope_max_reference_entries,
                      sizeof(*inspection->references)) < 0)
        goto incomplete;
    needed = inspection->modification_count + new_modifications;
    if (reserve_array((void **)&inspection->modifications,
                      &inspection->modification_capacity, needed,
                      h->bitscope_max_reference_modifications,
                      sizeof(*inspection->modifications)) < 0)
        goto incomplete;
    needed = inspection->dpb_entry_count + new_dpb;
    if (reserve_array((void **)&inspection->dpb_entries,
                      &inspection->dpb_entry_capacity, needed,
                      h->bitscope_max_dpb_entries,
                      sizeof(*inspection->dpb_entries)) < 0)
        goto incomplete;

    slice = &inspection->slices[inspection->slice_count];
    slice->slice_num = sl->slice_num;
    slice->first_mb_addr = sl->first_mb_addr;
    slice->slice_type = sl->slice_type_nos;
    slice->picture_structure = sl->picture_structure;
    slice->list_count = sl->list_count;
    slice->reserved = 0;
    slice->dpb_offset = inspection->dpb_entry_count;
    slice->dpb_count = new_dpb;
    append_dpb(h, inspection);
    for (list = 0; list < 2; list++) {
        const uint32_t ref_count = list < sl->list_count ? sl->ref_count[list] : 0;
        const uint32_t mod_count = list < sl->list_count ?
            sl->nb_ref_modifications[list] : 0;
        uint32_t index;
        slice->ref_count[list] = ref_count;
        slice->reference_offset[list] = inspection->reference_count;
        slice->modification_offset[list] = inspection->modification_count;
        slice->modification_count[list] = mod_count;
        for (index = 0; index < ref_count; index++) {
            const H264Ref *source = &sl->ref_list[list][index];
            AVH264ReferenceEntry *entry =
                &inspection->references[inspection->reference_count++];
            if (!source->parent)
                goto incomplete_committed;
            entry->picture_id = picture_id(source->parent);
            entry->frame_num = source->parent->frame_num;
            entry->pic_id = source->pic_id;
            entry->poc = source->poc;
            entry->field_poc[0] = source->parent->field_poc[0];
            entry->field_poc[1] = source->parent->field_poc[1];
            reference_slots(h, source->parent, &entry->short_term_slot,
                            &entry->long_term_slot);
            entry->list = list;
            entry->index = index;
            entry->reference = source->reference;
            entry->long_term = source->parent->long_ref != 0;
        }
        for (index = 0; index < mod_count; index++) {
            AVH264ReferenceModification *entry =
                &inspection->modifications[inspection->modification_count++];
            entry->value = sl->ref_modifications[list][index].val;
            entry->list = list;
            entry->index = index;
            entry->operation = sl->ref_modifications[list][index].op;
            entry->reserved = 0;
        }
    }
    inspection->slice_count++;
    return;

incomplete_committed:
    inspection->reference_count = slice->reference_offset[0];
    inspection->modification_count = slice->modification_offset[0];
    inspection->dpb_entry_count = slice->dpb_offset;
incomplete:
    inspection->incomplete_stages |= AV_H264_INSPECTION_REFERENCE_LISTS |
                                     AV_H264_INSPECTION_DPB;
}

void ff_bitscope_h264_record_post_marking_dpb(const H264Context *h)
{
    AVH264Inspection *inspection = inspection_for(h);
    const uint32_t count = dpb_count(h);
    uint32_t needed;

    if (!inspection || !(inspection->available_stages & AV_H264_INSPECTION_DPB))
        return;
    if (count > UINT32_MAX - inspection->dpb_entry_count)
        goto incomplete;
    needed = inspection->dpb_entry_count + count;
    if (reserve_array((void **)&inspection->dpb_entries,
                      &inspection->dpb_entry_capacity, needed,
                      h->bitscope_max_dpb_entries,
                      sizeof(*inspection->dpb_entries)) < 0)
        goto incomplete;
    inspection->post_marking_dpb_offset = inspection->dpb_entry_count;
    inspection->post_marking_dpb_count = count;
    append_dpb(h, inspection);
    return;

incomplete:
    inspection->incomplete_stages |= AV_H264_INSPECTION_DPB;
}
