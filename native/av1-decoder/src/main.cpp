#include "bitscope_av1_decoder.h"

#include <cstdint>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

namespace {

constexpr size_t kCliMaxInputBytes = 64u * 1024u * 1024u;

struct Summary {
  uint32_t frames = 0;
  uint32_t key_frames = 0;
};

int PrintFrame(const BitscopeAv1Frame* frame, void* user_data) {
  if (frame == nullptr || user_data == nullptr || frame->struct_size < sizeof(BitscopeAv1Frame)) return 1;
  auto* summary = static_cast<Summary*>(user_data);
  summary->frames += 1;
  summary->key_frames += frame->key_frame != 0 ? 1u : 0u;
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
    std::cerr << "usage: bitscope-av1-decode <stream.ivf|stream.obu>\n";
    return 2;
  }
  std::vector<uint8_t> bytes;
  std::string file_error;
  if (!ReadFile(argv[1], &bytes, &file_error)) {
    std::cerr << "error: " << file_error << '\n';
    return 2;
  }

  Summary summary;
  BitscopeAv1Options options{
      sizeof(BitscopeAv1Options), BITSCOPE_AV1_INPUT_AUTO, 1u, 0u, 1u, {0u, 0u}};
  BitscopeAv1Limits limits{
      sizeof(BitscopeAv1Limits), kCliMaxInputBytes, kCliMaxInputBytes,
      8192u, 8192ull * 4320ull, 10000u, 10000u};
  BitscopeAv1Observer observer{sizeof(BitscopeAv1Observer), PrintFrame, &summary};
  char error[512]{};
  const int result = bitscope_av1_decode(
      bytes.data(), bytes.size(), &options, &limits, &observer, error, sizeof(error));
  if (result != BITSCOPE_AV1_OK) {
    std::cerr << "error " << result << ": " << error << '\n';
    return result;
  }
  std::cout << "{\"type\":\"summary\",\"frames\":" << summary.frames
            << ",\"keyFrames\":" << summary.key_frames
            << ",\"abiVersion\":" << bitscope_av1_decoder_abi_version()
            << ",\"availableStages\":" << bitscope_av1_decoder_available_stages()
            << "}\n";
  return std::cout.good() ? 0 : 2;
}
