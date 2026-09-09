"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { Analysis, CodecKind, NalUnit, SUPPORTED_EXTENSIONS, analyzeBitstream, formatBytes, unitColor } from "./codecs";

const MAX_FILE_SIZE = 200 * 1024 * 1024;
const ACCEPTED_FILES = ".h264,.264,.avc,.h265,.265,.hevc,.h266,.266,.vvc,.av1,.obu,video/h264,video/h265,video/av1";

function validateFile(file: File) {
  const lower = file.name.toLowerCase();
  if (!SUPPORTED_EXTENSIONS.some(ext => lower.endsWith(ext))) throw new Error("请选择 H.264/H.265/H.266 Annex-B 裸码流，或 AV1 OBU 文件");
  if (file.size === 0) throw new Error("文件是空的");
  if (file.size > MAX_FILE_SIZE) throw new Error("文件超过 200 MB 上限");
}

function UploadPanel({ onFile, compact = false }: { onFile: (file: File) => void; compact?: boolean }) {
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const accept = (files: FileList | null) => { if (files?.[0]) onFile(files[0]); };
  return <div className={`dropzone ${dragging ? "dragging" : ""} ${compact ? "compact" : ""}`} role="button" tabIndex={0} aria-label="选择视频码流文件" onClick={() => input.current?.click()} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") input.current?.click(); }} onDragOver={(e: DragEvent) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e: DragEvent) => { e.preventDefault(); setDragging(false); accept(e.dataTransfer.files); }}>
    <input ref={input} type="file" accept={ACCEPTED_FILES} onChange={(e: ChangeEvent<HTMLInputElement>) => accept(e.target.files)} />
    <span className="drop-icon">↓</span><b>{compact ? "打开另一个文件" : "拖放视频码流到这里"}</b>{!compact && <small>H.264 · H.265 · H.266 · AV1 · 最大 200 MB</small>}
  </div>;
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="stat"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>;
}

function NalBadge({ unit, codec }: { unit: NalUnit; codec: CodecKind }) { return <span className="nal-badge" style={{ background: unitColor(unit.type, codec) }}>{codec === "av1" ? "O" : "T"}{unit.type}</span>; }

