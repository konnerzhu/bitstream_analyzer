#ifndef BITSCOPE_H264_INSPECTOR_H_
#define BITSCOPE_H264_INSPECTOR_H_

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define BITSCOPE_H264_INSPECTOR_ABI_VERSION 2u

enum BitscopeH264PixelLayout {
  BITSCOPE_H264_PIXEL_I400 = 0,
  BITSCOPE_H264_PIXEL_I420 = 1,
  BITSCOPE_H264_PIXEL_I422 = 2,
  BITSCOPE_H264_PIXEL_I444 = 3,
  BITSCOPE_H264_PIXEL_UNSUPPORTED = 255
};

enum BitscopeH264InspectionStage {
  BITSCOPE_H264_STAGE_FINAL_PIXELS = 1u << 0,
  BITSCOPE_H264_STAGE_MOTION_VECTORS = 1u << 1,
  BITSCOPE_H264_STAGE_PREDICTED_PIXELS = 1u << 2,
  BITSCOPE_H264_STAGE_RESIDUAL_PIXELS = 1u << 3,
  BITSCOPE_H264_STAGE_TRANSFORM_COEFFICIENTS = 1u << 4,
  BITSCOPE_H264_STAGE_PRE_FILTER_PIXELS = 1u << 5
};

enum BitscopeH264Result {
  BITSCOPE_H264_OK = 0,
  BITSCOPE_H264_INVALID_ARGUMENT = 1,
  BITSCOPE_H264_LIMIT_EXCEEDED = 2,
  BITSCOPE_H264_DECODER_UNAVAILABLE = 3,
  BITSCOPE_H264_INVALID_BITSTREAM = 4,
  BITSCOPE_H264_DECODE_ERROR = 5,
  BITSCOPE_H264_CANCELLED = 6,
  BITSCOPE_H264_OUT_OF_MEMORY = 7
};

typedef struct BitscopeH264Limits {
  uint32_t struct_size;
  size_t max_input_bytes;
  uint32_t max_dimension;
  uint64_t max_pixels;
  uint32_t max_frames;
  uint32_t max_motion_vectors_per_frame;
} BitscopeH264Limits;

typedef struct BitscopeH264Plane {
  const uint8_t* data;
  int32_t stride;
  uint32_t width;
  uint32_t height;
} BitscopeH264Plane;

typedef struct BitscopeH264ResidualPlane {
  const int16_t* data;
  int32_t stride_samples;
  uint32_t width;
  uint32_t height;
} BitscopeH264ResidualPlane;

typedef struct BitscopeH264TransformBlock {
  uint32_t x;
  uint32_t y;
  uint16_t width;
  uint16_t height;
  uint8_t plane;
  uint8_t reserved[3];
  const int32_t* coefficients;
  uint32_t coefficient_count;
} BitscopeH264TransformBlock;

typedef struct BitscopeH264MotionVector {
  int32_t source;
  uint32_t width;
  uint32_t height;
  int32_t source_x;
  int32_t source_y;
  int32_t destination_x;
  int32_t destination_y;
  int32_t motion_x;
  int32_t motion_y;
  uint32_t motion_scale;
  uint64_t flags;
} BitscopeH264MotionVector;

typedef struct BitscopeH264Frame {
  uint32_t struct_size;
  uint32_t decode_index;
  uint32_t width;
  uint32_t height;
  int32_t pixel_format;
  int32_t picture_type;
  int64_t presentation_timestamp;
  uint8_t key_frame;
  uint8_t final_plane_count;
  uint8_t predicted_plane_count;
  uint8_t residual_plane_count;
  uint8_t pre_filter_plane_count;
  uint8_t reserved[3];
  uint32_t available_stages;
  BitscopeH264Plane final_planes[4];
  BitscopeH264Plane predicted_planes[4];
  BitscopeH264ResidualPlane residual_planes[4];
  BitscopeH264Plane pre_filter_planes[4];
  const BitscopeH264MotionVector* motion_vectors;
  uint32_t motion_vector_count;
  const BitscopeH264TransformBlock* transform_blocks;
  uint32_t transform_block_count;
  int32_t color_range;
  int32_t matrix_coefficients;
  uint8_t bit_depth;
  uint8_t pixel_layout;
  uint8_t reserved_v2[2];
} BitscopeH264Frame;

typedef int (*BitscopeH264FrameCallback)(const BitscopeH264Frame* frame, void* user_data);

typedef struct BitscopeH264Observer {
  uint32_t struct_size;
  BitscopeH264FrameCallback on_frame;
  void* user_data;
} BitscopeH264Observer;

/* All returned data pointers are valid only during on_frame. */
int bitscope_h264_inspect_annexb(
    const uint8_t* data,
    size_t size,
    const BitscopeH264Limits* limits,
    const BitscopeH264Observer* observer,
    char* error_message,
    size_t error_message_capacity);

uint32_t bitscope_h264_inspector_abi_version(void);
uint32_t bitscope_h264_inspector_available_stages(void);

#ifdef __cplusplus
}
#endif

#endif
