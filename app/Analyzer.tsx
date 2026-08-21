"use client";

import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";
import { Analysis, NalUnit, analyzeH264, formatBytes, nalColor } from "./h264";

const MAX_FILE_SIZE = 200 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".h264", ".264", ".avc"];

function validateFile(file: File) {
  const lower = file.name.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some(ext => lower.endsWith(ext))) throw new Error("请选择 .h264、.264 或 .avc 裸码流文件");
  if (file.size === 0) throw new Error("文件是空的");
  if (file.size > MAX_FILE_SIZE) throw new Error("文件超过 200 MB 上限");
}

function UploadPanel({ onFile, compact = false }: { onFile: (file: File) => void; compact?: boolean }) {
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const accept = (files: FileList | null) => { if (files?.[0]) onFile(files[0]); };
  return <div className={`dropzone ${dragging ? "dragging" : ""} ${compact ? "compact" : ""}`} role="button" tabIndex={0} aria-label="选择 H.264 码流文件" onClick={() => input.current?.click()} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") input.current?.click(); }} onDragOver={(e: DragEvent) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e: DragEvent) => { e.preventDefault(); setDragging(false); accept(e.dataTransfer.files); }}>
    <input ref={input} type="file" accept=".h264,.264,.avc,video/h264" onChange={(e: ChangeEvent<HTMLInputElement>) => accept(e.target.files)} />
    <span className="drop-icon">↓</span><b>{compact ? "打开另一个文件" : "拖放 H.264 文件到这里"}</b>{!compact && <small>或点击选择文件 · 最大 200 MB</small>}
  </div>;
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="stat"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>;
}

function NalBadge({ unit }: { unit: NalUnit }) { return <span className="nal-badge" style={{ background: nalColor(unit.type) }}>T{unit.type}</span>; }

