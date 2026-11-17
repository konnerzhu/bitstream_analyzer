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

#ifndef AVCODEC_BITSCOPE_H264_INSPECTION_INTERNAL_H
#define AVCODEC_BITSCOPE_H264_INSPECTION_INTERNAL_H

#include <stddef.h>
#include <stdint.h>

typedef struct H264Context H264Context;
typedef struct H264SliceContext H264SliceContext;

void ff_bitscope_h264_record_coefficients(const H264Context *h, H264SliceContext *sl);
void ff_bitscope_h264_record_prediction(const H264Context *h, H264SliceContext *sl,
                                        int plane, const uint8_t *source,
                                        ptrdiff_t source_stride, int width, int height);
void ff_bitscope_h264_mark_prediction_incomplete(const H264Context *h);
void ff_bitscope_h264_record_reconstruction(const H264Context *h, H264SliceContext *sl);
void ff_bitscope_h264_record_references(const H264Context *h, const H264SliceContext *sl);
void ff_bitscope_h264_record_post_marking_dpb(const H264Context *h);

#endif
