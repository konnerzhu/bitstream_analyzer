#include "bitscope_av1_decoder.h"
#include "frame_dump.h"

#include <bit>
#include <charconv>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <string>
#include <string_view>
#include <vector>

namespace {

constexpr size_t kCliMaxInputBytes = 64u * 1024u * 1024u;
constexpr uint64_t kCliMaxOutputBytes = 64u * 1024u * 1024u;

struct Arguments {
  const char* input_path = nullptr;
  std::string output_path;
  uint32_t target_frame = 0;
  bool export_frame = false;
};

struct Summary {
  uint32_t frames = 0;
  uint32_t key_frames = 0;
  Arguments arguments;
  bool exported = false;
  std::string export_error;
};

bool ParseFrameIndex(std::string_view text, uint32_t* value) {
  if (text.empty() || value == nullptr) return false;
  const auto result = std::from_chars(text.data(), text.data() + text.size(), *value);
  return result.ec == std::errc{} && result.ptr == text.data() + text.size();
}

bool ParseArguments(int argc, char** argv, Arguments* arguments) {
  if (arguments == nullptr || argv == nullptr) return false;
  if (argc == 2 && argv[1] != nullptr) {
    arguments->input_path = argv[1];
    return true;
  }
  if (argc == 6 && argv[1] != nullptr && argv[2] != nullptr && argv[3] != nullptr &&
      argv[4] != nullptr && argv[5] != nullptr && std::string_view(argv[1]) == "--frame" &&
      std::string_view(argv[3]) == "--output" && ParseFrameIndex(argv[2], &arguments->target_frame) &&
      argv[4][0] != '\0') {
    arguments->output_path = argv[4];
    arguments->input_path = argv[5];
    arguments->export_frame = true;
    return true;
  }
  return false;
}

void PrintPackedPlanes(const std::vector<bitscope::PackedPlane>& planes) {
  std::cout << "\"planes\":[";
  for (size_t index = 0; index < planes.size(); ++index) {
    if (index != 0) std::cout << ',';
    const bitscope::PackedPlane& plane = planes[index];
    std::cout << "{\"offset\":" << plane.offset
              << ",\"length\":" << plane.length
              << ",\"rowBytes\":" << plane.row_bytes
              << ",\"width\":" << plane.width
              << ",\"height\":" << plane.height << '}';
  }
  std::cout << ']';
}

bool ExportFrame(const BitscopeAv1Frame* frame, Summary* summary) {
  if ((frame->plane_count != 1 && frame->plane_count != 3) ||
      frame->pixel_layout < BITSCOPE_AV1_PIXEL_I400 || frame->pixel_layout > BITSCOPE_AV1_PIXEL_I444 ||
      frame->bit_depth == 0 || frame->bit_depth > 16) {
    summary->export_error = "selected AV1 pixel format is not a supported planar YUV layout";
    return false;
  }
  const uint32_t bytes_per_sample = frame->bit_depth > 8 ? 2u : 1u;
  std::vector<bitscope::PlaneView> planes;
  planes.reserve(frame->plane_count);
  for (uint8_t index = 0; index < frame->plane_count; ++index) {
    const BitscopeAv1Plane& plane = frame->final_planes[index];
    planes.push_back({
        static_cast<const uint8_t*>(plane.data), plane.stride_bytes,
        plane.width, plane.height, bytes_per_sample});
  }
  std::vector<bitscope::PackedPlane> records;
  if (!bitscope::WritePackedPlanes(
          summary->arguments.output_path, planes, kCliMaxOutputBytes, &records, &summary->export_error)) {
    return false;
  }
  uint64_t byte_length = 0;
  for (const bitscope::PackedPlane& record : records) byte_length += record.length;
  std::cout << "{\"type\":\"selectedFrame\",\"index\":" << frame->decode_index
            << ",\"width\":" << frame->width << ",\"height\":" << frame->height
            << ",\"renderWidth\":" << frame->render_width
            << ",\"renderHeight\":" << frame->render_height
            << ",\"pixelLayout\":" << frame->pixel_layout
            << ",\"bitDepth\":" << static_cast<uint32_t>(frame->bit_depth)
            << ",\"fullRange\":" << (frame->full_range ? "true" : "false")
            << ",\"matrixCoefficients\":" << frame->matrix_coefficients
            << ",\"littleEndian\":" << (std::endian::native == std::endian::little ? "true" : "false")
            << ",\"byteLength\":" << byte_length << ',';
  PrintPackedPlanes(records);
  std::cout << "}\n";
  summary->exported = std::cout.good();
  return summary->exported;
}

int PrintFrame(const BitscopeAv1Frame* frame, void* user_data) {
  if (frame == nullptr || user_data == nullptr || frame->struct_size < sizeof(BitscopeAv1Frame)) return 1;
  auto* summary = static_cast<Summary*>(user_data);
  summary->frames += 1;
  summary->key_frames += frame->key_frame != 0 ? 1u : 0u;
  if (!summary->arguments.export_frame) {
    std::cout << "{\"type\":\"frame\",\"index\":" << frame->decode_index
              << ",\"width\":" << frame->width << ",\"height\":" << frame->height
              << ",\"renderWidth\":" << frame->render_width
              << ",\"renderHeight\":" << frame->render_height
              << ",\"keyFrame\":" << (frame->key_frame ? "true" : "false")
              << ",\"frameType\":" << frame->frame_type
              << ",\"pixelLayout\":" << frame->pixel_layout
              << ",\"bitDepth\":" << static_cast<uint32_t>(frame->bit_depth)
              << ",\"planes\":" << static_cast<uint32_t>(frame->plane_count)
              << ",\"timestamp\":" << frame->presentation_timestamp
              << ",\"filmGrainApplied\":" << (frame->film_grain_applied ? "true" : "false")
              << ",\"availableStages\":" << frame->available_stages << "}\n";
    if (!std::cout.good()) return 1;
  }
  if (summary->arguments.export_frame && frame->decode_index == summary->arguments.target_frame) {
    ExportFrame(frame, summary);
    return 1;
  }
  return 0;
}

bool ReadFile(const char* path, std::vector<uint8_t>* bytes, std::string* error) {
  std::ifstream input(path, std::ios::binary | std::ios::ate);
  if (!input) {
    *error = "unable to open input file";
    return false;
  }
  const std::streampos end = input.tellg();
  if (end <= std::streampos(0)) {
    *error = "input must be between 1 byte and 64 MiB";
    return false;
  }
  const std::streamoff length = end;
  if (static_cast<uint64_t>(length) > kCliMaxInputBytes) {
    *error = "input must be between 1 byte and 64 MiB";
    return false;
  }
  const size_t size = static_cast<size_t>(length);
  bytes->resize(size);
  input.seekg(0, std::ios::beg);
  input.read(reinterpret_cast<char*>(bytes->data()), static_cast<std::streamsize>(size));
  if (!input || static_cast<size_t>(input.gcount()) != size) {
    *error = "unable to read the complete input file";
    return false;
  }
  return true;
}

}  // namespace

