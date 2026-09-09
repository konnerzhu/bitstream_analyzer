<p align="center">
  <img src="public/og.png" alt="BitScope H.264 Bitstream Analyzer" width="900">
</p>

<h1 align="center">BitScope</h1>

<p align="center">
  <strong>H.264 bitstreams, made legible.</strong><br>
  Inspect stream structure, decoded pictures, NAL units, and macroblocks—right in your browser.
</p>

<p align="center">
  English · <a href="README_zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img alt="H.264 Annex-B" src="https://img.shields.io/badge/input-H.264%20Annex--B-1f6feb?style=flat-square">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.9-3178c6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React-19-149eca?style=flat-square&logo=react&logoColor=white">
  <img alt="Local processing" src="https://img.shields.io/badge/processing-100%25%20local-2ea44f?style=flat-square">
</p>

## What is BitScope?

BitScope is a visual H.264 elementary-stream analyzer for developers, codec engineers, students, and anyone who wants to understand what is inside a compressed video stream.

Drop in a raw Annex-B stream and BitScope parses it locally, presents the stream metadata and NAL layout, decodes pictures when the browser supports WebCodecs, and keeps the syntax view synchronized with the selected frame. No file upload or server-side processing is involved.

## Highlights

| | Capability | What you can inspect |
|---|---|---|
| **01** | Stream summary | Profile, level, coded/display size, frame rate, chroma format, and bit depth |
| **02** | NAL timeline | Type, reference priority, byte offset, payload size, and start-code size |
| **03** | Decoded picture | Frame-by-frame output synchronized with the selected access unit |
| **04** | Macroblock view | Zoomable 16×16 grid, click selection, position, address, and inferred slice ownership |
| **05** | Syntax details | Parsed SPS and slice-header fields alongside a bounded hexadecimal view |
| **06** | Private by design | Analysis stays inside the browser; the source stream is never uploaded |

## Supported input

| Format | Status | Notes |
|---|:---:|---|
| Raw H.264 Annex-B (`.h264`, `.264`, `.avc`) | ✅ | 3-byte and 4-byte start codes |
| MP4 / MOV | — | Extract the H.264 elementary stream first |
| MKV / WebM | — | Container demuxing is not implemented yet |
| MPEG-TS | — | Container demuxing is not implemented yet |
| AVCC length-prefixed H.264 | — | Annex-B input is currently required |

The current input limit is **200 MB** per file. Parsing is capped at **100,000 NAL units** to keep the interface responsive on malformed or unusually large streams.

## Analysis coverage

| Layer | Current coverage |
|---|---|
| SPS | Profile, constraint flags, level, coded/display dimensions, cropping, frame rate, chroma format, bit depths, frame numbering, and POC configuration |
| NAL units | Type, `nal_ref_idc`, byte range, size, start code, and RBSP-oriented detail view |
| Slice headers | First macroblock, slice type, PPS ID, frame number, field flags, IDR picture ID, and selected POC fields |
| Pictures | Browser decoding through WebCodecs when an H.264 decoder is available |
| Macroblocks | 16×16 spatial grid, address/coordinates, boundary handling, and inferred slice range |

> [!NOTE]
> The macroblock overlay is a structural navigation aid. BitScope does not yet entropy-decode `mb_type`, sub-partitions, motion vectors, prediction modes, or residual coefficients.

## Quick start

### Run from source

Requirements: **Node.js 22.13 or newer** and npm.

```bash
git clone git@github.com:konnerzhu/bitstream_analyzer.git
cd bitstream_analyzer
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), then drag a raw H.264 stream onto the drop zone or choose one from disk.

> [!IMPORTANT]
> These are developer commands. A self-contained desktop GUI package that does not require Node.js is planned, but is not published yet.

## Using the analyzer

1. Load a raw Annex-B H.264 file.
2. Select a frame or NAL unit from the timeline/list.
3. Inspect the synchronized decoded picture and syntax panel.
4. Enable the macroblock overlay and click a block to view its address, coordinates, bounds, and slice association.
5. Scroll the mouse wheel over the picture to zoom from **50% to 800%**; use **Fit** to return to the available viewport.

If WebCodecs or an H.264 decoder is unavailable, bitstream parsing still works, but decoded-picture display is disabled.

## Project layout

| Path | Purpose |
|---|---|
| `app/Analyzer.tsx` | Analyzer UI, frame decoding, navigation, zoom, and macroblock interaction |
| `app/h264.ts` | Annex-B scanning, bit reading, emulation-prevention removal, and H.264 syntax parsing |
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

- Raw Annex-B elementary streams only; container demuxing is not included.
- Decoded output depends on the browser, operating system, and available H.264 codec implementation.
- Macroblock syntax is not yet fully entropy-decoded, so block type, motion vectors, references, and residual data are not displayed.
- Interlaced streams and less common parameter-set combinations may expose fields that are parsed but not visualized.

## Roadmap

- [ ] Ship installable desktop GUI packages for macOS, Windows, and Linux
- [ ] Decode macroblock type, partitions, prediction modes, motion vectors, and residual information
- [ ] Add MP4/MKV/MPEG-TS demuxing and AVCC conversion
- [ ] Export analysis reports and frame/block data
- [ ] Extend the analyzer architecture to HEVC and AV1

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
