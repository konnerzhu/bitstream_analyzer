#ifndef BITSCOPE_NATIVE_FRAME_DUMP_H_
#define BITSCOPE_NATIVE_FRAME_DUMP_H_

#include <cstddef>
#include <cstdint>
#include <fstream>
#include <limits>
#include <string>
#include <vector>

namespace bitscope {

struct PlaneView {
  const uint8_t* data;
  int64_t stride_bytes;
  uint32_t width;
  uint32_t height;
  uint32_t bytes_per_sample;
};

struct PackedPlane {
  uint64_t offset;
  uint64_t length;
  uint32_t row_bytes;
  uint32_t width;
  uint32_t height;
};

inline bool CheckedMultiply(uint64_t left, uint64_t right, uint64_t* result) {
  if (result == nullptr || (right != 0 && left > std::numeric_limits<uint64_t>::max() / right)) return false;
  *result = left * right;
  return true;
}

inline bool WritePackedPlanes(
    const std::string& path,
    const std::vector<PlaneView>& planes,
    uint64_t maximum_bytes,
    std::vector<PackedPlane>* records,
    std::string* error) {
  if (path.empty() || planes.empty() || records == nullptr || error == nullptr) return false;
  records->clear();
  uint64_t total = 0;
  for (const PlaneView& plane : planes) {
    if (plane.data == nullptr || plane.width == 0 || plane.height == 0 ||
        (plane.bytes_per_sample != 1 && plane.bytes_per_sample != 2)) {
      *error = "decoder returned an invalid plane";
      return false;
    }
    uint64_t row_bytes = 0;
    uint64_t length = 0;
    if (!CheckedMultiply(plane.width, plane.bytes_per_sample, &row_bytes) ||
        !CheckedMultiply(row_bytes, plane.height, &length) ||
        row_bytes > static_cast<uint64_t>(std::numeric_limits<uint32_t>::max()) ||
        plane.stride_bytes == std::numeric_limits<int64_t>::min() ||
        static_cast<uint64_t>(plane.stride_bytes < 0 ? -plane.stride_bytes : plane.stride_bytes) < row_bytes ||
        total > maximum_bytes || length > maximum_bytes - total) {
      *error = "decoded plane exceeds the GUI transfer limit";
      return false;
    }
    records->push_back({total, length, static_cast<uint32_t>(row_bytes), plane.width, plane.height});
    total += length;
  }

  std::ofstream output(path, std::ios::binary | std::ios::trunc);
  if (!output) {
    *error = "unable to create the selected-frame output";
    return false;
  }
  for (size_t plane_index = 0; plane_index < planes.size(); ++plane_index) {
    const PlaneView& plane = planes[plane_index];
    const PackedPlane& record = (*records)[plane_index];
    for (uint32_t row = 0; row < plane.height; ++row) {
      const auto row_offset = static_cast<int64_t>(row) * plane.stride_bytes;
      output.write(
          reinterpret_cast<const char*>(plane.data + row_offset),
          static_cast<std::streamsize>(record.row_bytes));
      if (!output) {
        *error = "unable to write the selected-frame output";
        return false;
      }
    }
  }
  return true;
}

}  // namespace bitscope

#endif