int main(int argc, char** argv) {
  Arguments arguments;
  if (!ParseArguments(argc, argv, &arguments)) {
    std::cerr << "usage: bitscope-av1-decode [--frame <index> --output <planes.bin>] <stream.ivf|stream.obu>\n";
    return 2;
  }
  std::vector<uint8_t> bytes;
  std::string file_error;
  if (!ReadFile(arguments.input_path, &bytes, &file_error)) {
    std::cerr << "error: " << file_error << '\n';
    return 2;
  }

  Summary summary;
  summary.arguments = arguments;
  BitscopeAv1Options options{
      sizeof(BitscopeAv1Options), BITSCOPE_AV1_INPUT_AUTO, 1u, 0u, 1u, {0u, 0u}};
  BitscopeAv1Limits limits{
      sizeof(BitscopeAv1Limits), kCliMaxInputBytes, kCliMaxInputBytes,
      8192u, 8192ull * 4320ull, 10000u, 10000u};
  BitscopeAv1Observer observer{sizeof(BitscopeAv1Observer), PrintFrame, &summary};
  char error[512]{};
  const int result = bitscope_av1_decode(
      bytes.data(), bytes.size(), &options, &limits, &observer, error, sizeof(error));
  if (!summary.export_error.empty()) {
    std::cerr << "error: " << summary.export_error << '\n';
    return 2;
  }
  if (result != BITSCOPE_AV1_OK && !(result == BITSCOPE_AV1_CANCELLED && summary.exported)) {
    std::cerr << "error " << result << ": " << error << '\n';
    return result;
  }
  if (arguments.export_frame && !summary.exported) {
    std::cerr << "error: selected frame was not produced by the decoder\n";
    return 2;
  }
  std::cout << "{\"type\":\"summary\",\"frames\":" << summary.frames
            << ",\"keyFrames\":" << summary.key_frames
            << ",\"abiVersion\":" << bitscope_av1_decoder_abi_version()
            << ",\"availableStages\":" << bitscope_av1_decoder_available_stages()
            << "}\n";
  return std::cout.good() ? 0 : 2;
}
