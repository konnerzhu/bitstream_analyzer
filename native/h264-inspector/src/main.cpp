#include "bitscope_h264_inspector.h"
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
  uint64_t motion_vectors = 0;
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

bool ExportFrame(const BitscopeH264Frame* frame, Summary* summary) {
  if (frame->pixel_layout == BITSCOPE_H264_PIXEL_UNSUPPORTED ||
      (frame->final_plane_count != 1 && frame->final_plane_count != 3) ||
      frame->bit_depth == 0 || frame->bit_depth > 16) {
    summary->export_error = "selected H.264 pixel format is not a supported planar YUV layout";
    return false;
  }
  const uint32_t bytes_per_sample = frame->bit_depth > 8 ? 2u : 1u;
  std::vector<bitscope::PlaneView> planes;
  planes.reserve(frame->final_plane_count);
  for (uint8_t index = 0; index < frame->final_plane_count; ++index) {
    const BitscopeH264Plane& plane = frame->final_planes[index];
    planes.push_back({plane.data, plane.stride, plane.width, plane.height, bytes_per_sample});
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
            << ",\"renderWidth\":" << frame->width << ",\"renderHeight\":" << frame->height
            << ",\"pixelLayout\":" << static_cast<uint32_t>(frame->pixel_layout)
            << ",\"bitDepth\":" << static_cast<uint32_t>(frame->bit_depth)
            << ",\"fullRange\":" << (frame->color_range == 2 ? "true" : "false")
            << ",\"matrixCoefficients\":" << frame->matrix_coefficients
            << ",\"littleEndian\":" << (std::endian::native == std::endian::little ? "true" : "false")
            << ",\"byteLength\":" << byte_length << ',';
  PrintPackedPlanes(records);
  std::cout << "}\n";
  summary->exported = std::cout.good();
  return summary->exported;
}

int PrintFrame(const BitscopeH264Frame* frame, void* user_data) {
  if (frame == nullptr || user_data == nullptr || frame->struct_size < sizeof(BitscopeH264Frame)) return 1;
  auto* summary = static_cast<Summary*>(user_data);
  summary->frames += 1;
  summary->motion_vectors += frame->motion_vector_count;
  if (!summary->arguments.export_frame) {
    std::cout << "{\"type\":\"frame\",\"index\":" << frame->decode_index
              << ",\"width\":" << frame->width << ",\"height\":" << frame->height
              << ",\"keyFrame\":" << (frame->key_frame ? "true" : "false")
              << ",\"pictureType\":" << frame->picture_type
              << ",\"pixelFormat\":" << frame->pixel_format
              << ",\"bitDepth\":" << static_cast<uint32_t>(frame->bit_depth)
              << ",\"planes\":" << static_cast<uint32_t>(frame->final_plane_count)
              << ",\"motionVectors\":" << frame->motion_vector_count
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
    std::cerr << "usage: bitscope-h264-inspect [--frame <index> --output <planes.bin>] <annex-b.h264>\n";
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
  BitscopeH264Limits limits{
      sizeof(BitscopeH264Limits), kCliMaxInputBytes, 8192u,
      8192ull * 4320ull, 10000u, 1000000u};
  BitscopeH264Observer observer{sizeof(BitscopeH264Observer), PrintFrame, &summary};
  char error[512]{};
  const int result = bitscope_h264_inspect_annexb(
      bytes.data(), bytes.size(), &limits, &observer, error, sizeof(error));
  if (!summary.export_error.empty()) {
    std::cerr << "error: " << summary.export_error << '\n';
    return 2;
  }
  if (result != BITSCOPE_H264_OK && !(result == BITSCOPE_H264_CANCELLED && summary.exported)) {
    std::cerr << "error " << result << ": " << error << '\n';
    return result;
  }
  if (arguments.export_frame && !summary.exported) {
    std::cerr << "error: selected frame was not produced by the decoder\n";
    return 2;
  }
  std::cout << "{\"type\":\"summary\",\"frames\":" << summary.frames
            << ",\"motionVectors\":" << summary.motion_vectors
            << ",\"abiVersion\":" << bitscope_h264_inspector_abi_version()
            << ",\"availableStages\":" << bitscope_h264_inspector_available_stages()
            << "}\n";
  return std::cout.good() ? 0 : 2;
}
