<p align="center">
  <img src="public/og.png" alt="BitScope multi-codec bitstream analyzer" width="900">
</p>

<h1 align="center">BitScope</h1>

<p align="center">
  <strong>Compressed video bitstreams, made legible.</strong><br>
  Inspect AVC, HEVC, VVC, and AV1 structure—right in your browser.
</p>

<p align="center">
  English · <a href="docs/README_zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img alt="Supported codecs" src="https://img.shields.io/badge/codecs-AVC%20%7C%20HEVC%20%7C%20VVC%20%7C%20AV1-1f6feb?style=flat-square">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.9-3178c6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React-19-149eca?style=flat-square&logo=react&logoColor=white">
  <img alt="Local processing" src="https://img.shields.io/badge/processing-100%25%20local-2ea44f?style=flat-square">
</p>

## What is BitScope?

BitScope is a visual H.264/AVC, H.265/HEVC, H.266/VVC, and AV1 elementary-stream analyzer for developers, codec engineers, students, and anyone who wants to understand what is inside a compressed video stream.

Drop in an Annex-B NAL stream or a low-overhead AV1 OBU stream and BitScope parses it locally, presents stream metadata and unit layout, decodes pictures when the browser supports the codec through WebCodecs, and keeps the syntax view synchronized with the selected frame. No file upload or server-side processing is involved.

## Highlights

| | Capability | What you can inspect |
|---|---|---|
| **01** | Stream summary | Profile, level, coded/display size, frame rate, chroma format, and bit depth |
| **02** | NAL / OBU timeline | Codec-specific type, layer, temporal ID, byte offset, payload size, and header size |
| **03** | Decoded picture | Frame-by-frame output synchronized with the selected access unit |
| **04** | Coding-block view | Codec-aware Macroblock, CTU, or Superblock grid with click selection and coordinates |
| **05** | Entropy-decoded blocks | H.264 CAVLC macroblock partitions/intra directions plus AV1 IVF leaf-block, intra-mode direction, transform, and skip overlays |
| **06** | Syntax details | Parsed sequence fields and unit headers alongside a bounded hexadecimal view |
| **07** | Private by design | Analysis stays inside the browser; the source stream is never uploaded |
| **08** | Native decoder adapters | Versioned H.264/AV1 C ABIs for exact decoded planes and decoder metadata |

## Supported input

| Format | Status | Notes |
|---|:---:|---|
| Raw H.264 Annex-B (`.h264`, `.264`, `.avc`) | ✅ | 3-byte and 4-byte start codes |
| Raw H.265 Annex-B (`.h265`, `.265`, `.hevc`) | ✅ | VPS/SPS/PPS, VCL units, layers, and CTU size |
| Raw H.266 Annex-B (`.h266`, `.266`, `.vvc`) | ✅ | Structural NAL analysis; browser decoding is not available |
| Low-overhead AV1 OBU (`.av1`, `.obu`) | ✅ | Sized OBUs, Sequence Header, frames, tiles, and metadata |
| AV1 IVF (`.ivf`) | ✅ | DKIF header, dimensions, time base, frame records, contained OBUs, and libaom inspection block syntax |
| MP4 / MOV | — | Extract the elementary stream first |
| MKV / WebM | — | Container demuxing is not implemented yet |
| MPEG-TS | — | Container demuxing is not implemented yet |
| Length-prefixed AVC/HEVC/VVC | — | Annex-B input is currently required |

The current input limit is **200 MB** per file. Parsing is capped at **100,000 NAL/OBU units** to keep the interface responsive on malformed or unusually large streams.

## Analysis coverage

| Codec | Current coverage |
|---|---|
| H.264 / AVC | SPS profile, level, dimensions, timing, chroma/bit depth; NAL and slice summary; CAVLC I/P macroblock type, CBP, ΔQP, partition geometry, and decoded Intra 4×4/8×8/16×16 prediction modes |
| H.265 / HEVC | VPS/SPS/PPS detection, profile, level, dimensions, chroma/bit depth, layer/temporal IDs, IRAP frames, and SPS-derived CTU size |
| H.266 / VVC | NAL type, VPS/SPS/PPS/APS/PH/SEI recognition, layer/temporal IDs, random-access units, and declared CTU size |
| AV1 | OBU framing, Sequence Header metadata, frame/tile units, 64/128 Superblocks, and IVF entropy-decoded leaf block size, intra-mode name/nominal direction, transform, and skip state |
| Pictures | WebCodecs decoding for AVC, HEVC, or AV1 when that codec/configuration is available in the browser; VVC parsing only |

> [!NOTE]
> H.264 CAVLC I/P partitions are syntax-derived; unsupported H.264 modes and other codecs retain the structural grid only. VVC frame counts may be approximate when Picture Header/AUD units are absent.

