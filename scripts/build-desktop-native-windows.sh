#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
work_root="$project_root/.artifacts/work/desktop-native-windows"
ffmpeg_version="7.1.5"
ffmpeg_checksum="de668509caf9e35e3cd162473441fdb29538c6d96ed080292b3cf9e6fc5d558f"
ffmpeg_archive="$work_root/ffmpeg-$ffmpeg_version.tar.xz"
ffmpeg_source="$work_root/ffmpeg-$ffmpeg_version"
ffmpeg_prefix="$work_root/ffmpeg-install"
dav1d_version="1.5.4"
dav1d_checksum="2abfb0c89212e6e4733a54e0ae509ec00a5b845a6360946f918806e14aedb011"
dav1d_archive="$work_root/dav1d-$dav1d_version.tar.bz2"
dav1d_source="$work_root/dav1d-$dav1d_version"
dav1d_build="$work_root/dav1d-build"
dav1d_prefix="$work_root/dav1d-install"
h264_build="$work_root/h264-build"
av1_build="$work_root/av1-build"
native_output="$project_root/.artifacts/desktop/native-win"
license_output="$project_root/.artifacts/desktop/native-licenses"
meson_cross="$project_root/scripts/toolchains/windows-x64-mingw.ini"
cmake_toolchain="$project_root/scripts/toolchains/windows-x64-mingw.cmake"

for tool in curl shasum tar make cmake meson ninja pkg-config \
  x86_64-w64-mingw32-gcc x86_64-w64-mingw32-g++ x86_64-w64-mingw32-ar \
  x86_64-w64-mingw32-strip x86_64-w64-mingw32-objdump; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Missing Windows cross-build tool: $tool" >&2; exit 1; }
done

mkdir -p "$work_root" "$native_output" "$license_output"

download_and_verify() {
  url=$1
  destination=$2
  expected=$3
  if [ ! -f "$destination" ]; then
    curl --fail --location --proto '=https' --tlsv1.2 "$url" --output "$destination"
  fi
  actual=$(shasum -a 256 "$destination" | awk '{print $1}')
  if [ "$actual" != "$expected" ]; then
    echo "Source archive checksum verification failed: $destination" >&2
    exit 1
  fi
}

download_and_verify \
  "https://ffmpeg.org/releases/ffmpeg-$ffmpeg_version.tar.xz" \
  "$ffmpeg_archive" "$ffmpeg_checksum"
download_and_verify \
  "https://code.videolan.org/videolan/dav1d/-/archive/$dav1d_version/dav1d-$dav1d_version.tar.bz2" \
  "$dav1d_archive" "$dav1d_checksum"

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

dav1d_pc="$dav1d_prefix/lib/pkgconfig/dav1d.pc"
if [ -f "$dav1d_build/build.ninja" ] || [ -d "$dav1d_prefix" ]; then
  if [ ! -f "$dav1d_prefix/include/dav1d/dav1d.h" ] || \
     [ ! -f "$dav1d_prefix/lib/libdav1d.a" ] || \
     [ ! -f "$dav1d_pc" ] || \
     ! grep -Fqx "prefix=$dav1d_prefix" "$dav1d_pc"; then
    echo "Discarding incomplete or relocated dav1d build cache."
    rm -rf "$dav1d_build" "$dav1d_prefix" "$av1_build"
  fi
fi

if [ ! -d "$ffmpeg_source" ]; then
  tar -xf "$ffmpeg_archive" -C "$work_root"
fi
if [ ! -d "$dav1d_source" ]; then
  tar -xf "$dav1d_archive" -C "$work_root"
fi

if [ ! -f "$ffmpeg_source/config.h" ]; then
  cd "$ffmpeg_source"
  ./configure \
    --prefix="$ffmpeg_prefix" \
    --target-os=mingw32 \
    --arch=x86_64 \
    --cross-prefix=x86_64-w64-mingw32- \
    --enable-cross-compile \
    --disable-everything \
    --enable-avcodec \
    --enable-avutil \
    --disable-avdevice \
    --disable-avfilter \
    --disable-avformat \
    --disable-swresample \
    --disable-swscale \
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
    --enable-w32threads \
    --extra-cflags='-D_WIN32_WINNT=0x0A00 -fstack-protector-strong -D_FORTIFY_SOURCE=2' \
    --extra-ldflags='-static-libgcc -Wl,--dynamicbase,--nxcompat,--high-entropy-va'