function DecodedPreview({ bytes, analysis, selected, onSelect }: { bytes: Uint8Array; analysis: Analysis; selected: NalUnit | null; onSelect: (unit: NalUnit) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const macroblockCanvas = useRef<HTMLCanvasElement>(null);
  const canvasWrap = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"decoding" | "ready" | "unsupported" | "error">("decoding");
  const [message, setMessage] = useState("正在初始化解码器…");
  const [showMacroblocks, setShowMacroblocks] = useState(true);
  const [selectedMacroblock, setSelectedMacroblock] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [zoomOrigin, setZoomOrigin] = useState({ x: 50, y: 50 });
  const frames = useMemo(() => analysis.units.filter(unit => unit.frameStart), [analysis]);
  const framePosition = Math.max(0, frames.findLastIndex(frame => frame.index <= (selected?.index ?? 0)));
  const target = frames[framePosition];
  const blockSize = analysis.blockSize;
  const macroblockColumns = Math.ceil((analysis.sps?.width ?? 0) / blockSize);
  const macroblockRows = Math.ceil((analysis.sps?.height ?? 0) / blockSize);
  const macroblockCount = macroblockColumns * macroblockRows;
  const macroblockAddress = Math.min(selectedMacroblock, Math.max(0, macroblockCount - 1));
  const macroblockColumn = macroblockColumns ? macroblockAddress % macroblockColumns : 0;
  const macroblockRow = macroblockColumns ? Math.floor(macroblockAddress / macroblockColumns) : 0;
  const frameSlices = useMemo(() => {
    if (!target) return [];
    const nextFrameIndex = frames[framePosition + 1]?.index ?? analysis.units.length;
    return analysis.units.filter(unit => unit.index >= target.index && unit.index < nextFrameIndex && unit.sliceType && unit.firstMb !== undefined).sort((a, b) => (a.firstMb ?? 0) - (b.firstMb ?? 0));
  }, [analysis.units, framePosition, frames, target]);
  const slicePosition = Math.max(0, frameSlices.findLastIndex(unit => (unit.firstMb ?? 0) <= macroblockAddress));
  const macroblockSlice = frameSlices[slicePosition];
  const sliceEnd = Math.min(macroblockCount - 1, (frameSlices[slicePosition + 1]?.firstMb ?? macroblockCount) - 1);
  const unavailableMessage = analysis.codecKind === "h266" ? "当前 WebCodecs 尚未提供 H.266/VVC 解码能力" : !analysis.sps ? `码流缺少可用的 ${analysis.parameterSetName}，无法配置解码器` : typeof VideoDecoder === "undefined" ? "当前浏览器不支持 WebCodecs VideoDecoder" : "";

  useEffect(() => {
    const element = canvasWrap.current;
    if (!element) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = element.getBoundingClientRect();
      setZoomOrigin({ x: Math.min(100, Math.max(0, (event.clientX - bounds.left) / bounds.width * 100)), y: Math.min(100, Math.max(0, (event.clientY - bounds.top) / bounds.height * 100)) });
      setZoom(current => Math.min(8, Math.max(.5, current * Math.exp(-event.deltaY * .002))));
    };
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => {
    const overlay = macroblockCanvas.current;
    const sps = analysis.sps;
    if (!overlay || !sps) return;
    overlay.width = sps.width; overlay.height = sps.height;
    const context = overlay.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, overlay.width, overlay.height);
    if (!showMacroblocks) return;
    context.beginPath();
    for (let x = blockSize; x < sps.width; x += blockSize) { context.moveTo(x + .5, 0); context.lineTo(x + .5, sps.height); }
    for (let y = blockSize; y < sps.height; y += blockSize) { context.moveTo(0, y + .5); context.lineTo(sps.width, y + .5); }
    context.lineWidth = Math.max(1, sps.width / 1600);
    context.strokeStyle = "rgba(217,255,67,.58)"; context.stroke();
    context.fillStyle = "rgba(255,107,53,.34)";
    context.fillRect(macroblockColumn * blockSize, macroblockRow * blockSize, Math.min(blockSize, sps.width - macroblockColumn * blockSize), Math.min(blockSize, sps.height - macroblockRow * blockSize));
    context.strokeStyle = "#ff6b35"; context.lineWidth = Math.max(2, sps.width / 700);
    context.strokeRect(macroblockColumn * blockSize + 1, macroblockRow * blockSize + 1, Math.max(0, Math.min(blockSize - 2, sps.width - macroblockColumn * blockSize - 2)), Math.max(0, Math.min(blockSize - 2, sps.height - macroblockRow * blockSize - 2)));
  }, [analysis.sps, blockSize, macroblockColumn, macroblockRow, showMacroblocks]);

  const selectMacroblockAt = (clientX: number, clientY: number) => {
    const overlay = macroblockCanvas.current;
    if (!overlay || !showMacroblocks || !macroblockColumns || !macroblockRows) return;
    const bounds = overlay.getBoundingClientRect();
    const column = Math.min(macroblockColumns - 1, Math.max(0, Math.floor((clientX - bounds.left) / bounds.width * macroblockColumns)));
    const row = Math.min(macroblockRows - 1, Math.max(0, Math.floor((clientY - bounds.top) / bounds.height * macroblockRows)));
    setSelectedMacroblock(row * macroblockColumns + column);
  };

  const changeZoom = (value: number) => setZoom(Math.min(8, Math.max(.5, value)));

  useEffect(() => {
    let cancelled = false;
    let decoder: VideoDecoder | null = null;
    if (!target || unavailableMessage) return;
    const decode = async () => {
      setState("decoding"); setMessage(`正在解码第 ${framePosition + 1} 帧…`);
      const config: VideoDecoderConfig = { codec: analysis.sps!.codec, codedWidth: analysis.sps!.width, codedHeight: analysis.sps!.height, optimizeForLatency: true };
      const support = await VideoDecoder.isConfigSupported(config);
      if (!support.supported) throw new Error(`浏览器不支持 ${analysis.sps!.codec} 解码`);
      const targetTimestamp = Math.round(framePosition * 1_000_000 / (analysis.sps!.fps ?? 30));
      let rendered = false;
      decoder = new VideoDecoder({
        output: frame => {
          if (!cancelled && frame.timestamp === targetTimestamp && canvas.current) {
            const element = canvas.current;
            element.width = frame.displayWidth;
            element.height = frame.displayHeight;
            element.getContext("2d")?.drawImage(frame, 0, 0, element.width, element.height);
            rendered = true; setState("ready"); setMessage("");
          }
          frame.close();
        },
        error: error => { if (!cancelled) { setState("error"); setMessage(error.message || `${analysis.codecName} 解码失败`); } },
      });
      decoder.configure(support.config ?? config);
      let decodeStart = framePosition;
      while (decodeStart > 0 && !frames[decodeStart].keyFrame) decodeStart--;
      if (!frames[decodeStart].keyFrame) decodeStart = 0;
      const decodeEnd = Math.min(frames.length - 1, framePosition + 16);
      for (let i = decodeStart; i <= decodeEnd; i++) {
        if (cancelled || decoder.state === "closed") break;
        const end = i + 1 < frames.length ? frames[i + 1].offset : bytes.length;
        let chunkData: Uint8Array = bytes.subarray(frames[i].offset, end);
        if (i === decodeStart) {
          const preceding = analysis.units.filter(unit => unit.index < frames[i].index);
          const parameterSets = analysis.parameterSetTypes.map(type => preceding.findLast(unit => unit.type === type)).filter((unit): unit is NalUnit => Boolean(unit)).sort((a, b) => a.index - b.index);
          if (parameterSets.length) {
            const byteLength = parameterSets.reduce((sum, unit) => sum + unit.size, 0) + chunkData.byteLength;
            const withHeaders = new Uint8Array(byteLength);
            let writeOffset = 0;
            for (const unit of parameterSets) {
              const data = bytes.subarray(unit.offset, unit.offset + unit.size);
              withHeaders.set(data, writeOffset); writeOffset += data.byteLength;
            }
            withHeaders.set(chunkData, writeOffset); chunkData = withHeaders;
          }
        }
        decoder.decode(new EncodedVideoChunk({
          type: frames[i].keyFrame ? "key" : "delta",
          timestamp: Math.round(i * 1_000_000 / (analysis.sps!.fps ?? 30)),
          data: chunkData,
        }));
      }
      await decoder.flush();
      if (!cancelled && !rendered) throw new Error("目标帧未产生可显示的图像");
    };
    decode().catch(error => { if (!cancelled) { setState("error"); setMessage(error instanceof Error ? error.message : `${analysis.codecName} 解码失败`); } });
    return () => { cancelled = true; if (decoder && decoder.state !== "closed") decoder.close(); };
  }, [analysis, bytes, framePosition, frames, target, unavailableMessage]);

  const displayState = unavailableMessage || !target ? "unsupported" : state;
  const displayMessage = unavailableMessage || (!target ? "码流中没有可解码的视频帧" : message);

  return <section className="decode-card">
    <div className="section-title"><div><span>01</span><h3>解码画面</h3></div><small>{target ? `FRAME ${framePosition + 1} / ${frames.length} · ${analysis.unitName} #${target.index}` : "NO FRAME"}</small></div>
    <div ref={canvasWrap} className="canvas-wrap" title="在画面上滚动鼠标以缩放">
      <div className="frame-stage" style={{ transform: `scale(${zoom})`, transformOrigin: `${zoomOrigin.x}% ${zoomOrigin.y}%` }}>
        <canvas ref={canvas} aria-label="当前选择位置的解码画面" />
        <canvas ref={macroblockCanvas} className={`macroblock-overlay ${showMacroblocks ? "visible" : ""}`} role="button" tabIndex={showMacroblocks ? 0 : -1} aria-label={`${analysis.blockName}网格，当前选择 ${macroblockAddress}`} onClick={event => selectMacroblockAt(event.clientX, event.clientY)} onKeyDown={event => {
          let next = macroblockAddress;
          if (event.key === "ArrowLeft") next--; else if (event.key === "ArrowRight") next++; else if (event.key === "ArrowUp") next -= macroblockColumns; else if (event.key === "ArrowDown") next += macroblockColumns; else return;
          event.preventDefault(); setSelectedMacroblock(Math.min(macroblockCount - 1, Math.max(0, next)));
        }} />
      </div>
      <div className="zoom-controls" aria-label="画面缩放控制">
        <button onClick={() => changeZoom(zoom / 1.25)} aria-label="缩小画面">−</button>
        <b aria-live="polite">{Math.round(zoom * 100)}%</b>
        <button onClick={() => changeZoom(zoom * 1.25)} aria-label="放大画面">+</button>
        <button className="fit" onClick={() => { setZoom(1); setZoomOrigin({ x: 50, y: 50 }); }}>适应</button>
      </div>
      {displayState !== "ready" && <div className={`decode-status ${displayState}`}><i />{displayMessage}</div>}
    </div>
    <div className="frame-controls">
      <button disabled={framePosition <= 0} onClick={() => onSelect(frames[framePosition - 1])}>← 上一帧</button>
      <input type="range" min="0" max={Math.max(0, frames.length - 1)} value={framePosition} onChange={event => onSelect(frames[Number(event.target.value)])} aria-label="选择解码帧" />
      <button disabled={framePosition >= frames.length - 1} onClick={() => onSelect(frames[framePosition + 1])}>下一帧 →</button>
    </div>
    <div className="macroblock-toolbar"><button className={showMacroblocks ? "active" : ""} onClick={() => setShowMacroblocks(value => !value)}><i />{analysis.blockName}网格 {showMacroblocks ? "ON" : "OFF"}</button><span>{macroblockColumns} × {macroblockRows} 个 {blockSize}×{blockSize} 亮度块 · 点击画面选择</span></div>
    {showMacroblocks && macroblockCount > 0 && <div className="macroblock-info">
      <div><span>{analysis.blockName}地址</span><strong>#{macroblockAddress}</strong><small>栅格扫描顺序</small></div>
      <div><span>位置</span><strong>R{macroblockRow} / C{macroblockColumn}</strong><small>x {macroblockColumn * blockSize}–{Math.min((macroblockColumn + 1) * blockSize - 1, (analysis.sps?.width ?? 1) - 1)} · y {macroblockRow * blockSize}–{Math.min((macroblockRow + 1) * blockSize - 1, (analysis.sps?.height ?? 1) - 1)}</small></div>
      <div><span>所属切片</span><strong>{macroblockSlice ? `${macroblockSlice.sliceType}-SLICE` : "—"}</strong><small>{macroblockSlice ? `MB ${macroblockSlice.firstMb}–${sliceEnd}` : "无切片信息"}</small></div>
      <div><span>块划分</span><strong>{blockSize}×{blockSize} {analysis.blockName}</strong><small>子块语法尚未熵解码</small></div>
      <div><span>{analysis.unitName} 单元</span><strong>{macroblockSlice ? `#${macroblockSlice.index} · ${analysis.codecKind === "av1" ? "O" : "T"}${macroblockSlice.type}` : "—"}</strong><small>{macroblockSlice ? `layer ${macroblockSlice.layerId ?? 0} · 0x${macroblockSlice.offset.toString(16)}` : "—"}</small></div>
      <div><span>色度覆盖</span><strong>{analysis.sps?.chromaFormat ?? "—"}</strong><small>{analysis.sps?.chromaFormat === "4:2:0" ? "Cb/Cr 各 8×8" : "由 SPS 色度格式决定"}</small></div>
    </div>}
  </section>;
}

