#include "bitscope_av1_decoder.h"

#include <algorithm>
#include <cerrno>
#include <cstdio>
#include <limits>
#include <memory>
#include <new>
#include <string>
#include <string_view>
#include <system_error>

extern "C" {
#include <dav1d/dav1d.h>
}

namespace {

constexpr size_t kDefaultMaxInputBytes = 64u * 1024u * 1024u;
constexpr size_t kDefaultMaxTemporalUnitBytes = 64u * 1024u * 1024u;
constexpr uint32_t kDefaultMaxDimension = 8192u;
constexpr uint64_t kDefaultMaxPixels = 8192ull * 4320ull;
constexpr uint32_t kDefaultMaxFrames = 10000u;
constexpr uint32_t kDefaultMaxTemporalUnits = 10000u;
constexpr uint32_t kMaxThreads = 16u;
constexpr uint32_t kAvailableStages = BITSCOPE_AV1_STAGE_FINAL_PIXELS;

struct ContextDeleter {
  void operator()(Dav1dContext* context) const {
    dav1d_close(&context);
  }
};

using ContextPtr = std::unique_ptr<Dav1dContext, ContextDeleter>;

struct PictureHolder {
  Dav1dPicture picture{};
  ~PictureHolder() { dav1d_picture_unref(&picture); }
};

struct DataHolder {
  Dav1dData data{};
  ~DataHolder() { dav1d_data_unref(&data); }
};

struct DecodeState {
  BitscopeAv1Options options{};
  BitscopeAv1Limits limits{};
  const BitscopeAv1Observer* observer = nullptr;
  uint32_t frame_count = 0;
  uint32_t temporal_unit_count = 0;
};

void WriteError(char* destination, size_t capacity, std::string_view message) {
  if (destination == nullptr || capacity == 0) return;
  const size_t maximum = std::min(capacity - 1, static_cast<size_t>(std::numeric_limits<int>::max()));
  const size_t length = std::min(maximum, message.size());
  std::snprintf(destination, capacity, "%.*s", static_cast<int>(length), message.data());
}

std::string Dav1dError(int code) {
  const int positive = code < 0 ? -code : code;
  return std::error_code(positive, std::generic_category()).message();
}

uint16_t ReadLittle16(const uint8_t* data) {
  return static_cast<uint16_t>(data[0]) |
         static_cast<uint16_t>(static_cast<uint16_t>(data[1]) << 8u);
}

uint32_t ReadLittle32(const uint8_t* data) {
  return static_cast<uint32_t>(data[0]) |
         (static_cast<uint32_t>(data[1]) << 8u) |
         (static_cast<uint32_t>(data[2]) << 16u) |
         (static_cast<uint32_t>(data[3]) << 24u);
}

uint64_t ReadLittle64(const uint8_t* data) {
  return static_cast<uint64_t>(ReadLittle32(data)) |
         (static_cast<uint64_t>(ReadLittle32(data + 4)) << 32u);
}

bool IsIvf(const uint8_t* data, size_t size) {
  return size >= 4 && data[0] == 'D' && data[1] == 'K' && data[2] == 'I' && data[3] == 'F';
}

BitscopeAv1Options ResolveOptions(const BitscopeAv1Options* supplied) {
  BitscopeAv1Options result{
      sizeof(BitscopeAv1Options), BITSCOPE_AV1_INPUT_AUTO, 1u, 0u, 1u, {0u, 0u}};
  if (supplied == nullptr) return result;
  result.input_format = supplied->input_format;
  result.threads = supplied->threads;
  result.apply_film_grain = supplied->apply_film_grain;
  result.strict_standard_compliance = supplied->strict_standard_compliance;
  return result;
}

BitscopeAv1Limits ResolveLimits(const BitscopeAv1Limits* supplied) {
  BitscopeAv1Limits result{
      sizeof(BitscopeAv1Limits), kDefaultMaxInputBytes, kDefaultMaxTemporalUnitBytes,
      kDefaultMaxDimension, kDefaultMaxPixels, kDefaultMaxFrames,
      kDefaultMaxTemporalUnits};
  if (supplied == nullptr) return result;
  result.max_input_bytes = supplied->max_input_bytes;
  result.max_temporal_unit_bytes = supplied->max_temporal_unit_bytes;
  result.max_dimension = supplied->max_dimension;
  result.max_pixels = supplied->max_pixels;
  result.max_frames = supplied->max_frames;
  result.max_temporal_units = supplied->max_temporal_units;
  return result;
}

int ValidatePicture(const Dav1dPicture& picture, const DecodeState& state, std::string* error) {
  if (picture.p.w <= 0 || picture.p.h <= 0 ||
      static_cast<uint32_t>(picture.p.w) > state.limits.max_dimension ||
      static_cast<uint32_t>(picture.p.h) > state.limits.max_dimension) {
    *error = "decoded AV1 frame dimensions exceed the configured limit";
    return BITSCOPE_AV1_LIMIT_EXCEEDED;
  }
  const uint64_t pixels = static_cast<uint64_t>(picture.p.w) * static_cast<uint64_t>(picture.p.h);
  if (pixels > state.limits.max_pixels) {
    *error = "decoded AV1 frame pixel count exceeds the configured limit";
    return BITSCOPE_AV1_LIMIT_EXCEEDED;
  }
  if (state.frame_count >= state.limits.max_frames) {
    *error = "decoded AV1 frame count exceeds the configured limit";
    return BITSCOPE_AV1_LIMIT_EXCEEDED;
  }
  if (picture.p.layout < DAV1D_PIXEL_LAYOUT_I400 || picture.p.layout > DAV1D_PIXEL_LAYOUT_I444 ||
      (picture.p.bpc != 8 && picture.p.bpc != 10 && picture.p.bpc != 12) ||
      picture.data[0] == nullptr || picture.stride[0] <= 0 ||
      (picture.p.layout != DAV1D_PIXEL_LAYOUT_I400 &&
       (picture.data[1] == nullptr || picture.data[2] == nullptr || picture.stride[1] <= 0))) {
    *error = "dav1d returned an unsupported or malformed picture layout";
    return BITSCOPE_AV1_DECODE_ERROR;
  }
  return BITSCOPE_AV1_OK;
}

int InspectPicture(const Dav1dPicture& picture, DecodeState* state, std::string* error) {
  const int validation = ValidatePicture(picture, *state, error);
  if (validation != BITSCOPE_AV1_OK) return validation;

  BitscopeAv1Frame frame{};
  frame.struct_size = sizeof(BitscopeAv1Frame);
  frame.decode_index = state->frame_count;
  frame.width = static_cast<uint32_t>(picture.p.w);
  frame.height = static_cast<uint32_t>(picture.p.h);
  frame.render_width = frame.width;
  frame.render_height = frame.height;
  frame.presentation_timestamp = picture.m.timestamp;
  frame.duration = picture.m.duration;
  frame.frame_type = -1;
  frame.pixel_layout = picture.p.layout;
  frame.color_primaries = -1;
  frame.transfer_characteristics = -1;
  frame.matrix_coefficients = -1;
  frame.bit_depth = static_cast<uint8_t>(picture.p.bpc);
  frame.available_stages = kAvailableStages;

  if (picture.frame_hdr != nullptr) {
    frame.frame_type = picture.frame_hdr->frame_type;
    frame.key_frame = picture.frame_hdr->frame_type == DAV1D_FRAME_TYPE_KEY ? 1u : 0u;
    frame.show_frame = picture.frame_hdr->show_frame;
    frame.show_existing_frame = picture.frame_hdr->show_existing_frame;
    frame.temporal_id = picture.frame_hdr->temporal_id;
    frame.spatial_id = picture.frame_hdr->spatial_id;
    frame.film_grain_present = picture.frame_hdr->film_grain.present;
    frame.film_grain_applied =
        state->options.apply_film_grain != 0 && picture.frame_hdr->film_grain.present != 0 ? 1u : 0u;
    if (picture.frame_hdr->render_width > 0 && picture.frame_hdr->render_height > 0) {
      const uint64_t render_pixels = static_cast<uint64_t>(picture.frame_hdr->render_width) *
                                     static_cast<uint64_t>(picture.frame_hdr->render_height);
      if (static_cast<uint32_t>(picture.frame_hdr->render_width) > state->limits.max_dimension ||
          static_cast<uint32_t>(picture.frame_hdr->render_height) > state->limits.max_dimension ||
          render_pixels > state->limits.max_pixels) {
        *error = "decoded AV1 render dimensions exceed the configured limit";
        return BITSCOPE_AV1_LIMIT_EXCEEDED;
      }
      frame.render_width = static_cast<uint32_t>(picture.frame_hdr->render_width);
      frame.render_height = static_cast<uint32_t>(picture.frame_hdr->render_height);
    }
  }
  if (picture.seq_hdr != nullptr) {
    frame.color_primaries = picture.seq_hdr->pri;
    frame.transfer_characteristics = picture.seq_hdr->trc;
    frame.matrix_coefficients = picture.seq_hdr->mtrx;
    frame.full_range = picture.seq_hdr->color_range;
  }

  frame.plane_count = picture.p.layout == DAV1D_PIXEL_LAYOUT_I400 ? 1u : 3u;
  for (uint8_t plane = 0; plane < frame.plane_count; ++plane) {
    uint32_t plane_width = frame.width;
    uint32_t plane_height = frame.height;
    if (plane > 0 && picture.p.layout != DAV1D_PIXEL_LAYOUT_I444) {
      plane_width = (plane_width + 1u) / 2u;
      if (picture.p.layout == DAV1D_PIXEL_LAYOUT_I420) plane_height = (plane_height + 1u) / 2u;
    }
    frame.final_planes[plane] = {
        picture.data[plane], static_cast<int64_t>(picture.stride[plane == 0 ? 0 : 1]),
        plane_width, plane_height};
  }

  state->frame_count += 1;
  if (state->observer->on_frame(&frame, state->observer->user_data) != 0) {
    *error = "AV1 decoding cancelled by frame observer";
    return BITSCOPE_AV1_CANCELLED;
  }
  return BITSCOPE_AV1_OK;
}

int DrainDecoder(Dav1dContext* context, DecodeState* state, bool* produced_picture, std::string* error) {
  while (true) {
    PictureHolder output;
    const int result = dav1d_get_picture(context, &output.picture);
    if (result == DAV1D_ERR(EAGAIN)) return BITSCOPE_AV1_OK;
    if (result < 0) {
      *error = "dav1d failed to output an AV1 picture: " + Dav1dError(result);
      return result == DAV1D_ERR(ENOMEM) ? BITSCOPE_AV1_OUT_OF_MEMORY : BITSCOPE_AV1_DECODE_ERROR;
    }
    *produced_picture = true;
    const int inspection = InspectPicture(output.picture, state, error);
    if (inspection != BITSCOPE_AV1_OK) return inspection;
  }
}

int SendTemporalUnit(
    Dav1dContext* context, const uint8_t* bytes, size_t size, int64_t timestamp,
    int64_t offset, DecodeState* state, std::string* error) {
  if (size == 0) {
    *error = "AV1 temporal unit is empty";
    return BITSCOPE_AV1_INVALID_BITSTREAM;
  }
  if (size > state->limits.max_temporal_unit_bytes) {
    *error = "AV1 temporal unit exceeds the configured limit";
    return BITSCOPE_AV1_LIMIT_EXCEEDED;
  }
  if (state->temporal_unit_count >= state->limits.max_temporal_units) {
    *error = "AV1 temporal-unit count exceeds the configured limit";
    return BITSCOPE_AV1_LIMIT_EXCEEDED;
  }
  state->temporal_unit_count += 1;

  DataHolder input;
  uint8_t* destination = dav1d_data_create(&input.data, size);
  if (destination == nullptr) {
    *error = "unable to allocate dav1d input data";
    return BITSCOPE_AV1_OUT_OF_MEMORY;
  }
  std::copy_n(bytes, size, destination);
  input.data.m.timestamp = timestamp;
  input.data.m.duration = 0;
  input.data.m.offset = offset;
  input.data.m.size = size;

  while (input.data.sz > 0) {
    const int send_result = dav1d_send_data(context, &input.data);
    if (send_result < 0 && send_result != DAV1D_ERR(EAGAIN)) {
      *error = "dav1d rejected AV1 input: " + Dav1dError(send_result);
      if (send_result == DAV1D_ERR(ENOMEM)) return BITSCOPE_AV1_OUT_OF_MEMORY;
      return BITSCOPE_AV1_INVALID_BITSTREAM;
    }
    bool produced_picture = false;
    const int drain = DrainDecoder(context, state, &produced_picture, error);
    if (drain != BITSCOPE_AV1_OK) return drain;
    if (send_result == DAV1D_ERR(EAGAIN) && !produced_picture) {
      *error = "dav1d made no progress while consuming AV1 input";
      return BITSCOPE_AV1_DECODE_ERROR;
    }
  }
  return BITSCOPE_AV1_OK;
}

int DecodeIvf(const uint8_t* data, size_t size, Dav1dContext* context, DecodeState* state, std::string* error) {
  if (size < 32 || !IsIvf(data, size)) {
    *error = "input is not an IVF stream";
    return BITSCOPE_AV1_INVALID_BITSTREAM;
  }
  const uint16_t version = ReadLittle16(data + 4);
  const uint16_t header_size = ReadLittle16(data + 6);
  if (version != 0 || header_size < 32 || static_cast<size_t>(header_size) > size) {
    *error = "IVF header version or size is invalid";
    return BITSCOPE_AV1_INVALID_BITSTREAM;
  }
  if (data[8] != 'A' || data[9] != 'V' || data[10] != '0' || data[11] != '1') {
    *error = "IVF stream does not contain AV1 video";
    return BITSCOPE_AV1_INVALID_BITSTREAM;
  }
  const uint32_t declared_width = ReadLittle16(data + 12);
  const uint32_t declared_height = ReadLittle16(data + 14);
  if (declared_width == 0 || declared_height == 0) {
    *error = "IVF dimensions are invalid";
    return BITSCOPE_AV1_INVALID_BITSTREAM;
  }
  if (declared_width > state->limits.max_dimension || declared_height > state->limits.max_dimension ||
      static_cast<uint64_t>(declared_width) * declared_height > state->limits.max_pixels) {
    *error = "IVF dimensions exceed the configured limit";
    return BITSCOPE_AV1_LIMIT_EXCEEDED;
  }

  size_t cursor = header_size;
  uint32_t packet_count = 0;
  while (cursor < size) {
    if (size - cursor < 12) {
      *error = "IVF frame header is truncated";
      return BITSCOPE_AV1_INVALID_BITSTREAM;
    }
    const uint32_t packet_size = ReadLittle32(data + cursor);
    const uint64_t raw_timestamp = ReadLittle64(data + cursor + 4);
    const size_t payload_offset = cursor + 12;
    if (packet_size == 0 || static_cast<size_t>(packet_size) > size - payload_offset) {
      *error = "IVF frame payload exceeds the input boundary";
      return BITSCOPE_AV1_INVALID_BITSTREAM;
    }
    const int64_t timestamp = raw_timestamp <= static_cast<uint64_t>(std::numeric_limits<int64_t>::max())
                                  ? static_cast<int64_t>(raw_timestamp)
                                  : std::numeric_limits<int64_t>::min();
    const int decode = SendTemporalUnit(
        context, data + payload_offset, packet_size, timestamp,
        static_cast<int64_t>(payload_offset), state, error);
    if (decode != BITSCOPE_AV1_OK) return decode;
    cursor = payload_offset + packet_size;
    packet_count += 1;
  }
  if (packet_count == 0) {
    *error = "IVF stream contains no frames";
    return BITSCOPE_AV1_INVALID_BITSTREAM;
  }
  return BITSCOPE_AV1_OK;
}

int DecodeLowOverheadObu(
    const uint8_t* data, size_t size, Dav1dContext* context,
    DecodeState* state, std::string* error) {
  if (size == 0 || (data[0] & 0x80u) != 0 || ((data[0] >> 3u) & 0x0fu) == 0u) {
    *error = "input is not a valid low-overhead AV1 OBU stream";
    return BITSCOPE_AV1_INVALID_BITSTREAM;
  }
  return SendTemporalUnit(
      context, data, size, std::numeric_limits<int64_t>::min(), 0, state, error);
}

}  // namespace