## Quick start

### Run from source

Requirements: **Node.js 22.13 or newer** and npm.

```bash
git clone git@github.com:konnerzhu/bitstream_analyzer.git
cd bitstream_analyzer
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), then drag a supported elementary stream onto the drop zone or choose one from disk.

The English interface is available at [`/`](http://localhost:3000/), and the Simplified Chinese interface is available at [`/zh-CN`](http://localhost:3000/zh-CN). Both routes share the same analyzer and can be switched from the header.

### Install the desktop GUI

The macOS Apple Silicon release is a self-contained `.dmg`: open it and drag **BitScope** to Applications. The Windows x64 release is an assisted NSIS `.exe`: open it, choose the installation directory, and complete the setup wizard. Both packages include the H.264 and AV1 native decoders, so end users do not need Node.js, npm, FFmpeg, or dav1d.

Current local builds are unsigned. macOS may require **Open** from Finder's context menu, while Windows Defender SmartScreen may show an unknown-publisher warning. Public releases should be signed with platform developer certificates, and macOS releases should also be notarized.

### Native desktop development

Install FFmpeg and dav1d development libraries, then launch the Electron host:

```bash
npm run desktop:dev
```

The command builds both native adapters, starts or reuses the local UI server, and opens the same interface with a restricted native decoder bridge. H.264 pictures are decoded by FFmpeg and AV1 pictures by dav1d; the GUI falls back to WebCodecs when the bridge or a native decoder is unavailable.

To produce the self-contained macOS arm64 DMG/ZIP or Windows x64 NSIS installer as a maintainer:

```bash
npm run desktop:dist:mac
npm run desktop:dist:win
```

These packaging builds use checksum-pinned FFmpeg 7.1.5 and dav1d 1.5.4 sources, compile the native decoder helpers for the target platform, and write artifacts to `.artifacts/release/`. The Windows cross-build requires MinGW-w64, Meson, Ninja, NASM, CMake, and pkg-config.

## Using the analyzer

1. Load an AVC/HEVC/VVC Annex-B stream, an AV1 OBU stream, or an AV1 IVF file.
2. Select a frame, NAL unit, or OBU from the timeline.
3. Inspect the synchronized decoded picture and syntax panel.
4. Enable the coding-block overlay and click a block to view its address, coordinates, bounds, and available slice association. For supported H.264 CAVLC streams and AV1 IVF, use **Intra modes** to independently show or hide nominal-direction arrows.
5. Scroll the mouse wheel over the picture to zoom from **50% to 800%**; use **Fit** to return to the available viewport.

If WebCodecs or a matching browser decoder is unavailable, bitstream parsing still works, but decoded-picture display is disabled. H.266/VVC currently has no WebCodecs decoding path.

## Project layout

| Path | Purpose |
|---|---|
| `app/Analyzer.tsx` | Analyzer UI, frame decoding, navigation, zoom, and coding-block interaction |
| `app/i18n.ts` | Type-safe English and Simplified Chinese interface copy |
| `app/(english)/` / `app/zh-CN/` | Locale-specific routes, metadata, and document language |
| `app/codecs.ts` | Codec detection plus HEVC, VVC, and AV1 structural parsing |
| `app/h264.ts` | Annex-B scanning, bit reading, emulation-prevention removal, and H.264 syntax parsing |
| `app/h264-subblocks.ts` | Bounded H.264 SPS/PPS/Slice and CAVLC macroblock/subpartition parsing |
| `app/av1-subblocks.ts` | Validates and converts libaom inspection MI maps into selectable AV1 leaf blocks |
| `public/av1-inspector-worker.js` | Runs the pinned libaom WebAssembly inspector off the UI thread with resource limits |
| `native/h264-inspector/` | FFmpeg-backed H.264 native decoder adapter, inspection ABI, and JSONL diagnostic CLI |
| `native/av1-decoder/` | dav1d-backed AV1 IVF/OBU decoder adapter, inspection ABI, and JSONL diagnostic CLI |
| `desktop/` | Sandboxed Electron host, restricted IPC preload, and bounded native decoder runner |
| `config/` | Desktop Vite and Drizzle tool configuration |
| `docs/` | Localized and supporting documentation |
| `.artifacts/` | Ignored web, native, desktop, installer, and packaging outputs |
| `app/analyzer.css` | Responsive analyzer layout and visual system |
| `public/` | Repository and application artwork |

## Development

```bash
npm run dev      # start the local development server
npm run build    # create a production build
npm run lint     # run static checks
npm run native:h264:build  # build the optional native H.264 adapter
npm run native:av1:build   # build the optional native AV1/dav1d adapter
npm run desktop:dev        # build native adapters and open the desktop GUI
npm run desktop:dist:mac   # build a self-contained macOS arm64 DMG and ZIP
npm run desktop:dist:win   # build a self-contained Windows x64 NSIS installer
```

The analyzer is written in TypeScript with React 19 and vinext. Parsing and decoding intentionally remain client-side so the same core can later be packaged as a desktop application.

### Native H.264 inspection backend

The first native-decoder phase is available under `native/h264-inspector`. It wraps libavcodec behind a bounded, versioned C ABI and invokes an observer for every decoded frame. The callback currently exposes exact final YUV planes and FFmpeg-exported motion vectors. ABI slots and capability flags are reserved for prediction, signed residual, transform-coefficient, and pre-deblocking data; those flags stay off until the corresponding reconstruction-path hooks are implemented in a pinned FFmpeg fork.

The Electron desktop host connects this ABI to the decoded-picture canvas through a restricted IPC bridge. The ordinary browser route retains WebCodecs as its decoder. See `native/h264-inspector/README.md` for prerequisites, direct CMake commands, and distribution-license requirements.

### Native AV1 decoder backend

`native/av1-decoder` wraps dav1d 1.5.1 or newer behind a second bounded, versioned C ABI. It accepts IVF and raw low-overhead OBU input, and exposes exact decoded YUV planes, 8/10/12-bit layout information, frame type, render size, timestamps, spatial/temporal IDs, color metadata, and explicit film-grain control. Film grain is disabled by default for reconstruction inspection.

This decoder complements rather than replaces the libaom inspection Worker: dav1d supplies real decoded pictures to the desktop GUI, while libaom supplies the per-block partition, mode, transform, and motion-vector maps.

## Known limitations

- Raw Annex-B NAL streams, low-overhead AV1 OBU streams, and AV1 IVF are supported; general-purpose container demuxing is not included.
- Browser decoded output depends on WebCodecs and the available operating-system codec implementation. The desktop host uses FFmpeg for H.264 and dav1d for AV1; HEVC still uses WebCodecs and VVC is analysis-only.
- The browser H.264 subblock parser currently covers progressive 8-bit 4:2:0 CAVLC I/P slices, including luma intra prediction modes and list-0 motion vectors. DC and Plane are shown as non-directional; CABAC, B slices, FMO, interlaced/MBAFF pictures, and residual coefficient values are reported as unsupported rather than inferred.
- The native H.264 adapter currently exports final decoder pixels and motion vectors. Exact prediction, residual, coefficient, and pre-deblocking output requires the planned patched-decoder hooks and is not synthesized from the final image.
- The native AV1/dav1d adapter currently exports final pixels and frame metadata. dav1d's public API does not expose per-block residual, coefficient, prediction, or motion-vector maps, so libaom inspection remains responsible for those overlays.
- AV1 subblock inspection currently requires an IVF container. Raw low-overhead OBU streams continue to show their top-level Superblock grid because the bundled inspector consumes IVF.
- AV1 directional arrows show the mode's nominal angle. The bundled inspection data does not currently expose each block's optional angle delta.
- AV1 inspection runs in a dedicated Worker and is bounded to 64 MB input, 20 seconds per selected frame, 32 MB JSON output, and validated matrix/block counts.
- HEVC and VVC still show their top-level coding-unit grid without entropy-decoded subpartitions.
- Interlaced streams and less common parameter-set combinations may expose fields that are parsed but not visualized.

## Roadmap

- [x] Ship a self-contained macOS Apple Silicon desktop GUI package
- [x] Ship a self-contained Windows x64 NSIS desktop installer
- [ ] Sign/notarize desktop releases and add macOS Intel and Linux packages
- [x] Decode H.264 CAVLC I/P macroblock types and partition geometry
- [x] Wrap the native FFmpeg H.264 decoder with a stable frame/MV inspection ABI
- [x] Wrap the native dav1d AV1 decoder with a stable IVF/OBU frame inspection ABI
- [x] Connect the native H.264/dav1d adapters to the desktop GUI with WebCodecs fallback
- [ ] Add pinned FFmpeg H.264 reconstruction hooks for prediction, residuals, coefficients, and pre-deblocking pixels
- [ ] Add H.264 CABAC/B-slice browser syntax parsing and reference details
- [ ] Add MP4/MKV/MPEG-TS demuxing and AVCC conversion
- [ ] Export analysis reports and frame/block data
- [ ] Add deeper HEVC/VVC picture syntax and raw-OBU AV1 inspection

## Contributing

Issues, test streams, parser corrections, and UI improvements are welcome. Please avoid committing copyrighted or sensitive media samples; use the smallest reproducible bitstream you are permitted to share.

Before opening a pull request, run:

```bash
npm run lint
npm run build
```


---

<p align="center">
  Built for people who like knowing what every byte is doing.
</p>
