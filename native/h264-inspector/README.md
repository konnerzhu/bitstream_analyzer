# BitScope H.264 native inspector

This directory starts the instrumented decoder backend by wrapping FFmpeg's H.264 decoder behind a small, versioned C ABI. It currently exports exact final YUV planes and decoder-provided motion vectors for each decoded frame.

The ABI already provides callback-scoped slots for future predicted pixels, signed residual planes, transform blocks, and pre-filter pixels. Those stages are deliberately left empty and are not marked available yet: FFmpeg's public API does not expose them. Populating them requires a narrowly maintained FFmpeg fork with callbacks inside the H.264 reconstruction path.

## Build

Install an LGPL-compatible FFmpeg development build and CMake, then run:

```bash
cmake -S native/h264-inspector -B build/h264-inspector -DCMAKE_BUILD_TYPE=Release
cmake --build build/h264-inspector
build/h264-inspector/bitscope-h264-inspect sample.h264
```

The CLI writes newline-delimited JSON frame summaries. Applications should link the static adapter and consume the callback API in `include/bitscope_h264_inspector.h`; pixel pointers are callback-scoped and must not be retained.

## Next inspection hooks

1. Add an FFmpeg patch at the H.264 inverse-transform/reconstruction boundary.
2. Emit signed residual samples before they are added to prediction.
3. Emit prediction samples before reconstruction.
4. Snapshot reconstructed pixels before deblocking.
5. Compile the pinned, patched FFmpeg configuration to WebAssembly and call this same C ABI from a dedicated Worker.

FFmpeg licensing depends on its build configuration. Production WebAssembly artifacts must use an audited, pinned configuration and include the corresponding license/source obligations; do not reuse a locally installed GPL-enabled build for distribution.
