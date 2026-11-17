#include "bitscope_h264_inspector.h"

#include <algorithm>
#include <cstdio>
#include <limits>
#include <memory>
#include <new>
#include <string>
#include <string_view>
#include <vector>

extern "C" {
#include <libavcodec/avcodec.h>
#if __has_include(<libavcodec/bitscope_h264_inspection.h>)
#include <libavcodec/bitscope_h264_inspection.h>
#define BITSCOPE_HAS_FFMPEG_INSPECTION 1
#else
#define BITSCOPE_HAS_FFMPEG_INSPECTION 0
#endif
#include <libavutil/error.h>
#include <libavutil/frame.h>
#include <libavutil/motion_vector.h>
#include <libavutil/opt.h>
#include <libavutil/pixdesc.h>
}

namespace {

constexpr size_t kDefaultMaxInputBytes = 64u * 1024u * 1024u;
constexpr uint32_t kDefaultMaxDimension = 8192u;
constexpr uint64_t kDefaultMaxPixels = 8192ull * 4320ull;
constexpr uint32_t kDefaultMaxFrames = 10000u;
constexpr uint32_t kDefaultMaxMotionVectors = 1000000u;
constexpr uint32_t kDefaultMaxTransformBlocks = 1000000u;
constexpr uint32_t kDefaultMaxCoefficients = 16000000u;
constexpr uint32_t kDefaultMaxReferenceSlices = 4096u;
constexpr uint32_t kDefaultMaxReferenceEntries = 262144u;
constexpr uint32_t kDefaultMaxReferenceModifications = 262144u;
constexpr uint32_t kDefaultMaxDpbEntries = 147492u;
constexpr uint32_t kRequestedNativeInspectionStages =
    BITSCOPE_H264_STAGE_PREDICTED_PIXELS |
    BITSCOPE_H264_STAGE_RESIDUAL_PIXELS |
    BITSCOPE_H264_STAGE_TRANSFORM_COEFFICIENTS |
    BITSCOPE_H264_STAGE_PRE_FILTER_PIXELS |
    BITSCOPE_H264_STAGE_REFERENCE_LISTS |
    BITSCOPE_H264_STAGE_DPB;
constexpr uint32_t kNativeInspectionStages =
    BITSCOPE_HAS_FFMPEG_INSPECTION ? kRequestedNativeInspectionStages : 0u;
constexpr uint32_t kAvailableStages = BITSCOPE_H264_STAGE_FINAL_PIXELS |
    BITSCOPE_H264_STAGE_MOTION_VECTORS | kNativeInspectionStages;

struct CodecContextDeleter {
  void operator()(AVCodecContext* context) const {
    avcodec_free_context(&context);
  }
};

struct ParserDeleter {
  void operator()(AVCodecParserContext* parser) const {
    av_parser_close(parser);
  }
};

struct FrameDeleter {
  void operator()(AVFrame* frame) const {
    av_frame_free(&frame);
  }
};

using CodecContextPtr = std::unique_ptr<AVCodecContext, CodecContextDeleter>;
using ParserPtr = std::unique_ptr<AVCodecParserContext, ParserDeleter>;
using FramePtr = std::unique_ptr<AVFrame, FrameDeleter>;

struct DecodeState {
  BitscopeH264Limits limits{};
  const BitscopeH264Observer* observer = nullptr;
  uint32_t frame_count = 0;
  std::vector<BitscopeH264MotionVector> motion_vectors;
  std::vector<int32_t> coefficients;
  std::vector<BitscopeH264TransformBlock> transform_blocks;
  std::vector<BitscopeH264SliceReferences> slices;
  std::vector<BitscopeH264ReferenceEntry> references;
  std::vector<BitscopeH264ReferenceModification> reference_modifications;
  std::vector<BitscopeH264DpbEntry> dpb_entries;
};

void WriteError(char* destination, size_t capacity, std::string_view message) {
  if (destination == nullptr || capacity == 0) return;
  const size_t maximum = std::min(capacity - 1, static_cast<size_t>(std::numeric_limits<int>::max()));
  const size_t length = std::min(maximum, message.size());
  std::snprintf(destination, capacity, "%.*s", static_cast<int>(length), message.data());
}

std::string AvError(int code) {
  char buffer[AV_ERROR_MAX_STRING_SIZE]{};
  if (av_strerror(code, buffer, sizeof(buffer)) < 0) return "unknown FFmpeg error";
  return std::string(buffer);
}

bool HasAnnexBStartCode(const uint8_t* data, size_t size) {
  const size_t scan_size = std::min(size, static_cast<size_t>(4096));
  for (size_t index = 0; index + 3 <= scan_size; ++index) {
    if (data[index] == 0 && data[index + 1] == 0 && data[index + 2] == 1) return true;
    if (index + 4 <= scan_size && data[index] == 0 && data[index + 1] == 0 && data[index + 2] == 0 && data[index + 3] == 1) return true;
  }
  return false;
}

BitscopeH264Limits ResolveLimits(const BitscopeH264Limits* supplied) {
  BitscopeH264Limits result{
      sizeof(BitscopeH264Limits), kDefaultMaxInputBytes, kDefaultMaxDimension,
      kDefaultMaxPixels, kDefaultMaxFrames, kDefaultMaxMotionVectors,
      kDefaultMaxTransformBlocks, kDefaultMaxCoefficients,
      kDefaultMaxReferenceSlices, kDefaultMaxReferenceEntries,
      kDefaultMaxReferenceModifications, kDefaultMaxDpbEntries};
  if (supplied == nullptr) return result;
  result.max_input_bytes = supplied->max_input_bytes;
  result.max_dimension = supplied->max_dimension;
  result.max_pixels = supplied->max_pixels;
  result.max_frames = supplied->max_frames;
  result.max_motion_vectors_per_frame = supplied->max_motion_vectors_per_frame;
  result.max_transform_blocks_per_frame = supplied->max_transform_blocks_per_frame;
  result.max_coefficients_per_frame = supplied->max_coefficients_per_frame;
  result.max_reference_slices_per_frame = supplied->max_reference_slices_per_frame;
  result.max_reference_entries_per_frame = supplied->max_reference_entries_per_frame;
  result.max_reference_modifications_per_frame =
      supplied->max_reference_modifications_per_frame;
  result.max_dpb_entries_per_frame = supplied->max_dpb_entries_per_frame;
  return result;
}

#if BITSCOPE_HAS_FFMPEG_INSPECTION
bool RangeWithin(uint32_t offset, uint32_t count, size_t size) {
  return offset <= size && count <= size - offset;
}
#endif

int ValidateFrame(const AVFrame* frame, const DecodeState& state, std::string* error) {
  if (frame->width <= 0 || frame->height <= 0 ||
      static_cast<uint32_t>(frame->width) > state.limits.max_dimension ||
      static_cast<uint32_t>(frame->height) > state.limits.max_dimension) {
    *error = "decoded frame dimensions exceed the configured limit";
    return BITSCOPE_H264_LIMIT_EXCEEDED;
  }
  const uint64_t pixels = static_cast<uint64_t>(frame->width) * static_cast<uint64_t>(frame->height);
  if (pixels > state.limits.max_pixels) {
    *error = "decoded frame pixel count exceeds the configured limit";
    return BITSCOPE_H264_LIMIT_EXCEEDED;
  }
  if (state.frame_count >= state.limits.max_frames) {
    *error = "decoded frame count exceeds the configured limit";
    return BITSCOPE_H264_LIMIT_EXCEEDED;
  }
  return BITSCOPE_H264_OK;
}

int InspectFrame(const AVFrame* decoded, DecodeState* state, std::string* error) {
  const int validation = ValidateFrame(decoded, *state, error);
  if (validation != BITSCOPE_H264_OK) return validation;

  state->motion_vectors.clear();
  state->coefficients.clear();
  state->transform_blocks.clear();
  state->slices.clear();
  state->references.clear();
  state->reference_modifications.clear();
  state->dpb_entries.clear();
  const AVFrameSideData* side_data = av_frame_get_side_data(decoded, AV_FRAME_DATA_MOTION_VECTORS);
  if (side_data != nullptr) {
    if (side_data->size % sizeof(AVMotionVector) != 0) {
      *error = "decoder returned malformed motion-vector side data";
      return BITSCOPE_H264_DECODE_ERROR;
    }
    const size_t count = side_data->size / sizeof(AVMotionVector);
    if (count > state->limits.max_motion_vectors_per_frame || count > std::numeric_limits<uint32_t>::max()) {
      *error = "motion-vector count exceeds the configured limit";
      return BITSCOPE_H264_LIMIT_EXCEEDED;
    }
    const auto* source = reinterpret_cast<const AVMotionVector*>(side_data->data);
    state->motion_vectors.reserve(count);
    for (size_t index = 0; index < count; ++index) {
      const AVMotionVector& vector = source[index];
      state->motion_vectors.push_back({
          vector.source, vector.w, vector.h, vector.src_x, vector.src_y,
          vector.dst_x, vector.dst_y, vector.motion_x, vector.motion_y,
          vector.motion_scale, vector.flags});
    }
  }

  BitscopeH264Frame frame{};
  frame.struct_size = sizeof(BitscopeH264Frame);
  frame.decode_index = state->frame_count;
  frame.width = static_cast<uint32_t>(decoded->width);
  frame.height = static_cast<uint32_t>(decoded->height);
  frame.pixel_format = decoded->format;
  frame.picture_type = decoded->pict_type;
  frame.presentation_timestamp = decoded->pts;
  frame.key_frame = (decoded->flags & AV_FRAME_FLAG_KEY) != 0 ? 1 : 0;
  frame.available_stages = BITSCOPE_H264_STAGE_FINAL_PIXELS |
                           BITSCOPE_H264_STAGE_MOTION_VECTORS;
  frame.motion_vectors = state->motion_vectors.empty() ? nullptr : state->motion_vectors.data();
  frame.motion_vector_count = static_cast<uint32_t>(state->motion_vectors.size());
  frame.color_range = decoded->color_range;
  frame.matrix_coefficients = decoded->colorspace;

#if BITSCOPE_HAS_FFMPEG_INSPECTION
  const AVH264Inspection* inspection = av_h264_get_inspection(decoded);
  if (inspection == nullptr || inspection->version != AV_H264_INSPECTION_VERSION ||
      inspection->struct_size < sizeof(AVH264Inspection)) {
    *error = "bundled FFmpeg decoder did not return H.264 inspection data";
    return BITSCOPE_H264_DECODE_ERROR;
  }
  if ((inspection->plane_count != 1 && inspection->plane_count != 3) ||
      inspection->pixel_shift > 1) {
    *error = "decoder returned malformed H.264 inspection plane metadata";
    return BITSCOPE_H264_DECODE_ERROR;
  }
  frame.available_stages |= inspection->available_stages & kNativeInspectionStages;
  frame.incomplete_stages = inspection->incomplete_stages & kNativeInspectionStages;
  for (uint8_t plane = 0; plane < inspection->plane_count && plane < 4; ++plane) {
    const AVH264InspectionPlane& predicted = inspection->predicted_planes[plane];
    if (predicted.data != nullptr) {
      if (predicted.width == 0 || predicted.height == 0 || predicted.stride <= 0 ||
          predicted.stride > std::numeric_limits<int32_t>::max() ||
          predicted.width > state->limits.max_dimension ||
          predicted.height > state->limits.max_dimension ||
          static_cast<uint64_t>(predicted.width) * (1u << inspection->pixel_shift) >
              static_cast<uint64_t>(predicted.stride)) {
        *error = "decoder returned malformed predicted-plane bounds";
        return BITSCOPE_H264_DECODE_ERROR;
      }
      frame.predicted_planes[plane] = {
          predicted.data, static_cast<int32_t>(predicted.stride),
          predicted.width, predicted.height};
      frame.predicted_plane_count = static_cast<uint8_t>(plane + 1);
    }
    const AVH264InspectionResidualPlane& residual = inspection->residual_planes[plane];
    if (residual.data != nullptr) {
      if (residual.width == 0 || residual.height == 0 || residual.stride_samples <= 0 ||
          residual.stride_samples > std::numeric_limits<int32_t>::max() ||
          residual.width > state->limits.max_dimension ||
          residual.height > state->limits.max_dimension ||
          residual.width > static_cast<uint64_t>(residual.stride_samples)) {
        *error = "decoder returned malformed residual-plane bounds";
        return BITSCOPE_H264_DECODE_ERROR;
      }
      frame.residual_planes[plane] = {
          residual.data, static_cast<int32_t>(residual.stride_samples),
          residual.width, residual.height};
      frame.residual_plane_count = static_cast<uint8_t>(plane + 1);
    }
    const AVH264InspectionPlane& pre_filter = inspection->pre_filter_planes[plane];
    if (pre_filter.data != nullptr) {
      if (pre_filter.width == 0 || pre_filter.height == 0 || pre_filter.stride <= 0 ||
          pre_filter.stride > std::numeric_limits<int32_t>::max() ||
          pre_filter.width > state->limits.max_dimension ||
          pre_filter.height > state->limits.max_dimension ||
          static_cast<uint64_t>(pre_filter.width) * (1u << inspection->pixel_shift) >
              static_cast<uint64_t>(pre_filter.stride)) {
        *error = "decoder returned malformed pre-filter-plane bounds";
        return BITSCOPE_H264_DECODE_ERROR;
      }
      frame.pre_filter_planes[plane] = {
          pre_filter.data, static_cast<int32_t>(pre_filter.stride),
          pre_filter.width, pre_filter.height};
      frame.pre_filter_plane_count = static_cast<uint8_t>(plane + 1);
    }
  }
  if (inspection->transform_block_count > state->limits.max_transform_blocks_per_frame ||
      inspection->coefficient_count > state->limits.max_coefficients_per_frame ||
      (inspection->transform_block_count != 0 && inspection->transform_blocks == nullptr) ||
      (inspection->coefficient_count != 0 && inspection->coefficients == nullptr)) {
    *error = "decoder inspection coefficients exceed the configured limit";
    return BITSCOPE_H264_LIMIT_EXCEEDED;
  }
  if (inspection->coefficient_count != 0) {
    state->coefficients.assign(
        inspection->coefficients,
        inspection->coefficients + inspection->coefficient_count);
  }
  state->transform_blocks.reserve(inspection->transform_block_count);
  for (uint32_t index = 0; index < inspection->transform_block_count; ++index) {
    const AVH264InspectionTransformBlock& source = inspection->transform_blocks[index];
    if (source.coefficient_offset > state->coefficients.size() ||
        source.coefficient_count > state->coefficients.size() - source.coefficient_offset) {
      *error = "decoder returned malformed transform coefficient offsets";
      return BITSCOPE_H264_DECODE_ERROR;
    }
    state->transform_blocks.push_back({
        source.x, source.y, source.width, source.height, source.plane,
        source.flags, {0, 0},
        state->coefficients.data() + source.coefficient_offset,
        source.coefficient_count});
  }
  frame.transform_blocks = state->transform_blocks.empty() ? nullptr : state->transform_blocks.data();
  frame.transform_block_count = static_cast<uint32_t>(state->transform_blocks.size());

  if (inspection->slice_count > state->limits.max_reference_slices_per_frame ||
      inspection->reference_count > state->limits.max_reference_entries_per_frame ||
      inspection->modification_count >
          state->limits.max_reference_modifications_per_frame ||
      inspection->dpb_entry_count > state->limits.max_dpb_entries_per_frame) {
    *error = "decoder reference metadata exceeds the configured limit";
    return BITSCOPE_H264_LIMIT_EXCEEDED;
  }
  if ((inspection->slice_count != 0 && inspection->slices == nullptr) ||
      (inspection->reference_count != 0 && inspection->references == nullptr) ||
      (inspection->modification_count != 0 && inspection->modifications == nullptr) ||
      (inspection->dpb_entry_count != 0 && inspection->dpb_entries == nullptr) ||
      !RangeWithin(inspection->post_marking_dpb_offset,
                   inspection->post_marking_dpb_count,
                   inspection->dpb_entry_count)) {
    *error = "decoder returned malformed H.264 reference metadata";
    return BITSCOPE_H264_DECODE_ERROR;
  }

  state->references.reserve(inspection->reference_count);
  for (uint32_t index = 0; index < inspection->reference_count; ++index) {
    const AVH264ReferenceEntry& source = inspection->references[index];
    if (source.list > 1 || source.index >= 32 ||
        source.short_term_slot < -1 || source.short_term_slot >= 32 ||
        source.long_term_slot < -1 || source.long_term_slot >= 32) {
      *error = "decoder returned malformed H.264 reference-list entry";
      return BITSCOPE_H264_DECODE_ERROR;
    }
    state->references.push_back({
        source.picture_id, source.frame_num, source.pic_id, source.poc,
        {source.field_poc[0], source.field_poc[1]}, source.short_term_slot,
        source.long_term_slot, source.list, source.index, source.reference,
        source.long_term});
  }
  state->reference_modifications.reserve(inspection->modification_count);
  for (uint32_t index = 0; index < inspection->modification_count; ++index) {
    const AVH264ReferenceModification& source = inspection->modifications[index];
    if (source.list > 1 || source.index >= 32 || source.operation > 3) {
      *error = "decoder returned malformed reference-list modification";
      return BITSCOPE_H264_DECODE_ERROR;
    }
    state->reference_modifications.push_back({
        source.value, source.list, source.index, source.operation, 0});
  }
  state->dpb_entries.reserve(inspection->dpb_entry_count);
  for (uint32_t index = 0; index < inspection->dpb_entry_count; ++index) {
    const AVH264DPBEntry& source = inspection->dpb_entries[index];
    const bool valid_slot =
        (source.slot_kind == AV_H264_DPB_SHORT_TERM && source.slot >= 0 &&
         source.slot < 32) ||
        (source.slot_kind == AV_H264_DPB_LONG_TERM && source.slot >= 0 &&
         source.slot < 32);
    if (!valid_slot) {
      *error = "decoder returned malformed DPB slot metadata";
      return BITSCOPE_H264_DECODE_ERROR;
    }
    state->dpb_entries.push_back({
        source.picture_id, source.frame_num, source.poc,
        {source.field_poc[0], source.field_poc[1]}, source.slot,
        source.slot_kind, source.reference, source.long_term,
        source.delayed_output, source.recovered, source.invalid_gap});
  }
  state->slices.reserve(inspection->slice_count);
  for (uint32_t index = 0; index < inspection->slice_count; ++index) {
    const AVH264SliceReferences& source = inspection->slices[index];
    if (source.list_count > 2 || source.ref_count[0] > 32 ||
        source.ref_count[1] > 32 ||
        !RangeWithin(source.reference_offset[0], source.ref_count[0],
                     state->references.size()) ||
        !RangeWithin(source.reference_offset[1], source.ref_count[1],
                     state->references.size()) ||
        !RangeWithin(source.modification_offset[0], source.modification_count[0],
                     state->reference_modifications.size()) ||
        !RangeWithin(source.modification_offset[1], source.modification_count[1],
                     state->reference_modifications.size()) ||
        !RangeWithin(source.dpb_offset, source.dpb_count,
                     state->dpb_entries.size())) {
      *error = "decoder returned malformed per-slice reference offsets";
      return BITSCOPE_H264_DECODE_ERROR;
    }
    for (uint32_t list = 0; list < 2; ++list) {
      for (uint32_t entry = 0; entry < source.ref_count[list]; ++entry) {
        const BitscopeH264ReferenceEntry& reference =
            state->references[source.reference_offset[list] + entry];
        if (reference.list != list || reference.index != entry) {
          *error = "decoder returned inconsistent H.264 reference-list ordering";
          return BITSCOPE_H264_DECODE_ERROR;
        }
      }
    }
    state->slices.push_back({
        source.slice_num, source.first_mb_addr, source.slice_type,
        source.picture_structure, source.list_count,
        {source.ref_count[0], source.ref_count[1]}, 0,
        {source.reference_offset[0], source.reference_offset[1]},
        {source.modification_offset[0], source.modification_offset[1]},
        {source.modification_count[0], source.modification_count[1]},
        source.dpb_offset, source.dpb_count});
  }
  frame.picture_id = inspection->picture_id;
  frame.frame_num = inspection->frame_num;
  frame.poc = inspection->poc;
  frame.field_poc[0] = inspection->field_poc[0];
  frame.field_poc[1] = inspection->field_poc[1];
  frame.slices = state->slices.empty() ? nullptr : state->slices.data();
  frame.slice_count = static_cast<uint32_t>(state->slices.size());
  frame.references = state->references.empty() ? nullptr : state->references.data();
  frame.reference_count = static_cast<uint32_t>(state->references.size());
  frame.reference_modifications = state->reference_modifications.empty() ?
      nullptr : state->reference_modifications.data();
  frame.reference_modification_count =
      static_cast<uint32_t>(state->reference_modifications.size());
  frame.dpb_entries = state->dpb_entries.empty() ? nullptr : state->dpb_entries.data();
  frame.dpb_entry_count = static_cast<uint32_t>(state->dpb_entries.size());
  frame.post_marking_dpb_offset = inspection->post_marking_dpb_offset;
  frame.post_marking_dpb_count = inspection->post_marking_dpb_count;
#endif

  const AVPixFmtDescriptor* descriptor = av_pix_fmt_desc_get(static_cast<AVPixelFormat>(decoded->format));
  for (uint32_t plane = 0; plane < 4 && decoded->data[plane] != nullptr; ++plane) {
    const bool chroma = (plane == 1 || plane == 2) && descriptor != nullptr;
    const uint32_t horizontal_shift = chroma ? descriptor->log2_chroma_w : 0;
    const uint32_t vertical_shift = chroma ? descriptor->log2_chroma_h : 0;
    frame.final_planes[plane] = {
        decoded->data[plane], decoded->linesize[plane],
        (frame.width + (1u << horizontal_shift) - 1u) >> horizontal_shift,
        (frame.height + (1u << vertical_shift) - 1u) >> vertical_shift};
    frame.final_plane_count = static_cast<uint8_t>(plane + 1);
  }
  if (descriptor != nullptr && descriptor->nb_components > 0) {
    frame.bit_depth = static_cast<uint8_t>(descriptor->comp[0].depth);
    if (frame.final_plane_count == 1) frame.pixel_layout = BITSCOPE_H264_PIXEL_I400;
    else if (descriptor->log2_chroma_w == 1 && descriptor->log2_chroma_h == 1) frame.pixel_layout = BITSCOPE_H264_PIXEL_I420;
    else if (descriptor->log2_chroma_w == 1 && descriptor->log2_chroma_h == 0) frame.pixel_layout = BITSCOPE_H264_PIXEL_I422;
    else if (descriptor->log2_chroma_w == 0 && descriptor->log2_chroma_h == 0) frame.pixel_layout = BITSCOPE_H264_PIXEL_I444;
    else frame.pixel_layout = BITSCOPE_H264_PIXEL_UNSUPPORTED;
  } else {
    frame.pixel_layout = BITSCOPE_H264_PIXEL_UNSUPPORTED;
  }

  state->frame_count += 1;
  if (state->observer->on_frame(&frame, state->observer->user_data) != 0) {
    *error = "inspection cancelled by frame observer";
    return BITSCOPE_H264_CANCELLED;
  }
  return BITSCOPE_H264_OK;
}

int DrainDecoder(AVCodecContext* codec_context, AVFrame* frame, DecodeState* state, std::string* error) {
  while (true) {
    const int result = avcodec_receive_frame(codec_context, frame);
    if (result == AVERROR(EAGAIN) || result == AVERROR_EOF) return BITSCOPE_H264_OK;
    if (result < 0) {
      *error = "H.264 frame decode failed: " + AvError(result);
      return BITSCOPE_H264_DECODE_ERROR;
    }
    const int inspection = InspectFrame(frame, state, error);
    av_frame_unref(frame);
    if (inspection != BITSCOPE_H264_OK) return inspection;
  }
}

int SendPacket(AVCodecContext* codec_context, AVFrame* frame, const uint8_t* data, int size, DecodeState* state, std::string* error) {
  AVPacket packet{};
  packet.data = const_cast<uint8_t*>(data);
  packet.size = size;
  const int result = avcodec_send_packet(codec_context, size == 0 ? nullptr : &packet);
  if (result < 0) {
    *error = "H.264 packet decode failed: " + AvError(result);
    return BITSCOPE_H264_DECODE_ERROR;
  }
  return DrainDecoder(codec_context, frame, state, error);
}

}  // namespace

