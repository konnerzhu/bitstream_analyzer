# BitScope H.264 native inspector

This directory contains the instrumented H.264 backend. It wraps a pinned FFmpeg 7.1.5 fork behind a small, versioned C ABI and exports final pixels, motion vectors, predictor samples, signed reconstruction residuals, entropy-decoded transform coefficients, reconstructed pixels before deblocking, exact slice reference lists, and DPB snapshots.

The FFmpeg changes live in `ffmpeg/` and are applied by the desktop native build scripts. Inspection is opt-in, forces single-threaded H.264 decode, and stores each record as reference-counted frame side data so delayed and reordered pictures keep the correct inspection data. A normal, unpatched system FFmpeg remains usable for final pixels and motion vectors only.

## Build

For all decoder stages, run `scripts/build-desktop-native-macos.sh` or `scripts/build-desktop-native-windows.sh`; those scripts verify the pinned source archive before applying the local patch. For final-pixel-only development, an LGPL-compatible system FFmpeg and CMake are sufficient:

```bash
cmake -S native/h264-inspector -B .artifacts/build/h264-inspector -DCMAKE_BUILD_TYPE=Release
cmake --build .artifacts/build/h264-inspector
.artifacts/build/h264-inspector/bitscope-h264-inspect sample.h264
```

The CLI writes newline-delimited JSON frame summaries. Applications should link the static adapter and consume the callback API in `include/bitscope_h264_inspector.h`; pixel pointers are callback-scoped and must not be retained.

The desktop bridge uses the CLI's bounded selected-frame export mode:

```bash
.artifacts/build/h264-inspector/bitscope-h264-inspect --frame 0 --output frame.planes sample.h264
```

The output contains tightly packed final planar samples; the `selectedFrame` JSON record describes plane offsets, dimensions, bit depth, range, matrix and byte order. ABI v4 adds bounded per-slice reference-list reconstruction and DPB metadata. All decoder-owned pointers remain callback-scoped.

## Inspection semantics

- Coefficients are captured after entropy decoding and before inverse transform.
- Prediction is captured at each intra predictor block or after inter motion compensation.
- Residual is the signed reconstructed-minus-predicted sample value before deblocking.
- Pre-filter pixels are captured after reconstruction and before the loop filter.
- Final pixels are the normal decoder output after filtering.
- Each slice records the DPB state used to construct its reference lists, the parsed `ref_pic_list_modification` operations, and the exact final L0/L1 entries after FFmpeg applies reordering and validation.
- The post-marking snapshot records the DPB after decoded-reference-picture marking/MMCO. A callback-scoped `picture_id` links current pictures, slice references, and DPB entries without exposing decoder pointers.
- `incomplete_stages` is set for combined transform-bypass operations and interlaced/MBAFF paths whose stage coordinates are not yet exported exactly.

FFmpeg licensing depends on its build configuration. Distributed builds must use the audited, pinned LGPL configuration and include the corresponding license/source obligations; do not reuse a locally installed GPL-enabled build for distribution.
