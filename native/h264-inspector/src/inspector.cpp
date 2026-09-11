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
#include <libavutil/error.h>
#include <libavutil/frame.h>
#include <libavutil/motion_vector.h>
#include <libavutil/pixdesc.h>
}

namespace {

constexpr size_t kDefaultMaxInputBytes = 64u * 1024u * 1024u;
constexpr uint32_t kDefaultMaxDimension = 8192u;
constexpr uint64_t kDefaultMaxPixels = 8192ull * 4320ull;
constexpr uint32_t kDefaultMaxFrames = 10000u;
constexpr uint32_t kDefaultMaxMotionVectors = 1000000u;
constexpr uint32_t kAvailableStages = BITSCOPE_H264_STAGE_FINAL_PIXELS | BITSCOPE_H264_STAGE_MOTION_VECTORS;

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
      kDefaultMaxPixels, kDefaultMaxFrames, kDefaultMaxMotionVectors};
  if (supplied == nullptr) return result;
  result.max_input_bytes = supplied->max_input_bytes;
  result.max_dimension = supplied->max_dimension;
  result.max_pixels = supplied->max_pixels;
  result.max_frames = supplied->max_frames;
  result.max_motion_vectors_per_frame = supplied->max_motion_vectors_per_frame;
  return result;
}

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
  frame.available_stages = kAvailableStages;
  frame.motion_vectors = state->motion_vectors.empty() ? nullptr : state->motion_vectors.data();
  frame.motion_vector_count = static_cast<uint32_t>(state->motion_vectors.size());

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
      resolved.max_motion_vectors_per_frame == 0) {
    WriteError(error_message, error_message_capacity, "H.264 inspector limits must be positive");
    return BITSCOPE_H264_INVALID_ARGUMENT;
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
    const int open_result = avcodec_open2(codec_context.get(), codec, nullptr);
    if (open_result < 0) {
      WriteError(error_message, error_message_capacity, "unable to open FFmpeg H.264 decoder: " + AvError(open_result));
      return BITSCOPE_H264_DECODER_UNAVAILABLE;
    }

    std::vector<uint8_t> padded(size + AV_INPUT_BUFFER_PADDING_SIZE, 0);
    std::copy_n(data, size, padded.data());
    DecodeState state{resolved, observer, 0, {}};
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
