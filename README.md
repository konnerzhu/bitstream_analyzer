<p align="center">
  <img src="public/og.png" alt="BitScope multi-codec bitstream analyzer" width="900">
</p>

<h1 align="center">BitScope</h1>

<p align="center">
  A local visual analyzer for H.264/AVC, H.265/HEVC, H.266/VVC, and AV1 bitstreams.
</p>

<p align="center">
  <a href="https://github.com/konnerzhu/bitstream_analyzer/releases"><strong>Download desktop GUI</strong></a>
  · English
  · <a href="docs/README_zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img alt="Supported codecs" src="https://img.shields.io/badge/codecs-AVC%20%7C%20HEVC%20%7C%20VVC%20%7C%20AV1-1f6feb?style=flat-square">
  <img alt="Local processing" src="https://img.shields.io/badge/processing-100%25%20local-2ea44f?style=flat-square">
</p>

BitScope parses elementary video streams locally and presents their structure alongside synchronized decoded pictures. Files remain on your device.

## Download

**[Download BitScope for Windows or macOS from GitHub Releases](https://github.com/konnerzhu/bitstream_analyzer/releases)**

| Platform | Package | Native decoding |
|---|---|---|
| Windows x64 | NSIS `.exe` installer | H.264 via FFmpeg, AV1 via dav1d |
| macOS Apple Silicon | `.dmg` and `.zip` | H.264 via FFmpeg, AV1 via dav1d |

The desktop packages are self-contained; users do not need Node.js, npm, FFmpeg, or dav1d. Unsigned builds may trigger macOS Gatekeeper or Windows SmartScreen warnings.

## Features

- Stream metadata and a navigable NAL/OBU timeline
- Synchronized decoded and residual pictures
- Macroblock, CTU, and Superblock grids with click selection
- Mouse-wheel zoom, panning, fit-to-view, and precise block selection
- H.264 and AV1 intra-mode names and direction paths
- Inter prediction modes and motion-vector overlays
- Native H.264/AV1 decoding in the desktop application
- English and Simplified Chinese interfaces

## Supported input

| Format | Coverage |
|---|---|
| H.264 Annex-B (`.h264`, `.264`, `.avc`) | NAL/SPS/slice analysis, CAVLC I/P macroblocks, intra modes, partitions, and motion vectors |
| H.265 Annex-B (`.h265`, `.265`, `.hevc`) | VPS/SPS/PPS, stream metadata, layers, temporal IDs, and CTU grid |
| H.266 Annex-B (`.h266`, `.266`, `.vvc`) | Structural NAL analysis and CTU grid |
| AV1 low-overhead OBU (`.av1`, `.obu`) | Sequence/frame/tile metadata and Superblock grid |
| AV1 IVF (`.ivf`) | Frame records plus inspected leaf blocks, modes, transforms, skip state, and motion vectors |

MP4, MOV, MKV, WebM, and MPEG-TS demuxing is not yet included; extract the elementary stream first. Input is limited to 200 MB and 100,000 NAL/OBU units.

## Use

1. Open or drop a supported bitstream into BitScope.
2. Select a frame, NAL unit, or OBU from the timeline.
3. Choose the decoded or residual picture view.
4. Enable block, intra-mode, or inter-MV overlays and select a block for details.
5. Scroll to zoom, drag to pan, or use **Fit** to reset the viewport.

Browser picture output depends on WebCodecs support. The desktop application uses bundled native decoders for H.264 and AV1; VVC remains analysis-only.

## Run from source

Requires Node.js 22.13 or newer and npm.

```bash
git clone https://github.com/konnerzhu/bitstream_analyzer.git
cd bitstream_analyzer
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The Chinese interface is available at [`/zh-CN`](http://localhost:3000/zh-CN).

Useful commands:

```bash
npm test                 # production build and test suite
npm run lint             # static checks
npm run desktop:dev      # native decoders plus Electron GUI
npm run desktop:dist:mac # macOS arm64 DMG and ZIP
npm run desktop:dist:win # Windows x64 installer
```

Generated files and installers are written below `.artifacts/`. Release builds use checksum-pinned FFmpeg 7.1.5 and dav1d 1.5.4 sources.

## Project layout

| Path | Purpose |
|---|---|
| `app/` | Analyzer UI, parsers, overlays, localization, and residual rendering |
| `desktop/` | Sandboxed Electron host and restricted native-decoder bridge |
| `native/` | FFmpeg H.264 and dav1d AV1 adapters |
| `public/` | Artwork and the bounded AV1 inspection worker |
| `tests/` | Parser, decoder, navigation, rendering, and integration tests |
| `config/` | Desktop Vite configuration |
| `.artifacts/` | Ignored builds, native work files, applications, and installers |

## Current limitations

- H.264 browser subblock parsing currently targets progressive 8-bit 4:2:0 CAVLC I/P slices; CABAC, B slices, FMO, and interlaced/MBAFF pictures need deeper parsing.
- AV1 detailed block inspection currently requires IVF; raw OBU streams retain the structural Superblock grid.
- HEVC and VVC currently expose structural grids rather than entropy-decoded subpartitions.
- Exact prediction, coefficients, pre-deblocking pixels, and decoder-native residual planes require additional decoder inspection hooks.

## Contributing

Issues, parser corrections, UI improvements, and small reproducible test streams are welcome. Do not submit copyrighted or sensitive media. Before opening a pull request, run `npm run lint` and `npm test`.
