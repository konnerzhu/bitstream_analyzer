<p align="center">
  <img src="public/og.png" alt="BitScope multi-codec bitstream analyzer" width="900">
</p>

<h1 align="center">BitScope</h1>

<p align="center">
  <strong>Compressed video bitstreams, made legible.</strong><br>
  Inspect AVC, HEVC, VVC, and AV1 structure—right in your browser.
</p>

<p align="center">
  English · <a href="README_zh-CN.md">简体中文</a>
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
| **05** | Entropy-decoded blocks | H.264 CAVLC macroblock partitions plus AV1 IVF leaf-block, prediction, transform, and skip overlays |
| **06** | Syntax details | Parsed sequence fields and unit headers alongside a bounded hexadecimal view |
| **07** | Private by design | Analysis stays inside the browser; the source stream is never uploaded |

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
| H.264 / AVC | SPS profile, level, dimensions, timing, chroma/bit depth; NAL and slice summary; CAVLC I/P macroblock type, CBP, ΔQP, and partition geometry |
| H.265 / HEVC | VPS/SPS/PPS detection, profile, level, dimensions, chroma/bit depth, layer/temporal IDs, IRAP frames, and SPS-derived CTU size |
| H.266 / VVC | NAL type, VPS/SPS/PPS/APS/PH/SEI recognition, layer/temporal IDs, random-access units, and declared CTU size |
| AV1 | OBU framing, Sequence Header metadata, frame/tile units, 64/128 Superblocks, and IVF entropy-decoded leaf block size/mode/transform/skip |
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

> [!IMPORTANT]
> These are developer commands. A self-contained desktop GUI package that does not require Node.js is planned, but is not published yet.

## Using the analyzer

1. Load an AVC/HEVC/VVC Annex-B stream, an AV1 OBU stream, or an AV1 IVF file.
2. Select a frame, NAL unit, or OBU from the timeline/list.
3. Inspect the synchronized decoded picture and syntax panel.
4. Enable the coding-block overlay and click a block to view its address, coordinates, bounds, and available slice association.
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
| `app/analyzer.css` | Responsive analyzer layout and visual system |
| `public/` | Repository and application artwork |

## Development

```bash
npm run dev      # start the local development server
npm run build    # create a production build
npm run lint     # run static checks
```

The analyzer is written in TypeScript with React 19 and vinext. Parsing and decoding intentionally remain client-side so the same core can later be packaged as a desktop application.

## Known limitations

- Raw Annex-B NAL streams, low-overhead AV1 OBU streams, and AV1 IVF are supported; general-purpose container demuxing is not included.
- Decoded output depends on the browser, operating system, and available AVC/HEVC/AV1 codec implementation; VVC is analysis-only.
- H.264 subblock parsing currently covers progressive 8-bit 4:2:0 CAVLC I/P slices. CABAC, B slices, FMO, interlaced/MBAFF pictures, motion-vector values, and residual coefficient values are reported as unsupported rather than inferred.
- AV1 subblock inspection currently requires an IVF container. Raw low-overhead OBU streams continue to show their top-level Superblock grid because the bundled inspector consumes IVF.
- AV1 inspection runs in a dedicated Worker and is bounded to 64 MB input, 20 seconds per selected frame, 32 MB JSON output, and validated matrix/block counts.
- HEVC and VVC still show their top-level coding-unit grid without entropy-decoded subpartitions.
- Interlaced streams and less common parameter-set combinations may expose fields that are parsed but not visualized.

## Roadmap

- [ ] Ship installable desktop GUI packages for macOS, Windows, and Linux
- [x] Decode H.264 CAVLC I/P macroblock types and partition geometry
- [ ] Add H.264 CABAC/B-slice support, motion vectors, references, and residual coefficient details
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