extern "C" uint32_t bitscope_av1_decoder_abi_version(void) {
  return BITSCOPE_AV1_DECODER_ABI_VERSION;
}

extern "C" uint32_t bitscope_av1_decoder_available_stages(void) {
  return kAvailableStages;
}

extern "C" int bitscope_av1_decode(
    const uint8_t* data, size_t size, const BitscopeAv1Options* options,
    const BitscopeAv1Limits* limits, const BitscopeAv1Observer* observer,
    char* error_message, size_t error_message_capacity) {
  WriteError(error_message, error_message_capacity, "");
  if (data == nullptr || size == 0 || observer == nullptr ||
      observer->struct_size < sizeof(BitscopeAv1Observer) || observer->on_frame == nullptr ||
      (options != nullptr && options->struct_size < sizeof(BitscopeAv1Options)) ||
      (limits != nullptr && limits->struct_size < sizeof(BitscopeAv1Limits))) {
    WriteError(error_message, error_message_capacity, "invalid AV1 decoder arguments");
    return BITSCOPE_AV1_INVALID_ARGUMENT;
  }

  const BitscopeAv1Options resolved_options = ResolveOptions(options);
  const BitscopeAv1Limits resolved_limits = ResolveLimits(limits);
  if (resolved_options.input_format > BITSCOPE_AV1_INPUT_LOW_OVERHEAD_OBU ||
      resolved_options.threads == 0 || resolved_options.threads > kMaxThreads ||
      resolved_options.apply_film_grain > 1 || resolved_options.strict_standard_compliance > 1) {
    WriteError(error_message, error_message_capacity, "AV1 decoder options are outside the supported range");
    return BITSCOPE_AV1_INVALID_ARGUMENT;
  }
  if (resolved_limits.max_input_bytes == 0 || resolved_limits.max_temporal_unit_bytes == 0 ||
      resolved_limits.max_dimension == 0 || resolved_limits.max_pixels == 0 ||
      resolved_limits.max_pixels > std::numeric_limits<unsigned>::max() ||
      resolved_limits.max_frames == 0 || resolved_limits.max_temporal_units == 0) {
    WriteError(error_message, error_message_capacity, "AV1 decoder limits must be positive and representable");
    return BITSCOPE_AV1_INVALID_ARGUMENT;
  }
  if (size > resolved_limits.max_input_bytes) {
    WriteError(error_message, error_message_capacity, "AV1 input exceeds the configured limit");
    return BITSCOPE_AV1_LIMIT_EXCEEDED;
  }

  try {
    Dav1dSettings settings{};
    dav1d_default_settings(&settings);
    settings.n_threads = static_cast<int>(resolved_options.threads);
    settings.max_frame_delay = 1;
    settings.apply_grain = resolved_options.apply_film_grain;
    settings.all_layers = 0;
    settings.frame_size_limit = static_cast<unsigned>(resolved_limits.max_pixels);
    settings.strict_std_compliance = resolved_options.strict_standard_compliance;
    settings.logger.callback = nullptr;

    Dav1dContext* raw_context = nullptr;
    const int open_result = dav1d_open(&raw_context, &settings);
    ContextPtr context(raw_context);
    if (open_result < 0 || !context) {
      const std::string message = open_result < 0 ? Dav1dError(open_result) : "no decoder context";
      WriteError(error_message, error_message_capacity, "unable to open dav1d: " + message);
      return open_result == DAV1D_ERR(ENOMEM) ? BITSCOPE_AV1_OUT_OF_MEMORY : BITSCOPE_AV1_DECODER_UNAVAILABLE;
    }

    DecodeState state{resolved_options, resolved_limits, observer, 0, 0};
    std::string error;
    uint32_t input_format = resolved_options.input_format;
    if (input_format == BITSCOPE_AV1_INPUT_AUTO) {
      input_format = IsIvf(data, size) ? BITSCOPE_AV1_INPUT_IVF : BITSCOPE_AV1_INPUT_LOW_OVERHEAD_OBU;
    }
    const int decode = input_format == BITSCOPE_AV1_INPUT_IVF
                           ? DecodeIvf(data, size, context.get(), &state, &error)
                           : DecodeLowOverheadObu(data, size, context.get(), &state, &error);
    if (decode != BITSCOPE_AV1_OK) {
      WriteError(error_message, error_message_capacity, error);
      return decode;
    }

    bool produced_picture = false;
    const int drain = DrainDecoder(context.get(), &state, &produced_picture, &error);
    if (drain != BITSCOPE_AV1_OK) {
      WriteError(error_message, error_message_capacity, error);
      return drain;
    }
    if (state.frame_count == 0) {
      WriteError(error_message, error_message_capacity, "AV1 stream produced no decoded frames");
      return BITSCOPE_AV1_INVALID_BITSTREAM;
    }
    return BITSCOPE_AV1_OK;
  } catch (const std::bad_alloc&) {
    WriteError(error_message, error_message_capacity, "AV1 decoding ran out of memory");
    return BITSCOPE_AV1_OUT_OF_MEMORY;
  } catch (...) {
    WriteError(error_message, error_message_capacity, "unexpected AV1 decoder failure");
    return BITSCOPE_AV1_DECODE_ERROR;
  }
}
