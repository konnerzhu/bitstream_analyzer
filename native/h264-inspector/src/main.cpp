#include "bitscope_h264_inspector.h"

#include <cstdint>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

namespace {

constexpr size_t kCliMaxInputBytes = 64u * 1024u * 1024u;

struct Summary {
  uint32_t frames = 0;
  uint64_t motion_vectors = 0;
};

int PrintFrame(const BitscopeH264Frame* frame, void* user_data) {
  if (frame == nullptr || user_data == nullptr || frame->struct_size < sizeof(BitscopeH264Frame)) return 1;
  auto* summary = static_cast<Summary*>(user_data);
  summary->frames += 1;
  summary->motion_vectors += frame->motion_vector_count;
  std::cout << "{\"type\":\"frame\",\"index\":" << frame->decode_index
            << ",\"width\":" << frame->width << ",\"height\":" << frame->height
            << ",\"keyFrame\":" << (frame->key_frame ? "true" : "false")
            << ",\"pictureType\":" << frame->picture_type
            << ",\"pixelFormat\":" << frame->pixel_format
            << ",\"planes\":" << static_cast<uint32_t>(frame->final_plane_count)
            << ",\"motionVectors\":" << frame->motion_vector_count
            << ",\"availableStages\":" << frame->available_stages << "}\n";
  return std::cout.good() ? 0 : 1;
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
  if (argc != 2 || argv == nullptr || argv[1] == nullptr) {
    std::cerr << "usage: bitscope-h264-inspect <annex-b.h264>\n";
    return 2;
  }
  std::vector<uint8_t> bytes;
  std::string file_error;
  if (!ReadFile(argv[1], &bytes, &file_error)) {
    std::cerr << "error: " << file_error << '\n';
    return 2;
  }

  Summary summary;
  BitscopeH264Limits limits{
      sizeof(BitscopeH264Limits), kCliMaxInputBytes, 8192u,
      8192ull * 4320ull, 10000u, 1000000u};
  BitscopeH264Observer observer{sizeof(BitscopeH264Observer), PrintFrame, &summary};
  char error[512]{};
  const int result = bitscope_h264_inspect_annexb(
      bytes.data(), bytes.size(), &limits, &observer, error, sizeof(error));
  if (result != BITSCOPE_H264_OK) {
    std::cerr << "error " << result << ": " << error << '\n';
    return result;
  }
  std::cout << "{\"type\":\"summary\",\"frames\":" << summary.frames
            << ",\"motionVectors\":" << summary.motion_vectors
            << ",\"abiVersion\":" << bitscope_h264_inspector_abi_version()
            << ",\"availableStages\":" << bitscope_h264_inspector_available_stages()
            << "}\n";
  return std::cout.good() ? 0 : 2;
}
