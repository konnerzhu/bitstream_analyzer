#ifndef BITSCOPE_AV1_DECODER_H_
#define BITSCOPE_AV1_DECODER_H_

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define BITSCOPE_AV1_DECODER_ABI_VERSION 1u

enum BitscopeAv1InputFormat {
  BITSCOPE_AV1_INPUT_AUTO = 0,
  BITSCOPE_AV1_INPUT_IVF = 1,
  BITSCOPE_AV1_INPUT_LOW_OVERHEAD_OBU = 2
};

enum BitscopeAv1DecodeStage {
  BITSCOPE_AV1_STAGE_FINAL_PIXELS = 1u << 0
};

enum BitscopeAv1Result {
  BITSCOPE_AV1_OK = 0,
  BITSCOPE_AV1_INVALID_ARGUMENT = 1,
  BITSCOPE_AV1_LIMIT_EXCEEDED = 2,
  BITSCOPE_AV1_DECODER_UNAVAILABLE = 3,
  BITSCOPE_AV1_INVALID_BITSTREAM = 4,
  BITSCOPE_AV1_DECODE_ERROR = 5,
  BITSCOPE_AV1_CANCELLED = 6,
  BITSCOPE_AV1_OUT_OF_MEMORY = 7
};

enum BitscopeAv1PixelLayout {
  BITSCOPE_AV1_PIXEL_I400 = 0,
  BITSCOPE_AV1_PIXEL_I420 = 1,
  BITSCOPE_AV1_PIXEL_I422 = 2,
  BITSCOPE_AV1_PIXEL_I444 = 3
};

typedef struct BitscopeAv1Limits {
  uint32_t struct_size;
  size_t max_input_bytes;
  size_t max_temporal_unit_bytes;
  uint32_t max_dimension;
  uint64_t max_pixels;
  uint32_t max_frames;
  uint32_t max_temporal_units;
} BitscopeAv1Limits;

typedef struct BitscopeAv1Options {
  uint32_t struct_size;
  uint32_t input_format;
  uint32_t threads;
  uint8_t apply_film_grain;
  uint8_t strict_standard_compliance;
  uint8_t reserved[2];
} BitscopeAv1Options;

typedef struct BitscopeAv1Plane {
  const void* data;
  int64_t stride_bytes;
  uint32_t width;
  uint32_t height;
} BitscopeAv1Plane;

typedef struct BitscopeAv1Frame {
  uint32_t struct_size;
  uint32_t decode_index;
  uint32_t width;
  uint32_t height;
  uint32_t render_width;
  uint32_t render_height;
  int64_t presentation_timestamp;
  int64_t duration;
  int32_t frame_type;
  int32_t pixel_layout;
  int32_t color_primaries;
  int32_t transfer_characteristics;
  int32_t matrix_coefficients;
  uint8_t bit_depth;
  uint8_t plane_count;
  uint8_t key_frame;
  uint8_t show_frame;
  uint8_t show_existing_frame;
  uint8_t temporal_id;
  uint8_t spatial_id;
  uint8_t full_range;
  uint8_t film_grain_present;
  uint8_t film_grain_applied;
  uint8_t reserved[2];
  uint32_t available_stages;
  BitscopeAv1Plane final_planes[3];
} BitscopeAv1Frame;

typedef int (*BitscopeAv1FrameCallback)(const BitscopeAv1Frame* frame, void* user_data);

typedef struct BitscopeAv1Observer {
  uint32_t struct_size;
  BitscopeAv1FrameCallback on_frame;
  void* user_data;
} BitscopeAv1Observer;

/* All returned plane pointers are valid only during on_frame. */
int bitscope_av1_decode(
    const uint8_t* data,
    size_t size,
    const BitscopeAv1Options* options,
    const BitscopeAv1Limits* limits,
    const BitscopeAv1Observer* observer,
    char* error_message,
    size_t error_message_capacity);

uint32_t bitscope_av1_decoder_abi_version(void);
uint32_t bitscope_av1_decoder_available_stages(void);

#ifdef __cplusplus
}
#endif

#endif