extern "C" uint32_t bitscope_h264_inspector_abi_version(void) {
  return BITSCOPE_H264_INSPECTOR_ABI_VERSION;
}

extern "C" uint32_t bitscope_h264_inspector_available_stages(void) {
  return kAvailableStages;
}

extern "C" int bitscope_h264_inspect_annexb(
    const uint8_t* data, size_t size, const BitscopeH264Limits* limits,
    const BitscopeH264Observer* observer, char* error_message,
    size_t error_message_capacity) {
  WriteError(error_message, error_message_capacity, "");
  if (data == nullptr || size == 0 || observer == nullptr ||
      observer->struct_size < sizeof(BitscopeH264Observer) || observer->on_frame == nullptr ||
      (limits != nullptr && limits->struct_size < sizeof(BitscopeH264Limits))) {
    WriteError(error_message, error_message_capacity, "invalid H.264 inspector arguments");
    return BITSCOPE_H264_INVALID_ARGUMENT;
  }

  const BitscopeH264Limits resolved = ResolveLimits(limits);
  if (resolved.max_input_bytes == 0 || resolved.max_dimension == 0 ||
      resolved.max_pixels == 0 || resolved.max_frames == 0 ||
      resolved.max_motion_vectors_per_frame == 0 ||
      resolved.max_transform_blocks_per_frame == 0 ||
      resolved.max_coefficients_per_frame == 0 ||
      resolved.max_reference_slices_per_frame == 0 ||
      resolved.max_reference_entries_per_frame == 0 ||
      resolved.max_reference_modifications_per_frame == 0 ||
      resolved.max_dpb_entries_per_frame == 0) {
    WriteError(error_message, error_message_capacity, "H.264 inspector limits must be positive");
    return BITSCOPE_H264_INVALID_ARGUMENT;
  }
  if (resolved.max_transform_blocks_per_frame > kDefaultMaxTransformBlocks ||
      resolved.max_coefficients_per_frame > kDefaultMaxCoefficients ||
      resolved.max_reference_slices_per_frame > kDefaultMaxReferenceSlices ||
      resolved.max_reference_entries_per_frame > kDefaultMaxReferenceEntries ||
      resolved.max_reference_modifications_per_frame >
          kDefaultMaxReferenceModifications ||
      resolved.max_dpb_entries_per_frame > kDefaultMaxDpbEntries) {
    WriteError(error_message, error_message_capacity,
               "H.264 inspection limits exceed the inspector hard cap");
    return BITSCOPE_H264_LIMIT_EXCEEDED;
  }
  if (size > resolved.max_input_bytes || size > static_cast<size_t>(std::numeric_limits<int>::max())) {
    WriteError(error_message, error_message_capacity, "H.264 input exceeds the configured limit");
    return BITSCOPE_H264_LIMIT_EXCEEDED;
  }
  if (!HasAnnexBStartCode(data, size)) {
    WriteError(error_message, error_message_capacity, "input is not an H.264 Annex-B stream");
    return BITSCOPE_H264_INVALID_BITSTREAM;
  }

  try {
    const AVCodec* codec = avcodec_find_decoder(AV_CODEC_ID_H264);
    if (codec == nullptr) {
      WriteError(error_message, error_message_capacity, "FFmpeg H.264 decoder is unavailable");
      return BITSCOPE_H264_DECODER_UNAVAILABLE;
    }
    CodecContextPtr codec_context(avcodec_alloc_context3(codec));
    ParserPtr parser(av_parser_init(AV_CODEC_ID_H264));
    FramePtr frame(av_frame_alloc());
    if (!codec_context || !parser || !frame) {
      WriteError(error_message, error_message_capacity, "unable to allocate H.264 decoder state");
      return BITSCOPE_H264_OUT_OF_MEMORY;
    }
    codec_context->export_side_data |= AV_CODEC_EXPORT_DATA_MVS;
    codec_context->flags2 |= AV_CODEC_FLAG2_EXPORT_MVS;
    codec_context->thread_count = 1;
    codec_context->thread_type = 0;
#if BITSCOPE_HAS_FFMPEG_INSPECTION
    if (av_opt_set_int(codec_context->priv_data, "bitscope_inspection",
                       kNativeInspectionStages, 0) < 0 ||
        av_opt_set_int(codec_context->priv_data, "bitscope_max_transform_blocks",
                       resolved.max_transform_blocks_per_frame, 0) < 0 ||
        av_opt_set_int(codec_context->priv_data, "bitscope_max_coefficients",
                       resolved.max_coefficients_per_frame, 0) < 0 ||
        av_opt_set_int(codec_context->priv_data, "bitscope_max_reference_slices",
                       resolved.max_reference_slices_per_frame, 0) < 0 ||
        av_opt_set_int(codec_context->priv_data, "bitscope_max_reference_entries",
                       resolved.max_reference_entries_per_frame, 0) < 0 ||
        av_opt_set_int(codec_context->priv_data,
                       "bitscope_max_reference_modifications",
                       resolved.max_reference_modifications_per_frame, 0) < 0 ||
        av_opt_set_int(codec_context->priv_data, "bitscope_max_dpb_entries",
                       resolved.max_dpb_entries_per_frame, 0) < 0) {
      WriteError(error_message, error_message_capacity,
                 "bundled FFmpeg decoder does not support H.264 inspection hooks");
      return BITSCOPE_H264_DECODER_UNAVAILABLE;
    }
#endif
    const int open_result = avcodec_open2(codec_context.get(), codec, nullptr);
    if (open_result < 0) {
      WriteError(error_message, error_message_capacity, "unable to open FFmpeg H.264 decoder: " + AvError(open_result));
      return BITSCOPE_H264_DECODER_UNAVAILABLE;
    }

    std::vector<uint8_t> padded(size + AV_INPUT_BUFFER_PADDING_SIZE, 0);
    std::copy_n(data, size, padded.data());
    DecodeState state{resolved, observer, 0, {}, {}, {}, {}, {}, {}, {}};
    state.motion_vectors.reserve(std::min(static_cast<uint32_t>(4096), resolved.max_motion_vectors_per_frame));
    size_t offset = 0;
    std::string error;
    while (offset < size) {
      uint8_t* packet_data = nullptr;
      int packet_size = 0;
      const int consumed = av_parser_parse2(
          parser.get(), codec_context.get(), &packet_data, &packet_size,
          padded.data() + offset, static_cast<int>(size - offset),
          AV_NOPTS_VALUE, AV_NOPTS_VALUE, 0);
      if (consumed < 0) {
        WriteError(error_message, error_message_capacity, "H.264 parser rejected the Annex-B stream");
        return BITSCOPE_H264_INVALID_BITSTREAM;
      }
      if (consumed == 0 && packet_size == 0) {
        WriteError(error_message, error_message_capacity, "H.264 parser made no progress");
        return BITSCOPE_H264_INVALID_BITSTREAM;
      }
      offset += static_cast<size_t>(consumed);
      if (packet_size > 0) {
        const int decode = SendPacket(codec_context.get(), frame.get(), packet_data, packet_size, &state, &error);
        if (decode != BITSCOPE_H264_OK) {
          WriteError(error_message, error_message_capacity, error);
          return decode;
        }
      }
    }

    uint8_t* final_packet_data = nullptr;
    int final_packet_size = 0;
    const int parser_flush = av_parser_parse2(
        parser.get(), codec_context.get(), &final_packet_data, &final_packet_size,
        nullptr, 0, AV_NOPTS_VALUE, AV_NOPTS_VALUE, 0);
    if (parser_flush < 0) {
      WriteError(error_message, error_message_capacity, "H.264 parser flush failed");
      return BITSCOPE_H264_INVALID_BITSTREAM;
    }
    if (final_packet_size > 0) {
      const int decode = SendPacket(codec_context.get(), frame.get(), final_packet_data, final_packet_size, &state, &error);
      if (decode != BITSCOPE_H264_OK) {
        WriteError(error_message, error_message_capacity, error);
        return decode;
      }
    }
    const int flush = SendPacket(codec_context.get(), frame.get(), nullptr, 0, &state, &error);
    if (flush != BITSCOPE_H264_OK) {
      WriteError(error_message, error_message_capacity, error);
      return flush;
    }
    if (state.frame_count == 0) {
      WriteError(error_message, error_message_capacity, "H.264 stream produced no decoded frames");
      return BITSCOPE_H264_INVALID_BITSTREAM;
    }
    return BITSCOPE_H264_OK;
  } catch (const std::bad_alloc&) {
    WriteError(error_message, error_message_capacity, "H.264 inspection ran out of memory");
    return BITSCOPE_H264_OUT_OF_MEMORY;
  } catch (...) {
    WriteError(error_message, error_message_capacity, "unexpected H.264 inspector failure");
    return BITSCOPE_H264_DECODE_ERROR;
  }
}
