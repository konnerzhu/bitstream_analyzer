#!/bin/sh
set -eu

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This native packaging script supports macOS only." >&2
  exit 1
fi

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
work_root="$project_root/.artifacts/work/desktop-native"
ffmpeg_version="7.1.5"
ffmpeg_archive="$work_root/ffmpeg-$ffmpeg_version.tar.xz"
ffmpeg_source="$work_root/ffmpeg-$ffmpeg_version"
ffmpeg_prefix="$work_root/ffmpeg-install"
ffmpeg_checksum="de668509caf9e35e3cd162473441fdb29538c6d96ed080292b3cf9e6fc5d558f"
native_output="$project_root/.artifacts/desktop/native"
license_output="$project_root/.artifacts/desktop/native-licenses"
h264_build="$work_root/h264-build"

mkdir -p "$work_root" "$native_output" "$license_output"

if [ ! -f "$ffmpeg_archive" ]; then
  curl --fail --location --proto '=https' --tlsv1.2 \
    "https://ffmpeg.org/releases/ffmpeg-$ffmpeg_version.tar.xz" \
    --output "$ffmpeg_archive"
fi

actual_checksum=$(shasum -a 256 "$ffmpeg_archive" | awk '{print $1}')
if [ "$actual_checksum" != "$ffmpeg_checksum" ]; then
  echo "FFmpeg source checksum verification failed." >&2
  exit 1
fi

ffmpeg_pc="$ffmpeg_prefix/lib/pkgconfig/libavcodec.pc"
if [ -f "$ffmpeg_source/config.h" ] || [ -d "$ffmpeg_prefix" ]; then
  if [ ! -f "$ffmpeg_prefix/include/libavcodec/avcodec.h" ] || \
     [ ! -f "$ffmpeg_prefix/lib/libavcodec.a" ] || \
     [ ! -f "$ffmpeg_pc" ] || \
     ! grep -Fqx "prefix=$ffmpeg_prefix" "$ffmpeg_pc"; then
    echo "Discarding incomplete or relocated FFmpeg build cache."
    rm -rf "$ffmpeg_source" "$ffmpeg_prefix" "$h264_build"
  fi
fi

if [ ! -f "$ffmpeg_source/config.h" ]; then
  rm -rf "$ffmpeg_source" "$ffmpeg_prefix"
  tar -xf "$ffmpeg_archive" -C "$work_root"
  cd "$ffmpeg_source"
  ./configure \
    --prefix="$ffmpeg_prefix" \
    --disable-everything \
    --enable-avcodec \
    --enable-avutil \
    --enable-decoder=h264 \
    --enable-parser=h264 \
    --enable-static \
    --disable-shared \
    --disable-programs \
    --disable-doc \
    --disable-debug \
    --disable-network \
    --disable-autodetect \
    --disable-gpl \
    --disable-nonfree \
    --enable-pic
fi

if [ ! -f "$ffmpeg_prefix/lib/libavcodec.a" ]; then
  jobs=$(sysctl -n hw.logicalcpu 2>/dev/null || echo 4)
  make -C "$ffmpeg_source" -j "$jobs"
  make -C "$ffmpeg_source" install
fi

PKG_CONFIG_PATH="$ffmpeg_prefix/lib/pkgconfig" cmake \
  -S "$project_root/native/h264-inspector" \
  -B "$h264_build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_FIND_USE_SYSTEM_PACKAGE_REGISTRY=OFF
cmake --build "$h264_build" --parallel

cmake \
  -S "$project_root/native/av1-decoder" \
  -B "$work_root/av1-build" \
  -DCMAKE_BUILD_TYPE=Release
cmake --build "$work_root/av1-build" --parallel

cp "$h264_build/bitscope-h264-inspect" "$native_output/bitscope-h264-inspect"
cp "$work_root/av1-build/bitscope-av1-decode" "$native_output/bitscope-av1-decode"

dav1d_path=$(otool -L "$native_output/bitscope-av1-decode" | awk '/libdav1d/{print $1; exit}')
if [ -z "$dav1d_path" ] || [ ! -f "$dav1d_path" ]; then
  echo "The dav1d runtime library could not be located." >&2
  exit 1
fi
cp "$dav1d_path" "$native_output/libdav1d.7.dylib"
chmod u+w "$native_output/libdav1d.7.dylib"
install_name_tool -id "@loader_path/libdav1d.7.dylib" "$native_output/libdav1d.7.dylib"
install_name_tool -change "$dav1d_path" "@loader_path/libdav1d.7.dylib" "$native_output/bitscope-av1-decode"
chmod 755 "$native_output/bitscope-h264-inspect" "$native_output/bitscope-av1-decode"
codesign --force --sign - "$native_output/libdav1d.7.dylib"
codesign --force --sign - "$native_output/bitscope-h264-inspect"
codesign --force --sign - "$native_output/bitscope-av1-decode"

cp "$ffmpeg_source/COPYING.LGPLv2.1" "$license_output/FFmpeg-COPYING.LGPLv2.1"
cp "$ffmpeg_source/COPYING.LGPLv3" "$license_output/FFmpeg-COPYING.LGPLv3"
cp "$project_root/third_party/dav1d-COPYING" "$license_output/dav1d-COPYING"

if otool -L "$native_output/bitscope-h264-inspect" | grep -q '/opt/homebrew\|/usr/local'; then
  echo "The packaged H.264 decoder still has a package-manager dependency." >&2
  exit 1
fi
if otool -L "$native_output/bitscope-av1-decode" | grep -q '/opt/homebrew\|/usr/local'; then
  echo "The packaged AV1 decoder still has a package-manager dependency." >&2
  exit 1
fi

echo "Prepared self-contained native decoders in $native_output"
