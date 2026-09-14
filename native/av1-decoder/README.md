# BitScope AV1 native decoder

This directory wraps VideoLAN's dav1d decoder behind a small, versioned C ABI. It accepts AV1 IVF files and raw low-overhead OBU streams, then exposes exact decoded planar pixels and frame metadata through a callback.

Film grain is disabled by default so inspection receives the decoded reconstruction rather than synthesized display grain. Callers may explicitly enable it through `BitscopeAv1Options` when display-equivalent output is preferred.

## Build

Install dav1d 1.5.1 or newer, pkg-config, and CMake, then run:

```bash
cmake -S native/av1-decoder -B build/av1-decoder -DCMAKE_BUILD_TYPE=Release
cmake --build build/av1-decoder
build/av1-decoder/bitscope-av1-decode sample.ivf
```

The CLI writes newline-delimited JSON frame summaries. Applications should link the static adapter and consume `include/bitscope_av1_decoder.h`. Plane pointers are callback-scoped and must not be retained.

## Inspection boundary

dav1d provides final decoded pictures, frame/sequence headers, color metadata, spatial and temporal IDs, and film-grain control through its public API. It does not expose per-block motion vectors, prediction buffers, transform coefficients, or residual planes. The existing libaom inspection Worker remains the source for AV1 block syntax until equivalent internal dav1d hooks are maintained.

dav1d is distributed under the BSD 2-Clause license. Any packaged native or WebAssembly decoder must retain its copyright notice, license conditions, and disclaimer.