export default function Analyzer() {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<NalUnit | null>(null);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [sourceBytes, setSourceBytes] = useState<Uint8Array | null>(null);

  const openFile = async (file: File) => {
    setError(""); setBusy(true);
    try {
      validateFile(file);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = analyzeBitstream(bytes, file.name);
      setAnalysis(result); setSourceBytes(bytes); setFileName(file.name); setSelected(result.units.find(unit => unit.keyFrame && unit.frameStart) ?? result.units.find(unit => unit.frameStart) ?? result.units[0] ?? null); setFilter("all"); setQuery("");
    } catch (err) { setAnalysis(null); setSourceBytes(null); setError(err instanceof Error ? err.message : "无法解析此文件"); }
    finally { setBusy(false); }
  };

  const filtered = useMemo(() => analysis?.units.filter(unit => {
    const q = query.trim().toLowerCase();
    return (filter === "all" || unit.type === Number(filter)) && (!q || unit.typeName.toLowerCase().includes(q) || String(unit.index).includes(q) || unit.sliceType?.toLowerCase().includes(q));
  }) ?? [], [analysis, filter, query]);
  const counts = analysis ? [...analysis.counts.entries()].sort((a, b) => b[1] - a[1]) : [];
  const maxCount = counts[0]?.[1] ?? 1;

  return <main className={`shell ${analysis ? "analysis-mode" : ""}`}>
    <header className="topbar">
      <button className="brand-button" onClick={() => setAnalysis(null)} aria-label="返回首页"><span className="brand-mark">B</span><span><strong>BitScope</strong><small>多编码码流分析器</small></span></button>
      {analysis && <div className="file-chip"><i />{fileName}<span>{formatBytes(analysis.totalBytes)}</span></div>}
      <div className="privacy-pill"><i /> 本地解析 · 文件不会上传</div>
    </header>
    {!analysis ? <section className="hero">
      <div className="hero-copy"><p className="eyebrow">AVC · HEVC · VVC · AV1</p><h1>看见码流里的<br /><em>每一个比特。</em></h1><p className="intro">拖入 H.264、H.265、H.266 裸码流或 AV1 OBU，快速检查参数集、编码单元与帧结构。无需安装，数据只在你的浏览器里流动。</p><div className="feature-row"><span>01 多编码识别</span><span>02 NAL / OBU 时间线</span><span>03 HEX 定位</span></div></div>
      <div><UploadPanel onFile={openFile} />{busy && <p className="status-msg">正在读取码流…</p>}{error && <p className="error-msg" role="alert">{error}</p>}</div>
    </section> : <div className="workspace">
      <section className="summary-head"><div><p className="eyebrow">{analysis.codecName} / 解析完成</p><h2>{analysis.sps ? `${analysis.sps.width} × ${analysis.sps.height}` : analysis.codecName}</h2></div><UploadPanel onFile={openFile} compact /></section>
      <section className="stats-grid">
        <Stat label="编码档次" value={analysis.sps?.profile ?? "未知"} note={analysis.sps ? `Level ${analysis.sps.level}` : `未解析到 ${analysis.parameterSetName}`} />
        <Stat label="图像尺寸" value={analysis.sps ? `${analysis.sps.width} × ${analysis.sps.height}` : "—"} note={analysis.sps?.frameMbsOnly ? "逐行编码" : analysis.sps ? "场编码" : undefined} />
        <Stat label="帧率" value={analysis.sps?.fps ? `${analysis.sps.fps.toFixed(3)} fps` : "—"} note={analysis.sps?.fps ? (analysis.codecKind === "av1" ? "来自 Sequence Header timing_info" : "来自 VUI timing_info") : "码流未声明"} />
        <Stat label="帧 / 关键帧" value={`${analysis.frameCount} / ${analysis.idrCount}`} note={analysis.duration ? `约 ${analysis.duration.toFixed(2)} 秒` : `${analysis.units.length} 个 ${analysis.unitName}`} />
      </section>
      {sourceBytes && <DecodedPreview bytes={sourceBytes} analysis={analysis} selected={selected} onSelect={setSelected} />}
      <section className="timeline-card">
        <div className="section-title"><div><span>02</span><h3>{analysis.unitName} 时间线</h3></div><small>选择帧单元时，解码画面同步定位</small></div>
        <div className="timeline" aria-label={`${analysis.unitName} 单元时间线`}>{analysis.units.slice(0, 500).map(unit => <button key={unit.index} title={`#${unit.index} ${unit.typeName}`} aria-label={`${analysis.unitName} ${unit.index} ${unit.typeName}`} className={selected?.index === unit.index ? "active" : ""} style={{ background: unitColor(unit.type, analysis.codecKind) }} onClick={() => setSelected(unit)} />)}</div>
        {analysis.units.length > 500 && <p className="limit-note">时间线显示前 500 个单元；完整数据可在下方列表检索。</p>}
        <div className="legend"><span><i style={{background:"#ff6b35"}}/>关键帧</span><span><i style={{background:"#3b82f6"}}/>帧 / Slice</span><span><i style={{background:"#d9ff43"}}/>序列参数</span><span><i style={{background:"#b794f4"}}/>图像 / Tile 参数</span><span><i style={{background:"#f6c445"}}/>元数据</span></div>
      </section>
      <div className="content-grid">
        <section className="nal-card">
          <div className="section-title"><div><span>03</span><h3>{analysis.unitName} 单元</h3></div><small>{filtered.length} / {analysis.units.length}</small></div>
          <div className="filters"><select value={filter} onChange={e => setFilter(e.target.value)} aria-label={`按 ${analysis.unitName} 类型筛选`}><option value="all">全部类型</option>{counts.map(([type]) => <option key={type} value={type}>{analysis.codecKind === "av1" ? "O" : "T"}{type} · {analysis.units.find(u => u.type === type)?.typeName}</option>)}</select><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索序号、类型、帧…" aria-label={`搜索 ${analysis.unitName} 单元`} /></div>
          <div className="nal-table" role="table"><div className="nal-row table-head" role="row"><span>#</span><span>类型</span><span>帧 / 切片</span><span>大小</span><span>偏移</span></div>{filtered.slice(0, 300).map(unit => <button className={`nal-row ${selected?.index === unit.index ? "selected" : ""}`} key={unit.index} onClick={() => setSelected(unit)} role="row"><span>{String(unit.index).padStart(4, "0")}</span><span><NalBadge unit={unit} codec={analysis.codecKind} /> {unit.typeName}</span><span>{unit.sliceType ?? "—"}</span><span>{formatBytes(unit.size)}</span><span>0x{unit.offset.toString(16).padStart(8,"0")}</span></button>)}</div>
          {filtered.length > 300 && <p className="limit-note">为保持流畅，仅展示前 300 条匹配结果。</p>}
        </section>
        <aside>
          <section className="detail-card"><div className="section-title"><div><span>04</span><h3>单元详情</h3></div></div>{selected ? <><div className="detail-title"><NalBadge unit={selected} codec={analysis.codecKind}/><div><b>{selected.typeName}</b><small>{analysis.unitName} #{selected.index}</small></div></div><dl><div><dt>{analysis.codecKind === "av1" ? "obu_type" : "nal_unit_type"}</dt><dd>{selected.type}</dd></div>{analysis.codecKind === "h264" ? <div><dt>nal_ref_idc</dt><dd>{selected.refIdc}</dd></div> : <><div><dt>layer_id</dt><dd>{selected.layerId ?? 0}</dd></div><div><dt>temporal_id</dt><dd>{selected.temporalId ?? 0}</dd></div></>}<div><dt>{analysis.unitName === "NAL" ? "start_code" : "header_size"}</dt><dd>{analysis.unitName === "NAL" ? selected.startCodeSize : selected.headerSize ?? 1} bytes</dd></div><div><dt>payload_size</dt><dd>{formatBytes(Math.max(0, selected.size - selected.startCodeSize - (selected.headerSize ?? 1)))}</dd></div>{selected.sliceType && <div><dt>frame_or_slice_type</dt><dd>{selected.sliceType}</dd></div>}{selected.firstMb !== undefined && <div><dt>first_block_in_slice</dt><dd>{selected.firstMb}</dd></div>}</dl><p className="hex-label">HEX PREVIEW · 前 48 字节</p><pre>{selected.hex}</pre></> : <p>选择一个 {analysis.unitName} 单元查看详情。</p>}</section>
          <section className="distribution-card"><div className="section-title"><div><span>05</span><h3>类型分布</h3></div></div>{counts.slice(0, 7).map(([type, count]) => <div className="bar-row" key={type}><span>{analysis.codecKind === "av1" ? "O" : "T"}{type}</span><div><i style={{width:`${Math.max(4, count / maxCount * 100)}%`,background:unitColor(type, analysis.codecKind)}}/></div><b>{count}</b></div>)}</section>
          {analysis.sps && <section className="stream-card"><div className="section-title"><div><span>06</span><h3>{analysis.parameterSetName}</h3></div></div><dl><div><dt>profile_idc</dt><dd>{analysis.sps.profileIdc}</dd></div><div><dt>level</dt><dd>{analysis.sps.level}</dd></div><div><dt>chroma_format</dt><dd>{analysis.sps.chromaFormat}</dd></div><div><dt>bit_depth</dt><dd>{analysis.sps.bitDepth} bit</dd></div><div><dt>coding_block</dt><dd>{analysis.blockSize} × {analysis.blockSize}</dd></div></dl></section>}
        </aside>
      </div>
    </div>}
    <footer>BITSTREAM, MADE LEGIBLE <span>{analysis ? "ANALYZED LOCALLY" : "01"}</span></footer>
  </main>;
}
