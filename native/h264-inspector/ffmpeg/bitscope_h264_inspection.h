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
#ifndef AVCODEC_BITSCOPE_H264_INSPECTION_H
#define AVCODEC_BITSCOPE_H264_INSPECTION_H

#include <stddef.h>
#include <stdint.h>

#include "libavutil/frame.h"

#define AV_H264_INSPECTION_VERSION 2u

enum AVH264InspectionStage {
    AV_H264_INSPECTION_PREDICTED_PIXELS       = 1u << 2,
    AV_H264_INSPECTION_RESIDUAL_PIXELS        = 1u << 3,
    AV_H264_INSPECTION_TRANSFORM_COEFFICIENTS = 1u << 4,
    AV_H264_INSPECTION_PRE_FILTER_PIXELS      = 1u << 5,
    AV_H264_INSPECTION_REFERENCE_LISTS        = 1u << 6,
    AV_H264_INSPECTION_DPB                    = 1u << 7,
};

enum AVH264TransformBlockFlags {
    AV_H264_TRANSFORM_BLOCK_DC = 1u << 0,
};

typedef struct AVH264InspectionPlane {
    uint8_t *data;
    ptrdiff_t stride;
    uint32_t width;
    uint32_t height;
} AVH264InspectionPlane;

typedef struct AVH264InspectionResidualPlane {
    int16_t *data;
    ptrdiff_t stride_samples;
    uint32_t width;
    uint32_t height;
} AVH264InspectionResidualPlane;

typedef struct AVH264InspectionTransformBlock {
    uint32_t x;
    uint32_t y;
    uint16_t width;
    uint16_t height;
    uint8_t plane;
    uint8_t flags;
    uint16_t reserved;
    uint32_t coefficient_offset;
    uint32_t coefficient_count;
} AVH264InspectionTransformBlock;

enum AVH264DPBSlotKind {
    AV_H264_DPB_SHORT_TERM = 0,
    AV_H264_DPB_LONG_TERM  = 1,
};

typedef struct AVH264DPBEntry {
    uint64_t picture_id;
    int32_t frame_num;
    int32_t poc;
    int32_t field_poc[2];
    int16_t slot;
    uint8_t slot_kind;
    uint8_t reference;
    uint8_t long_term;
    uint8_t delayed_output;
    uint8_t recovered;
    uint8_t invalid_gap;
} AVH264DPBEntry;

typedef struct AVH264ReferenceEntry {
    uint64_t picture_id;
    int32_t frame_num;
    int32_t pic_id;
    int32_t poc;
    int32_t field_poc[2];
    int16_t short_term_slot;
    int16_t long_term_slot;
    uint8_t list;
    uint8_t index;
    uint8_t reference;
    uint8_t long_term;
} AVH264ReferenceEntry;

typedef struct AVH264ReferenceModification {
    uint32_t value;
    uint8_t list;
    uint8_t index;
    uint8_t operation;
    uint8_t reserved;
} AVH264ReferenceModification;

typedef struct AVH264SliceReferences {
    uint32_t slice_num;
    uint32_t first_mb_addr;
    int32_t slice_type;
    int32_t picture_structure;
    uint8_t list_count;
    uint8_t ref_count[2];
    uint8_t reserved;
    uint32_t reference_offset[2];
    uint32_t modification_offset[2];
    uint32_t modification_count[2];
    uint32_t dpb_offset;
    uint32_t dpb_count;
} AVH264SliceReferences;

typedef struct AVH264Inspection {
    uint32_t struct_size;
    uint32_t version;
    uint32_t available_stages;
    uint32_t incomplete_stages;
    uint8_t bit_depth;
    uint8_t plane_count;
    uint8_t pixel_shift;
    uint8_t reserved;
    uint64_t picture_id;
    int32_t frame_num;
    int32_t poc;
    int32_t field_poc[2];
    AVH264InspectionPlane predicted_planes[4];
    AVH264InspectionResidualPlane residual_planes[4];
    AVH264InspectionPlane pre_filter_planes[4];
    AVH264InspectionTransformBlock *transform_blocks;
    uint32_t transform_block_count;
    uint32_t transform_block_capacity;
    int32_t *coefficients;
    uint32_t coefficient_count;
    uint32_t coefficient_capacity;
    AVH264SliceReferences *slices;
    uint32_t slice_count;
    uint32_t slice_capacity;
    AVH264ReferenceEntry *references;
    uint32_t reference_count;
    uint32_t reference_capacity;
    AVH264ReferenceModification *modifications;
    uint32_t modification_count;
    uint32_t modification_capacity;
    AVH264DPBEntry *dpb_entries;
    uint32_t dpb_entry_count;
    uint32_t dpb_entry_capacity;
    uint32_t post_marking_dpb_offset;
    uint32_t post_marking_dpb_count;
} AVH264Inspection;

static inline const AVH264Inspection *av_h264_get_inspection(const AVFrame *frame)
{
    const AVFrameSideData *side_data = frame ?
        av_frame_get_side_data(frame, AV_FRAME_DATA_BITSCOPE_H264_INSPECTION) : NULL;
    if (!side_data || side_data->size < sizeof(AVH264Inspection))
        return NULL;
    return (const AVH264Inspection *)side_data->data;
}

#endif