export default function Analyzer() {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<NalUnit | null>(null);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const openFile = async (file: File) => {
    setError(""); setBusy(true);
    try {
      validateFile(file);
      const result = analyzeH264(new Uint8Array(await file.arrayBuffer()));
      setAnalysis(result); setFileName(file.name); setSelected(result.units[0] ?? null); setFilter("all"); setQuery("");
    } catch (err) { setAnalysis(null); setError(err instanceof Error ? err.message : "无法解析此文件"); }
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
      <button className="brand-button" onClick={() => setAnalysis(null)} aria-label="返回首页"><span className="brand-mark">B</span><span><strong>BitScope</strong><small>H.264 码流分析器</small></span></button>
      {analysis && <div className="file-chip"><i />{fileName}<span>{formatBytes(analysis.totalBytes)}</span></div>}
      <div className="privacy-pill"><i /> 本地解析 · 文件不会上传</div>
    </header>
    {!analysis ? <section className="hero">
      <div className="hero-copy"><p className="eyebrow">H.264 / AVC · ANNEX B</p><h1>看见码流里的<br /><em>每一个比特。</em></h1><p className="intro">把裸 H.264 码流拖进来，快速检查序列参数、NAL 单元与帧结构。无需安装，数据只在你的浏览器里流动。</p><div className="feature-row"><span>01 SPS / PPS</span><span>02 NAL 时间线</span><span>03 HEX 定位</span></div></div>
      <div><UploadPanel onFile={openFile} />{busy && <p className="status-msg">正在读取码流…</p>}{error && <p className="error-msg" role="alert">{error}</p>}</div>
    </section> : <div className="workspace">
      <section className="summary-head"><div><p className="eyebrow">ANALYSIS / 解析完成</p><h2>{analysis.sps ? `${analysis.sps.width} × ${analysis.sps.height}` : "H.264 Annex-B"}</h2></div><UploadPanel onFile={openFile} compact /></section>
      <section className="stats-grid">
        <Stat label="编码档次" value={analysis.sps?.profile ?? "未知"} note={analysis.sps ? `Level ${analysis.sps.level}` : "未解析到 SPS"} />
        <Stat label="图像尺寸" value={analysis.sps ? `${analysis.sps.width} × ${analysis.sps.height}` : "—"} note={analysis.sps?.frameMbsOnly ? "逐行编码" : analysis.sps ? "场编码" : undefined} />
        <Stat label="帧率" value={analysis.sps?.fps ? `${analysis.sps.fps.toFixed(3)} fps` : "—"} note={analysis.sps?.fps ? "来自 VUI timing_info" : "码流未声明"} />
        <Stat label="帧 / IDR" value={`${analysis.frameCount} / ${analysis.idrCount}`} note={analysis.duration ? `约 ${analysis.duration.toFixed(2)} 秒` : `${analysis.units.length} 个 NAL`} />
      </section>
      <section className="timeline-card"><div className="section-title"><div><span>01</span><h3>NAL 时间线</h3></div><small>每格代表一个 NAL 单元 · 点击定位</small></div><div className="timeline" aria-label="NAL 单元时间线">{analysis.units.slice(0, 500).map(unit => <button key={unit.index} title={`#${unit.index} ${unit.typeName}`} aria-label={`NAL ${unit.index} ${unit.typeName}`} className={selected?.index === unit.index ? "active" : ""} style={{ background: nalColor(unit.type) }} onClick={() => setSelected(unit)} />)}</div>{analysis.units.length > 500 && <p className="limit-note">时间线显示前 500 个单元；完整数据可在下方列表检索。</p>}<div className="legend"><span><i style={{background:"#ff6b35"}}/>IDR</span><span><i style={{background:"#3b82f6"}}/>Slice</span><span><i style={{background:"#d9ff43"}}/>SPS</span><span><i style={{background:"#b794f4"}}/>PPS</span><span><i style={{background:"#f6c445"}}/>SEI</span></div></section>
      <div className="content-grid">
        <section className="nal-card"><div className="section-title"><div><span>02</span><h3>NAL 单元</h3></div><small>{filtered.length} / {analysis.units.length}</small></div><div className="filters"><select value={filter} onChange={e => setFilter(e.target.value)} aria-label="按 NAL 类型筛选"><option value="all">全部类型</option>{counts.map(([type]) => <option key={type} value={type}>T{type} · {analysis.units.find(u => u.type === type)?.typeName}</option>)}</select><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索序号、类型、切片…" aria-label="搜索 NAL 单元" /></div><div className="nal-table" role="table"><div className="nal-row table-head" role="row"><span>#</span><span>类型</span><span>切片</span><span>大小</span><span>偏移</span></div>{filtered.slice(0, 300).map(unit => <button className={`nal-row ${selected?.index === unit.index ? "selected" : ""}`} key={unit.index} onClick={() => setSelected(unit)} role="row"><span>{String(unit.index).padStart(4, "0")}</span><span><NalBadge unit={unit} /> {unit.typeName}</span><span>{unit.sliceType ?? "—"}</span><span>{formatBytes(unit.size)}</span><span>0x{unit.offset.toString(16).padStart(8,"0")}</span></button>)}</div>{filtered.length > 300 && <p className="limit-note">为保持流畅，仅展示前 300 条匹配结果。</p>}</section>
        <aside>
          <section className="detail-card"><div className="section-title"><div><span>03</span><h3>单元详情</h3></div></div>{selected ? <><div className="detail-title"><NalBadge unit={selected}/><div><b>{selected.typeName}</b><small>NAL #{selected.index}</small></div></div><dl><div><dt>nal_unit_type</dt><dd>{selected.type}</dd></div><div><dt>nal_ref_idc</dt><dd>{selected.refIdc}</dd></div><div><dt>start_code</dt><dd>{selected.startCodeSize} bytes</dd></div><div><dt>payload_size</dt><dd>{formatBytes(selected.size - selected.startCodeSize - 1)}</dd></div>{selected.sliceType && <div><dt>slice_type</dt><dd>{selected.sliceType}</dd></div>}{selected.firstMb !== undefined && <div><dt>first_mb_in_slice</dt><dd>{selected.firstMb}</dd></div>}</dl><p className="hex-label">HEX PREVIEW · 前 48 字节</p><pre>{selected.hex}</pre></> : <p>选择一个 NAL 单元查看详情。</p>}</section>
          <section className="distribution-card"><div className="section-title"><div><span>04</span><h3>类型分布</h3></div></div>{counts.slice(0, 7).map(([type, count]) => <div className="bar-row" key={type}><span>T{type}</span><div><i style={{width:`${Math.max(4, count / maxCount * 100)}%`,background:nalColor(type)}}/></div><b>{count}</b></div>)}</section>
          {analysis.sps && <section className="stream-card"><div className="section-title"><div><span>05</span><h3>SPS 参数</h3></div></div><dl><div><dt>profile_idc</dt><dd>{analysis.sps.profileIdc}</dd></div><div><dt>chroma_format</dt><dd>{analysis.sps.chromaFormat}</dd></div><div><dt>bit_depth</dt><dd>{analysis.sps.bitDepth} bit</dd></div><div><dt>seq_parameter_set_id</dt><dd>{analysis.sps.spsId}</dd></div></dl></section>}
        </aside>
      </div>
    </div>}
    <footer>BITSTREAM, MADE LEGIBLE <span>{analysis ? "ANALYZED LOCALLY" : "01"}</span></footer>
  </main>;
}