fi

if [ ! -f "$ffmpeg_prefix/lib/libavcodec.a" ]; then
  jobs=$(sysctl -n hw.logicalcpu 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)
  make -C "$ffmpeg_source" -j "$jobs"
  make -C "$ffmpeg_source" install
fi

if [ ! -f "$dav1d_build/build.ninja" ]; then
  PKG_CONFIG_LIBDIR="$dav1d_prefix/lib/pkgconfig" meson setup \
    "$dav1d_build" "$dav1d_source" \
    --cross-file "$meson_cross" \
    --prefix "$dav1d_prefix" \
    --buildtype release \
    --default-library static \
    -Denable_tools=false \
    -Denable_examples=false \
    -Denable_tests=false \
    -Denable_docs=false
fi
if [ ! -f "$dav1d_prefix/lib/libdav1d.a" ]; then
  meson compile -C "$dav1d_build"
  meson install -C "$dav1d_build"
fi

PKG_CONFIG_LIBDIR="$ffmpeg_prefix/lib/pkgconfig" PKG_CONFIG_PATH= cmake \
  -S "$project_root/native/h264-inspector" \
  -B "$h264_build" \
  -DCMAKE_TOOLCHAIN_FILE="$cmake_toolchain" \
  -DCMAKE_BUILD_TYPE=Release \
  -DPKG_CONFIG_ARGN=--static \
  -DCMAKE_FIND_USE_SYSTEM_PACKAGE_REGISTRY=OFF
cmake --build "$h264_build" --parallel

PKG_CONFIG_LIBDIR="$dav1d_prefix/lib/pkgconfig" PKG_CONFIG_PATH= cmake \
  -S "$project_root/native/av1-decoder" \
  -B "$av1_build" \
  -DCMAKE_TOOLCHAIN_FILE="$cmake_toolchain" \
  -DCMAKE_BUILD_TYPE=Release \
  -DPKG_CONFIG_ARGN=--static \
  -DCMAKE_FIND_USE_SYSTEM_PACKAGE_REGISTRY=OFF
cmake --build "$av1_build" --parallel

cp "$h264_build/bitscope-h264-inspect.exe" "$native_output/bitscope-h264-inspect.exe"
cp "$av1_build/bitscope-av1-decode.exe" "$native_output/bitscope-av1-decode.exe"
x86_64-w64-mingw32-strip "$native_output/bitscope-h264-inspect.exe" "$native_output/bitscope-av1-decode.exe"

cp "$ffmpeg_source/COPYING.LGPLv2.1" "$license_output/FFmpeg-COPYING.LGPLv2.1"
cp "$ffmpeg_source/COPYING.LGPLv3" "$license_output/FFmpeg-COPYING.LGPLv3"
cp "$dav1d_source/COPYING" "$license_output/dav1d-COPYING"

for executable in "$native_output/bitscope-h264-inspect.exe" "$native_output/bitscope-av1-decode.exe"; do
  if ! x86_64-w64-mingw32-objdump -p "$executable" | grep -q 'Subsystem.*Windows CUI'; then
    echo "Native decoder is not a Windows console executable: $executable" >&2
    exit 1
  fi
  if x86_64-w64-mingw32-objdump -p "$executable" | grep 'DLL Name:' | grep -Eiv 'KERNEL32\.dll|msvcrt\.dll|USER32\.dll|ADVAPI32\.dll|WS2_32\.dll|bcrypt\.dll|api-ms-win-crt-[a-z0-9-]+\.dll'; then
    echo "Native decoder has an unexpected runtime DLL dependency: $executable" >&2
    exit 1
  fi
done

echo "Prepared self-contained Windows x64 native decoders in $native_output"
