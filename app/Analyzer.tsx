"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { Analysis, CodecKind, NalUnit, SUPPORTED_EXTENSIONS, analyzeBitstream, formatBytes, unitColor } from "./codecs";
import { H264SubblockAnalysis, analyzeH264Subblocks } from "./h264-subblocks";
import { Av1LeafBlock, Av1SubblockAnalysis, inspectAv1Subblocks } from "./av1-subblocks";
import { Locale, getCopy, localizeAv1IntraModeName, localizeBlockName, localizeH264IntraModeName, localizeParameterSetName, localizeTypeName } from "./i18n";
import { MAX_RESIDUAL_PIXELS, MAX_RESIDUAL_REGIONS, ResidualRegion, buildResidualImage, scaleResidualRegions } from "./residual";

const MAX_FILE_SIZE = 200 * 1024 * 1024;
const MAX_INTRA_MODE_SAMPLES = 1_000_000;
const ACCEPTED_FILES = ".h264,.264,.avc,.h265,.265,.hevc,.h266,.266,.vvc,.av1,.obu,.ivf,video/h264,video/h265,video/av1";

type ModeDistribution = {
  items: Array<{ key: string; name: string; count: number }>;
  sampledCount: number;
  limited: boolean;
};

type IntraModeEntry = { key: string; name: string };

function summarizeModes(entries: Iterable<IntraModeEntry>, locale: Locale): ModeDistribution | null {
  const counts = new Map<string, { name: string; count: number }>();
  let sampledCount = 0;
  let limited = false;
  for (const entry of entries) {
    if (sampledCount >= MAX_INTRA_MODE_SAMPLES) { limited = true; break; }
    const current = counts.get(entry.key);
    counts.set(entry.key, { name: entry.name, count: (current?.count ?? 0) + 1 });
    sampledCount += 1;
  }
  const items = [...counts.entries()].map(([key, value]) => ({ key, ...value })).sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, locale));
  return items.length ? { items, sampledCount, limited } : null;
}

function* h264IntraModeEntries(analysis: H264SubblockAnalysis | null, locale: Locale): Generator<IntraModeEntry> {
  for (const macroblock of analysis?.macroblocks ?? []) {
    for (const mode of macroblock?.intraModes ?? []) yield { key: mode.name, name: localizeH264IntraModeName(mode.name, locale) };
  }
}

function* av1IntraModeEntries(analysis: Av1SubblockAnalysis | null, locale: Locale): Generator<IntraModeEntry> {
  if (analysis?.status !== "ready") return;
  for (const block of analysis.blocks) {
    if (block.intraMode) yield { key: block.mode, name: localizeAv1IntraModeName(block.mode, block.intraMode.name, locale) };
  }
}

function* h264InterModeEntries(analysis: H264SubblockAnalysis | null): Generator<IntraModeEntry> {
  for (const macroblock of analysis?.macroblocks ?? []) {
    for (const vector of macroblock?.motionVectors ?? []) {
      const mode = macroblock?.skipped ? "P_SKIP" : vector.mode.startsWith("P_") ? vector.mode : `P_L0_${vector.mode}`;
      yield { key: mode, name: mode };
    }
  }
}

function* av1InterModeEntries(analysis: Av1SubblockAnalysis | null): Generator<IntraModeEntry> {
  if (analysis?.status !== "ready") return;
  for (const block of analysis.blocks) if (!block.intraMode && block.motionVectors.length) yield { key: block.mode, name: block.mode };
}

function validateFile(file: File, locale: Locale) {
  const copy = getCopy(locale);
  const lower = file.name.toLowerCase();
  if (!SUPPORTED_EXTENSIONS.some(ext => lower.endsWith(ext))) throw new Error(copy.invalidFile);
  if (file.size === 0) throw new Error(copy.emptyFile);
  if (file.size > MAX_FILE_SIZE) throw new Error(copy.fileTooLarge);
}

function UploadPanel({ onFile, locale, compact = false }: { onFile: (file: File) => void; locale: Locale; compact?: boolean }) {
  const copy = getCopy(locale);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const accept = (files: FileList | null) => { if (files?.[0]) onFile(files[0]); };
  return <div className={`dropzone ${dragging ? "dragging" : ""} ${compact ? "compact" : ""}`} role="button" tabIndex={0} aria-label={copy.chooseFileAria} onClick={() => input.current?.click()} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") input.current?.click(); }} onDragOver={(e: DragEvent) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e: DragEvent) => { e.preventDefault(); setDragging(false); accept(e.dataTransfer.files); }}>
    <input ref={input} type="file" accept={ACCEPTED_FILES} onChange={(e: ChangeEvent<HTMLInputElement>) => accept(e.target.files)} />
    <span className="drop-icon">↓</span><b>{compact ? copy.openAnother : copy.dropFile}</b>{!compact && <small>{copy.fileFormats}</small>}
  </div>;
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="stat"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>;
}

function NalBadge({ unit, codec }: { unit: NalUnit; codec: CodecKind }) { return <span className="nal-badge" style={{ background: unitColor(unit.type, codec) }}>{codec === "av1" ? "O" : "T"}{unit.type}</span>; }

function addDirectionPath(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, angle: number | undefined, minimumSize: number) {
  if (angle === undefined || Math.min(width, height) < minimumSize) return false;
  const radians = angle * Math.PI / 180;
  const directionX = Math.cos(radians);
  const directionY = Math.sin(radians);
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const halfLength = Math.max(minimumSize === 4 ? 1.2 : 2.5, Math.min(width, height) * .3);
  const startX = centerX - directionX * halfLength;
  const startY = centerY - directionY * halfLength;
  const endX = centerX + directionX * halfLength;
  const endY = centerY + directionY * halfLength;
  const arrowLength = Math.min(minimumSize === 4 ? 1.8 : 3.5, halfLength * .45);
  const reverse = radians + Math.PI;

  context.moveTo(startX, startY);
  context.lineTo(endX, endY);
  context.moveTo(endX, endY);
  context.lineTo(endX + Math.cos(reverse - Math.PI / 6) * arrowLength, endY + Math.sin(reverse - Math.PI / 6) * arrowLength);
  context.moveTo(endX, endY);
  context.lineTo(endX + Math.cos(reverse + Math.PI / 6) * arrowLength, endY + Math.sin(reverse + Math.PI / 6) * arrowLength);
  return true;
}

function addAv1DirectionPath(context: CanvasRenderingContext2D, block: Av1LeafBlock) {
  return addDirectionPath(context, block.x, block.y, block.width, block.height, block.intraMode?.nominalAngle, 8);
}

function addMotionVectorPath(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, mvX: number, mvY: number, unitsPerPixel: number) {
  if (![x, y, width, height, mvX, mvY, unitsPerPixel].every(Number.isFinite) || unitsPerPixel <= 0) return false;
  const centerX = x + width / 2, centerY = y + height / 2;
  let dx = mvX / unitsPerPixel, dy = mvY / unitsPerPixel;
  const rawLength = Math.hypot(dx, dy);
  if (rawLength < .01) {
    const radius = Math.max(1.5, Math.min(width, height) * .12);
    context.moveTo(centerX - radius, centerY); context.lineTo(centerX + radius, centerY);
    context.moveTo(centerX, centerY - radius); context.lineTo(centerX, centerY + radius);
    return true;
  }
  const maximumLength = Math.max(8, Math.min(64, Math.max(width, height) * 2));
  if (rawLength > maximumLength) { const scale = maximumLength / rawLength; dx *= scale; dy *= scale; }
  const endX = centerX + dx, endY = centerY + dy;
  const angle = Math.atan2(dy, dx), arrowLength = Math.max(2.5, Math.min(6, Math.min(width, height) * .3));
  context.moveTo(centerX, centerY); context.lineTo(endX, endY);
  context.moveTo(endX, endY); context.lineTo(endX - Math.cos(angle - Math.PI / 6) * arrowLength, endY - Math.sin(angle - Math.PI / 6) * arrowLength);
  context.moveTo(endX, endY); context.lineTo(endX - Math.cos(angle + Math.PI / 6) * arrowLength, endY - Math.sin(angle + Math.PI / 6) * arrowLength);
  return true;
}

function residualRegionsForFrame(codec: CodecKind, h264: H264SubblockAnalysis | null, av1: Av1SubblockAnalysis | null, macroblockColumns: number): ResidualRegion[] {
  const regions: ResidualRegion[] = [];
  const add = (region: ResidualRegion) => { if (regions.length < MAX_RESIDUAL_REGIONS) regions.push(region); };
  if (codec === "h264") {
    for (const macroblock of h264?.macroblocks ?? []) {
      if (regions.length >= MAX_RESIDUAL_REGIONS) break;
      if (!macroblock) continue;
      const originX = macroblockColumns ? (macroblock.address % macroblockColumns) * 16 : 0;
      const originY = macroblockColumns ? Math.floor(macroblock.address / macroblockColumns) * 16 : 0;
      if (macroblock.intraModes?.length) {
        for (const mode of macroblock.intraModes) add({ kind: "intra", x: originX + mode.x, y: originY + mode.y, width: mode.width, height: mode.height });
      } else {
        for (const vector of macroblock.motionVectors ?? []) {
          if (vector.reference !== 0) continue;
          add({ kind: "inter", x: originX + vector.x, y: originY + vector.y, width: vector.width, height: vector.height, mvX: vector.mvX, mvY: vector.mvY, unitsPerPixel: 4 });
        }
      }
    }
  } else if (codec === "av1" && av1?.status === "ready") {
    for (const block of av1.blocks) {
      if (regions.length >= MAX_RESIDUAL_REGIONS) break;
      if (block.intraMode) add({ kind: "intra", x: block.x, y: block.y, width: block.width, height: block.height });
      else {
        const vector = block.motionVectors.find(candidate => candidate.referenceName === "LAST_FRAME");
        if (vector) add({ kind: "inter", x: block.x, y: block.y, width: block.width, height: block.height, mvX: vector.mvX, mvY: vector.mvY, unitsPerPixel: 8 });
      }
    }
  }
  return regions;
}

function DecodedPreview({ bytes, analysis, selected, onSelect, onIntraModeDistributionChange, onInterModeDistributionChange, locale }: { bytes: Uint8Array; analysis: Analysis; selected: NalUnit | null; onSelect: (unit: NalUnit) => void; onIntraModeDistributionChange: (distribution: ModeDistribution | null) => void; onInterModeDistributionChange: (distribution: ModeDistribution | null) => void; locale: Locale }) {
  const copy = getCopy(locale);
  const canvas = useRef<HTMLCanvasElement>(null);
  const residualCanvas = useRef<HTMLCanvasElement>(null);
  const macroblockCanvas = useRef<HTMLCanvasElement>(null);
  const canvasWrap = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"decoding" | "ready" | "unsupported" | "error">("decoding");
  const [message, setMessage] = useState(copy.decoderInitializing);
  const [showMacroblocks, setShowMacroblocks] = useState(true);
  const [showIntraModes, setShowIntraModes] = useState(true);
  const [showInterModes, setShowInterModes] = useState(true);
  const [pictureView, setPictureView] = useState<"final" | "residual">("final");
  const [residualGain, setResidualGain] = useState(2);
  const [residualSummary, setResidualSummary] = useState<{ available: boolean; coveredPixels: number; totalPixels: number; intraPixels: number; interPixels: number } | null>(null);
  const [selectedMacroblock, setSelectedMacroblock] = useState(0);
  const [selectedAv1Block, setSelectedAv1Block] = useState(0);
  const [av1Inspection, setAv1Inspection] = useState<{ source: Uint8Array; framePosition: number; result: Av1SubblockAnalysis } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [zoomOrigin, setZoomOrigin] = useState({ x: 50, y: 50 });
  const frames = useMemo(() => analysis.units.filter(unit => unit.frameStart), [analysis]);
  const framePosition = Math.max(0, frames.findLastIndex(frame => frame.index <= (selected?.index ?? 0)));
  const target = frames[framePosition];
  const h264Subblocks = useMemo(() => target ? analyzeH264Subblocks(bytes, analysis, target.index) : null, [analysis, bytes, target]);
  const av1Subblocks = av1Inspection?.source === bytes && av1Inspection.framePosition === framePosition ? av1Inspection.result : null;
  const av1SubblocksLoading = analysis.codecKind === "av1" && Boolean(target) && av1Subblocks === null;
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
  const parsedMacroblock = h264Subblocks?.macroblocks[macroblockAddress];
  const h264IntraModesAvailable = useMemo(() => Boolean(h264Subblocks?.macroblocks.some(macroblock => macroblock?.intraModes?.length)), [h264Subblocks]);
  const intraModesAvailable = analysis.codecKind === "av1" ? av1Subblocks?.status === "ready" : analysis.codecKind === "h264" ? h264IntraModesAvailable : false;
  const h264InterModesAvailable = useMemo(() => Boolean(h264Subblocks?.macroblocks.some(macroblock => macroblock?.motionVectors?.length)), [h264Subblocks]);
  const interModesAvailable = analysis.codecKind === "av1" ? Boolean(av1Subblocks?.status === "ready" && av1Subblocks.blocks.some(block => block.motionVectors.length)) : analysis.codecKind === "h264" ? h264InterModesAvailable : false;
  const residualRegions = useMemo(() => residualRegionsForFrame(analysis.codecKind, h264Subblocks, av1Subblocks, macroblockColumns), [analysis.codecKind, av1Subblocks, h264Subblocks, macroblockColumns]);
  const h264IntraModeSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const mode of parsedMacroblock?.intraModes ?? []) counts.set(mode.name, (counts.get(mode.name) ?? 0) + 1);
    return [...counts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 4).map(([name, count]) => `${localizeH264IntraModeName(name, locale)} ×${count}`).join(" · ");
  }, [locale, parsedMacroblock]);
  const av1LeafBlock = av1Subblocks?.status === "ready" ? av1Subblocks.blocks[selectedAv1Block] : undefined;
  const av1IntraModeName = av1LeafBlock?.intraMode ? localizeAv1IntraModeName(av1LeafBlock.mode, av1LeafBlock.intraMode.name, locale) : undefined;
  const intraModeDistribution = useMemo<ModeDistribution | null>(() => {
    if (!showIntraModes || !intraModesAvailable) return null;
    return summarizeModes(analysis.codecKind === "h264" ? h264IntraModeEntries(h264Subblocks, locale) : av1IntraModeEntries(av1Subblocks, locale), locale);
  }, [analysis.codecKind, av1Subblocks, h264Subblocks, intraModesAvailable, locale, showIntraModes]);
  const interModeDistribution = useMemo<ModeDistribution | null>(() => {
    if (!showInterModes || !interModesAvailable) return null;
    return summarizeModes(analysis.codecKind === "h264" ? h264InterModeEntries(h264Subblocks) : av1InterModeEntries(av1Subblocks), locale);
  }, [analysis.codecKind, av1Subblocks, h264Subblocks, interModesAvailable, locale, showInterModes]);
  const blockUnit = analysis.codecKind === "av1" ? target : macroblockSlice;
  const sliceEnd = Math.min(macroblockCount - 1, (frameSlices[slicePosition + 1]?.firstMb ?? macroblockCount) - 1);
  const blockName = localizeBlockName(analysis.blockName, locale);
  const parameterSetName = localizeParameterSetName(analysis.parameterSetName, locale);
  const h264StatusMessage = h264Subblocks ? locale === "en" ? `${h264Subblocks.parsedCount.toLocaleString("en-US")} macroblocks parsed${h264Subblocks.status === "partial" ? " · partial result" : ""}` : h264Subblocks.message : "";
  const av1StatusMessage = av1Subblocks?.status === "ready" ? locale === "en" ? `libaom inspection · ${av1Subblocks.blocks.length.toLocaleString("en-US")} entropy-decoded leaf blocks` : av1Subblocks.message : av1Subblocks ? locale === "en" ? "AV1 leaf-block inspection is unavailable for this file" : av1Subblocks.message : copy.waitingForAv1;
  const unavailableMessage = analysis.codecKind === "h266" ? copy.vvcUnsupported : !analysis.sps ? `${copy.missingDecoderConfig} ${parameterSetName}` : typeof VideoDecoder === "undefined" ? copy.webCodecsUnsupported : "";

  useEffect(() => {
    onIntraModeDistributionChange(intraModeDistribution);
  }, [intraModeDistribution, onIntraModeDistributionChange]);

  useEffect(() => {
    onInterModeDistributionChange(interModeDistribution);
  }, [interModeDistribution, onInterModeDistributionChange]);

  useEffect(() => () => { onIntraModeDistributionChange(null); onInterModeDistributionChange(null); }, [onInterModeDistributionChange, onIntraModeDistributionChange]);

  useEffect(() => {
    let cancelled = false;
    if (analysis.codecKind !== "av1" || !target) return;
    const controller = new AbortController();
    inspectAv1Subblocks(bytes, analysis, framePosition, controller.signal).then(result => {
      if (cancelled) return;
      setAv1Inspection({ source: bytes, framePosition, result });
      setSelectedAv1Block(0);
      if (result.status === "ready" && result.blocks[0]) setSelectedMacroblock(result.blocks[0].superblockAddress);
    });
    return () => { cancelled = true; controller.abort(); };
  }, [analysis, bytes, framePosition, target]);

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
    if (analysis.codecKind === "h264" && h264Subblocks) {
      context.beginPath();
      let partitionBudget = 20_000;
      for (const macroblock of h264Subblocks.macroblocks) {
        if (!macroblock || macroblock.partitions.length <= 1 || partitionBudget <= 0) continue;
        const originX = (macroblock.address % macroblockColumns) * 16;
        const originY = Math.floor(macroblock.address / macroblockColumns) * 16;
        for (const partition of macroblock.partitions) {
          if (partitionBudget-- <= 0) break;
          context.rect(originX + partition.x + .5, originY + partition.y + .5, partition.width, partition.height);
        }
      }
      context.lineWidth = Math.max(.65, sps.width / 2400);
      context.strokeStyle = "rgba(63,224,255,.8)"; context.stroke();
      if (showIntraModes) {
        context.beginPath();
        let modeBudget = 50_000;
        let macroblockScanBudget = 100_000;
        for (const macroblock of h264Subblocks.macroblocks) {
          if (modeBudget <= 0 || macroblockScanBudget-- <= 0) break;
          if (!macroblock?.intraModes) continue;
          const originX = (macroblock.address % macroblockColumns) * 16;
          const originY = Math.floor(macroblock.address / macroblockColumns) * 16;
          for (const mode of macroblock.intraModes) {
            if (modeBudget <= 0) break;
            if (addDirectionPath(context, originX + mode.x, originY + mode.y, mode.width, mode.height, mode.angle, 4)) modeBudget -= 1;
          }
        }
        context.lineWidth = Math.max(.8, sps.width / 1800);
        context.lineCap = "round";
        context.lineJoin = "round";
        context.strokeStyle = "rgba(255,107,53,.94)"; context.stroke();
      }
      if (showInterModes) {
        context.beginPath();
        let vectorBudget = 50_000;
        for (const macroblock of h264Subblocks.macroblocks) {
          if (vectorBudget <= 0) break;
          if (!macroblock?.motionVectors) continue;
          const originX = (macroblock.address % macroblockColumns) * 16;
          const originY = Math.floor(macroblock.address / macroblockColumns) * 16;
          for (const vector of macroblock.motionVectors) {
            if (vectorBudget-- <= 0) break;
            addMotionVectorPath(context, originX + vector.x, originY + vector.y, vector.width, vector.height, vector.mvX, vector.mvY, 4);
          }
        }
        context.lineWidth = Math.max(1, sps.width / 1700); context.lineCap = "round"; context.lineJoin = "round";
        context.strokeStyle = "rgba(183,148,244,.96)"; context.stroke();
      }
    }
    if (analysis.codecKind === "av1" && av1Subblocks?.status === "ready") {
      context.beginPath();
      let leafBudget = 100_000;
      for (const block of av1Subblocks.blocks) {
        if (leafBudget-- <= 0) break;
        context.rect(block.x + .5, block.y + .5, block.width, block.height);
      }
      context.lineWidth = Math.max(.65, sps.width / 2400);
      context.strokeStyle = "rgba(63,224,255,.82)"; context.stroke();
      if (showIntraModes) {
        context.beginPath();
        let directionBudget = 50_000;
        let directionScanBudget = 100_000;
        for (const block of av1Subblocks.blocks) {
          if (directionBudget <= 0 || directionScanBudget-- <= 0) break;
          if (addAv1DirectionPath(context, block)) directionBudget -= 1;
        }
        context.lineWidth = Math.max(.9, sps.width / 1800);
        context.lineCap = "round";
        context.lineJoin = "round";
        context.strokeStyle = "rgba(255,107,53,.94)"; context.stroke();
      }
      if (showInterModes) {
        context.beginPath();
        let vectorBudget = 50_000;
        for (const block of av1Subblocks.blocks) {
          if (vectorBudget <= 0) break;
          for (const vector of block.motionVectors) {
            if (vectorBudget-- <= 0) break;
            addMotionVectorPath(context, block.x, block.y, block.width, block.height, vector.mvX, vector.mvY, 8);
          }
        }
        context.lineWidth = Math.max(1, sps.width / 1700); context.lineCap = "round"; context.lineJoin = "round";
        context.strokeStyle = "rgba(183,148,244,.96)"; context.stroke();
      }
    }
    const selectedX = av1LeafBlock?.x ?? macroblockColumn * blockSize;
    const selectedY = av1LeafBlock?.y ?? macroblockRow * blockSize;
    const selectedWidth = av1LeafBlock?.width ?? Math.min(blockSize, sps.width - macroblockColumn * blockSize);
    const selectedHeight = av1LeafBlock?.height ?? Math.min(blockSize, sps.height - macroblockRow * blockSize);
    context.fillStyle = "rgba(255,107,53,.34)";
    context.fillRect(selectedX, selectedY, selectedWidth, selectedHeight);
    context.strokeStyle = "#ff6b35"; context.lineWidth = Math.max(2, sps.width / 700);
    context.strokeRect(selectedX + 1, selectedY + 1, Math.max(0, selectedWidth - 2), Math.max(0, selectedHeight - 2));
    if (parsedMacroblock) {
      context.beginPath();
      for (const partition of parsedMacroblock.partitions) context.rect(macroblockColumn * 16 + partition.x + 1, macroblockRow * 16 + partition.y + 1, Math.max(0, partition.width - 2), Math.max(0, partition.height - 2));
      context.lineWidth = Math.max(1.5, sps.width / 800); context.strokeStyle = "#3fe0ff"; context.stroke();
    }
  }, [analysis.codecKind, analysis.sps, av1LeafBlock, av1Subblocks, blockSize, h264Subblocks, macroblockColumn, macroblockColumns, macroblockRow, parsedMacroblock, showInterModes, showIntraModes, showMacroblocks]);

  const selectMacroblockAt = (clientX: number, clientY: number) => {
    const overlay = macroblockCanvas.current;
    if (!overlay || !showMacroblocks || !macroblockColumns || !macroblockRows) return;
    const bounds = overlay.getBoundingClientRect();
    const pictureX = Math.min(overlay.width - 1, Math.max(0, (clientX - bounds.left) / bounds.width * overlay.width));
    const pictureY = Math.min(overlay.height - 1, Math.max(0, (clientY - bounds.top) / bounds.height * overlay.height));
    if (analysis.codecKind === "av1" && av1Subblocks?.status === "ready") {
      const block = av1Subblocks.blocks.find(candidate => pictureX >= candidate.x && pictureX < candidate.x + candidate.width && pictureY >= candidate.y && pictureY < candidate.y + candidate.height);
      if (block) {
        setSelectedAv1Block(block.id);
        setSelectedMacroblock(block.superblockAddress);
        return;
      }
    }
    const column = Math.min(macroblockColumns - 1, Math.max(0, Math.floor(pictureX / blockSize)));
    const row = Math.min(macroblockRows - 1, Math.max(0, Math.floor(pictureY / blockSize)));
    setSelectedMacroblock(row * macroblockColumns + column);
  };

  const changeZoom = (value: number) => setZoom(Math.min(8, Math.max(.5, value)));

  useEffect(() => {
    let cancelled = false;
    let decoder: VideoDecoder | null = null;
    if (!target || unavailableMessage) return;
    const decode = async () => {
      setResidualSummary(null);
      setState("decoding"); setMessage(locale === "en" ? `${copy.decodingFrame} ${framePosition + 1}…` : `${copy.decodingFrame} ${framePosition + 1} 帧…`);
      const config: VideoDecoderConfig = { codec: analysis.sps!.codec, codedWidth: analysis.sps!.width, codedHeight: analysis.sps!.height, optimizeForLatency: true };
      const support = await VideoDecoder.isConfigSupported(config);
      if (!support.supported) throw new Error(`${copy.browserCodecUnsupported} ${analysis.sps!.codec}`);
      const targetTimestamp = target.timestamp ?? Math.round(framePosition * 1_000_000 / (analysis.sps!.fps ?? 30));
      let rendered = false;
      let previousTimestamp = Number.NEGATIVE_INFINITY;
      const previousCanvas = document.createElement("canvas");
      decoder = new VideoDecoder({
        output: frame => {
          if (!cancelled && frame.timestamp < targetTimestamp && frame.timestamp > previousTimestamp) {
            previousCanvas.width = frame.displayWidth;
            previousCanvas.height = frame.displayHeight;
            previousCanvas.getContext("2d", { willReadFrequently: true })?.drawImage(frame, 0, 0, previousCanvas.width, previousCanvas.height);
            previousTimestamp = frame.timestamp;
          }
          if (!cancelled && frame.timestamp === targetTimestamp && canvas.current && residualCanvas.current) {
            const element = canvas.current;
            element.width = frame.displayWidth;
            element.height = frame.displayHeight;
            const context = element.getContext("2d", { willReadFrequently: true });
            context?.drawImage(frame, 0, 0, element.width, element.height);
            const residualElement = residualCanvas.current;
            residualElement.width = element.width;
            residualElement.height = element.height;
            const totalPixels = element.width * element.height;
            try {
              if (!context) throw new Error(copy.residualUnavailable);
              if (!Number.isSafeInteger(totalPixels) || totalPixels > MAX_RESIDUAL_PIXELS) throw new Error(copy.residualUnavailable);
              const currentPixels = context.getImageData(0, 0, element.width, element.height).data;
              const previousContext = previousCanvas.width === element.width && previousCanvas.height === element.height ? previousCanvas.getContext("2d", { willReadFrequently: true }) : null;
              const previousPixels = previousContext?.getImageData(0, 0, element.width, element.height).data ?? null;
              const scaledRegions = scaleResidualRegions(residualRegions, element.width / analysis.sps!.width, element.height / analysis.sps!.height);
              const residual = buildResidualImage(currentPixels, previousPixels, element.width, element.height, scaledRegions, residualGain);
              residualElement.getContext("2d")?.putImageData(new ImageData(residual.pixels, element.width, element.height), 0, 0);
              const residualAvailable = residual.coveredPixels > 0;
              setResidualSummary({ available: residualAvailable, coveredPixels: residual.coveredPixels, totalPixels, intraPixels: residual.intraPixels, interPixels: residual.interPixels });
              if (!residualAvailable) setPictureView("final");
            } catch {
              const residualContext = residualElement.getContext("2d");
              if (residualContext) {
                residualContext.fillStyle = "rgb(128,128,128)";
                residualContext.fillRect(0, 0, residualElement.width, residualElement.height);
              }
              setResidualSummary({ available: false, coveredPixels: 0, totalPixels, intraPixels: 0, interPixels: 0 });
              setPictureView("final");
            }
            rendered = true; setState("ready"); setMessage("");
          }
          frame.close();
        },
        error: error => { if (!cancelled) { setState("error"); setMessage(error.message || `${analysis.codecName} ${copy.decodeFailed}`); } },
      });
      decoder.configure(support.config ?? config);
      let decodeStart = framePosition;
      while (decodeStart > 0 && !frames[decodeStart].keyFrame) decodeStart--;
      if (!frames[decodeStart].keyFrame) decodeStart = 0;
      const decodeEnd = Math.min(frames.length - 1, framePosition + 16);
      for (let i = decodeStart; i <= decodeEnd; i++) {
        if (cancelled || decoder.state === "closed") break;
        const end = i + 1 < frames.length ? frames[i + 1].offset : bytes.length;
        const sampleOffset = frames[i].sampleOffset;
        let chunkData: Uint8Array = sampleOffset !== undefined && frames[i].sampleSize !== undefined
          ? bytes.subarray(sampleOffset, sampleOffset + frames[i].sampleSize)
          : bytes.subarray(frames[i].offset, end);
        if (i === decodeStart && sampleOffset === undefined) {
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
          timestamp: frames[i].timestamp ?? Math.round(i * 1_000_000 / (analysis.sps!.fps ?? 30)),
          data: chunkData,
        }));
      }
      await decoder.flush();
      if (!cancelled && !rendered) throw new Error(copy.targetNotRendered);
    };
    decode().catch(error => { if (!cancelled) { setState("error"); setMessage(error instanceof Error ? error.message : `${analysis.codecName} ${copy.decodeFailed}`); } });
    return () => { cancelled = true; if (decoder && decoder.state !== "closed") decoder.close(); };
  }, [analysis, bytes, copy, framePosition, frames, locale, residualGain, residualRegions, target, unavailableMessage]);

  const displayState = unavailableMessage || !target ? "unsupported" : state;
  const displayMessage = unavailableMessage || (!target ? copy.noDecodableFrames : message);

  return <section className="decode-card">
    <div className="section-title"><div><span>01</span><h3>{copy.decodedPicture}</h3></div><small>{target ? `FRAME ${framePosition + 1} / ${frames.length} · ${analysis.unitName} #${target.index}` : copy.noFrame}</small></div>
    <div ref={canvasWrap} className="canvas-wrap" title={copy.wheelZoom}>
      <div className="frame-stage" style={{ transform: `scale(${zoom})`, transformOrigin: `${zoomOrigin.x}% ${zoomOrigin.y}%` }}>
        <canvas ref={canvas} className={`picture-canvas ${pictureView === "final" ? "visible" : ""}`} aria-label={copy.decodedCanvas} />
        <canvas ref={residualCanvas} className={`picture-canvas residual-canvas ${pictureView === "residual" ? "visible" : ""}`} aria-label={copy.residualCanvas} />
        <canvas ref={macroblockCanvas} className={`macroblock-overlay ${showMacroblocks ? "visible" : ""}`} role="button" tabIndex={showMacroblocks ? 0 : -1} aria-label={`${blockName} ${copy.gridSelection} ${analysis.codecKind === "av1" && av1LeafBlock ? `${copy.leafBlock} ${av1LeafBlock.id}` : macroblockAddress}`} onClick={event => selectMacroblockAt(event.clientX, event.clientY)} onKeyDown={event => {
          let next = macroblockAddress;
          if (event.key === "ArrowLeft") next--; else if (event.key === "ArrowRight") next++; else if (event.key === "ArrowUp") next -= macroblockColumns; else if (event.key === "ArrowDown") next += macroblockColumns; else return;
          event.preventDefault();
          const address = Math.min(macroblockCount - 1, Math.max(0, next));
          setSelectedMacroblock(address);
          if (analysis.codecKind === "av1" && av1Subblocks?.status === "ready") {
            const block = av1Subblocks.blocks.find(candidate => candidate.superblockAddress === address);
            if (block) setSelectedAv1Block(block.id);
          }
        }} />
      </div>
      <div className="picture-view-controls" aria-label={copy.pictureViewControls}>
        <button className={pictureView === "final" ? "active" : ""} aria-pressed={pictureView === "final"} onClick={() => setPictureView("final")}>{copy.finalPicture}</button>
        <button className={pictureView === "residual" ? "active" : ""} aria-pressed={pictureView === "residual"} disabled={!residualSummary?.available} onClick={() => setPictureView("residual")}>{copy.residualPicture}</button>
        {pictureView === "residual" && <button className="gain" onClick={() => setResidualGain(value => value === 1 ? 2 : value === 2 ? 4 : 1)} aria-label={copy.residualGain}>{residualGain}×</button>}
      </div>
      <div className="zoom-controls" aria-label={copy.zoomControls}>
        <button onClick={() => changeZoom(zoom / 1.25)} aria-label={copy.zoomOut}>−</button>
        <b aria-live="polite">{Math.round(zoom * 100)}%</b>
        <button onClick={() => changeZoom(zoom * 1.25)} aria-label={copy.zoomIn}>+</button>
        <button className="fit" onClick={() => { setZoom(1); setZoomOrigin({ x: 50, y: 50 }); }}>{copy.fit}</button>
      </div>
      {displayState !== "ready" && <div className={`decode-status ${displayState}`}><i />{displayMessage}</div>}
    </div>
    <div className="frame-controls">
      <button disabled={framePosition <= 0} onClick={() => onSelect(frames[framePosition - 1])}>{copy.previousFrame}</button>
      <input type="range" min="0" max={Math.max(0, frames.length - 1)} value={framePosition} onChange={event => onSelect(frames[Number(event.target.value)])} aria-label={copy.selectFrame} />
      <button disabled={framePosition >= frames.length - 1} onClick={() => onSelect(frames[framePosition + 1])}>{copy.nextFrame}</button>
    </div>
    <p className={`residual-note ${residualSummary?.available ? "available" : ""}`}>{residualSummary?.available ? `${copy.residualApproximation} · ${copy.residualCoverage} ${Math.round(residualSummary.coveredPixels / Math.max(1, residualSummary.totalPixels) * 100)}% · ${copy.residualComposition} I ${residualSummary.intraPixels.toLocaleString(locale)} / P ${residualSummary.interPixels.toLocaleString(locale)} · ${residualGain}×` : copy.residualUnavailable}</p>
    <div className="macroblock-toolbar"><div className="overlay-toggles"><button className={showMacroblocks ? "active" : ""} aria-pressed={showMacroblocks} onClick={() => setShowMacroblocks(value => !value)}><i />{blockName} {copy.grid} {showMacroblocks ? "ON" : "OFF"}</button>{(analysis.codecKind === "av1" || analysis.codecKind === "h264") && <><button className={showIntraModes ? "active" : ""} aria-pressed={showIntraModes} disabled={!showMacroblocks || !intraModesAvailable} onClick={() => setShowIntraModes(value => !value)}><i />{copy.intraModes} {showIntraModes ? "ON" : "OFF"}</button><button className={showInterModes ? "active inter" : ""} aria-pressed={showInterModes} disabled={!showMacroblocks || !interModesAvailable} onClick={() => setShowInterModes(value => !value)}><i />{copy.interModes} {showInterModes ? "ON" : "OFF"}</button></>}</div><span>{analysis.codecKind === "h264" && h264Subblocks ? `${h264Subblocks.entropyMode ?? "H.264"} · ${h264StatusMessage}${showMacroblocks && showIntraModes && h264IntraModesAvailable ? ` · ${copy.directionOverlay}` : ""}${showMacroblocks && showInterModes && h264InterModesAvailable ? ` · ${copy.motionOverlay}` : ""}` : analysis.codecKind === "av1" ? (av1SubblocksLoading ? copy.entropyDecodingAv1 : `${av1StatusMessage}${showMacroblocks && showIntraModes && av1Subblocks?.status === "ready" ? ` · ${copy.directionOverlay}` : ""}${showMacroblocks && showInterModes && interModesAvailable ? ` · ${copy.motionOverlay}` : ""}`) : `${macroblockColumns} × ${macroblockRows} ${blockSize}×${blockSize} ${copy.lumaBlocks} · ${copy.clickToSelect}`}</span></div>
    {showMacroblocks && macroblockCount > 0 && <div className="macroblock-info">
      <div><span>{blockName} {copy.address}</span><strong>#{macroblockAddress}</strong><small>{copy.rasterOrder}</small></div>
      <div><span>{copy.position}</span><strong>{av1LeafBlock ? `MI R${av1LeafBlock.y / 4} / C${av1LeafBlock.x / 4}` : `R${macroblockRow} / C${macroblockColumn}`}</strong><small>{av1LeafBlock ? `x ${av1LeafBlock.x}–${av1LeafBlock.x + av1LeafBlock.width - 1} · y ${av1LeafBlock.y}–${av1LeafBlock.y + av1LeafBlock.height - 1}` : `x ${macroblockColumn * blockSize}–${Math.min((macroblockColumn + 1) * blockSize - 1, (analysis.sps?.width ?? 1) - 1)} · y ${macroblockRow * blockSize}–${Math.min((macroblockRow + 1) * blockSize - 1, (analysis.sps?.height ?? 1) - 1)}`}</small></div>
      <div><span>{analysis.codecKind === "av1" ? copy.tile : copy.slice}</span><strong>{av1LeafBlock ? `R${av1LeafBlock.tileRow} / C${av1LeafBlock.tileColumn}` : macroblockSlice ? `${macroblockSlice.sliceType}-SLICE` : "—"}</strong><small>{av1LeafBlock ? `${av1Subblocks?.tileColumns} × ${av1Subblocks?.tileRows} tiles` : macroblockSlice ? `MB ${macroblockSlice.firstMb}–${sliceEnd}` : copy.noSlice}</small></div>
      <div><span>{copy.partition}</span><strong>{av1LeafBlock ? `${av1LeafBlock.sizeName} ${copy.leafBlock}` : parsedMacroblock?.typeName ?? `${blockSize}×${blockSize} ${blockName}`}</strong><small>{av1LeafBlock ? `${copy.decodedBlock} #${av1LeafBlock.id} · ${copy.belongsToSb} #${av1LeafBlock.superblockAddress}` : parsedMacroblock ? `${parsedMacroblock.partitions.length} ${copy.partitions} · ${parsedMacroblock.partitions.map(partition => `${partition.width}×${partition.height}`).join(" / ")}` : analysis.codecKind === "h264" ? (h264StatusMessage || copy.notParsed) : (av1StatusMessage || copy.notParsed)}</small></div>
      <div><span>{analysis.unitName} {copy.unit}</span><strong>{blockUnit ? `#${blockUnit.index} · ${analysis.codecKind === "av1" ? "O" : "T"}${blockUnit.type}` : "—"}</strong><small>{blockUnit ? `${copy.layer} ${blockUnit.layerId ?? 0} · 0x${blockUnit.offset.toString(16)}` : "—"}</small></div>
      <div><span>{copy.chromaCoverage}</span><strong>{analysis.sps?.chromaFormat ?? "—"}</strong><small>{analysis.sps?.chromaFormat === "4:2:0" ? copy.chroma420 : copy.chromaFromSps}</small></div>
      {analysis.codecKind === "h264" && <div><span>{copy.macroblockSyntax}</span><strong>{parsedMacroblock ? `${parsedMacroblock.prediction}${parsedMacroblock.skipped ? " · SKIP" : ""}` : "—"}</strong><small>{parsedMacroblock ? `mb_type ${parsedMacroblock.rawType ?? "skip"} · CBP ${parsedMacroblock.codedBlockPattern ?? 0}${parsedMacroblock.qpDelta !== undefined ? ` · ΔQP ${parsedMacroblock.qpDelta}` : ""}` : copy.noCavlc}</small></div>}
      {analysis.codecKind === "h264" && parsedMacroblock?.intraModes?.length && <div><span>{copy.intraPrediction}</span><strong>{h264IntraModeSummary}</strong><small>{parsedMacroblock.intraModes.length} {copy.predictionBlocks} · {parsedMacroblock.typeName}</small></div>}
      {analysis.codecKind === "h264" && parsedMacroblock?.motionVectors?.length && <div><span>{copy.interPrediction}</span><strong>{parsedMacroblock.motionVectors.map(vector => `L0 ref ${vector.reference} · MV (${(vector.mvX / 4).toFixed(2)}, ${(vector.mvY / 4).toFixed(2)}) px`).join(" · ")}</strong><small>{parsedMacroblock.motionVectors.map(vector => `${vector.mode}: qpel (${vector.mvX}, ${vector.mvY}) · MVD (${vector.mvdX}, ${vector.mvdY})`).join(" · ")}</small></div>}
      {analysis.codecKind === "av1" && <div><span>{av1LeafBlock?.intraMode ? copy.intraPrediction : copy.av1BlockSyntax}</span><strong>{av1LeafBlock ? `${av1IntraModeName ?? `${av1LeafBlock.mode} · ${copy.interPrediction}`}${av1LeafBlock.intraMode ? ` · ${av1LeafBlock.intraMode.directional ? `${copy.nominalDirection} ${av1LeafBlock.intraMode.nominalAngle}°` : copy.nonDirectional}` : ""}${av1LeafBlock.skipped ? " · SKIP" : ""}` : "—"}</strong><small>{av1LeafBlock ? `mode ${av1LeafBlock.mode} · TX ${av1LeafBlock.transformSize} · base_q_idx ${av1Subblocks?.baseQIndex ?? "—"} · frame_type ${av1Subblocks?.frameType ?? "—"}` : av1SubblocksLoading ? copy.decodingWithLibaom : av1StatusMessage || copy.noResult}</small></div>}
      {analysis.codecKind === "av1" && av1LeafBlock?.motionVectors.length ? <div><span>{copy.motionVectors}</span><strong>{av1LeafBlock.motionVectors.map(vector => `${vector.referenceName} · MV (${(vector.mvX / 8).toFixed(3)}, ${(vector.mvY / 8).toFixed(3)}) px`).join(" · ")}</strong><small>{av1LeafBlock.motionVectors.map(vector => `1/8-pel (${vector.mvX}, ${vector.mvY}) · ref ${vector.reference}`).join(" · ")}</small></div> : null}
    </div>}
  </section>;
}

export default function Analyzer({ locale }: { locale: Locale }) {
  const copy = getCopy(locale);
  const languageHref = locale === "en" ? "/zh-CN" : "/";
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<NalUnit | null>(null);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [sourceBytes, setSourceBytes] = useState<Uint8Array | null>(null);
  const [intraModeDistribution, setIntraModeDistribution] = useState<ModeDistribution | null>(null);
  const [interModeDistribution, setInterModeDistribution] = useState<ModeDistribution | null>(null);

  const openFile = async (file: File) => {
    setError(""); setBusy(true);
    try {
      validateFile(file, locale);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = analyzeBitstream(bytes, file.name);
      setAnalysis(result); setSourceBytes(bytes); setFileName(file.name); setSelected(result.units.find(unit => unit.keyFrame && unit.frameStart) ?? result.units.find(unit => unit.frameStart) ?? result.units[0] ?? null); setFilter("all"); setQuery("");
    } catch (err) { setAnalysis(null); setSourceBytes(null); setError(err instanceof Error && [copy.invalidFile, copy.emptyFile, copy.fileTooLarge].includes(err.message) ? err.message : copy.parseFailed); }
    finally { setBusy(false); }
  };

  const filtered = useMemo(() => analysis?.units.filter(unit => {
    const q = query.trim().toLowerCase();
    return (filter === "all" || unit.type === Number(filter)) && (!q || localizeTypeName(unit.typeName, locale).toLowerCase().includes(q) || String(unit.index).includes(q) || unit.sliceType?.toLowerCase().includes(q));
  }) ?? [], [analysis, filter, locale, query]);
  const counts = analysis ? [...analysis.counts.entries()].sort((a, b) => b[1] - a[1]) : [];

  return <main className={`shell ${analysis ? "analysis-mode" : ""}`}>
    <header className="topbar">
      <button className="brand-button" onClick={() => setAnalysis(null)} aria-label={copy.homeAria}><span className="brand-mark">B</span><span><strong>BitScope</strong><small>{copy.brandSubtitle}</small></span></button>
      {analysis && <div className="file-chip"><i />{fileName}<span>{formatBytes(analysis.totalBytes)}</span></div>}
      <div className="privacy-pill"><i /> {copy.privacy}</div>
      <a className="locale-switch" href={languageHref} hrefLang={locale === "en" ? "zh-CN" : "en"} aria-label={copy.switchLanguageAria}>{copy.switchLanguage}</a>
    </header>
    {!analysis ? <section className="hero">
      <div className="hero-copy"><p className="eyebrow">AVC · HEVC · VVC · AV1</p><h1>{copy.heroLead}<br /><em>{copy.heroEmphasis}</em></h1><p className="intro">{copy.heroIntro}</p><div className="feature-row"><span>{copy.featureCodecs}</span><span>{copy.featureTimeline}</span><span>{copy.featureHex}</span></div></div>
      <div><UploadPanel onFile={openFile} locale={locale} />{busy && <p className="status-msg">{copy.reading}</p>}{error && <p className="error-msg" role="alert">{error}</p>}</div>
    </section> : <div className="workspace">
      <section className="summary-head"><div><p className="eyebrow">{analysis.codecName}{analysis.containerName ? ` · ${analysis.containerName}` : ""} / {copy.parsed}</p><h2>{analysis.sps ? `${analysis.sps.width} × ${analysis.sps.height}` : analysis.codecName}</h2></div><UploadPanel onFile={openFile} locale={locale} compact /></section>
      <section className="stats-grid">
        <Stat label={copy.profile} value={analysis.sps?.profile ?? copy.unknown} note={analysis.sps ? `Level ${analysis.sps.level}` : `${copy.missing} ${localizeParameterSetName(analysis.parameterSetName, locale)}`} />
        <Stat label={copy.dimensions} value={analysis.sps ? `${analysis.sps.width} × ${analysis.sps.height}` : "—"} note={analysis.sps?.frameMbsOnly ? copy.progressive : analysis.sps ? copy.interlaced : undefined} />
        <Stat label={copy.frameRate} value={analysis.sps?.fps ? `${analysis.sps.fps.toFixed(3)} fps` : "—"} note={analysis.sps?.fps ? (analysis.containerName === "IVF" ? copy.fromIvf : analysis.codecKind === "av1" ? copy.fromSequence : copy.fromVui) : copy.frameRateUndeclared} />
        <Stat label={copy.framesKeyframes} value={`${analysis.frameCount} / ${analysis.idrCount}`} note={analysis.duration ? `${copy.about} ${analysis.duration.toFixed(2)} ${copy.seconds}${analysis.declaredFrameCount !== undefined ? ` · ${copy.ivfDeclares} ${analysis.declaredFrameCount} ${copy.frames}` : ""}` : `${analysis.units.length} ${analysis.unitName} ${copy.units}`} />
      </section>
      {sourceBytes && <DecodedPreview bytes={sourceBytes} analysis={analysis} selected={selected} onSelect={setSelected} onIntraModeDistributionChange={setIntraModeDistribution} onInterModeDistributionChange={setInterModeDistribution} locale={locale} />}
      <section className="timeline-card">
        <div className="section-title"><div><span>02</span><h3>{analysis.unitName} {copy.timeline}</h3></div><small>{copy.timelineSync}</small></div>
        <div className="timeline" aria-label={`${analysis.unitName} ${copy.timelineAria}`}>{analysis.units.slice(0, 500).map(unit => { const typeName = localizeTypeName(unit.typeName, locale); return <button key={unit.index} title={`#${unit.index} ${typeName}`} aria-label={`${analysis.unitName} ${unit.index} ${typeName}`} className={selected?.index === unit.index ? "active" : ""} style={{ background: unitColor(unit.type, analysis.codecKind) }} onClick={() => setSelected(unit)} />; })}</div>
        {analysis.units.length > 500 && <p className="limit-note">{copy.timelineLimit}</p>}
        <div className="legend"><span><i style={{background:"#ff6b35"}}/>{copy.keyFrame}</span><span><i style={{background:"#3b82f6"}}/>{copy.frameSlice}</span><span><i style={{background:"#d9ff43"}}/>{copy.sequenceParameters}</span><span><i style={{background:"#b794f4"}}/>{copy.pictureTileParameters}</span><span><i style={{background:"#f6c445"}}/>{copy.metadata}</span></div>
      </section>
      <div className="content-grid">
        <section className="nal-card">
          <div className="section-title"><div><span>03</span><h3>{analysis.unitName} {copy.unitList}</h3></div><small>{filtered.length} / {analysis.units.length}</small></div>
          <div className="filters"><select value={filter} onChange={e => setFilter(e.target.value)} aria-label={`${copy.typeFilter} ${analysis.unitName}`}><option value="all">{copy.allTypes}</option>{counts.map(([type]) => <option key={type} value={type}>{analysis.codecKind === "av1" ? "O" : "T"}{type} · {localizeTypeName(analysis.units.find(u => u.type === type)?.typeName ?? "", locale)}</option>)}</select><input value={query} onChange={e => setQuery(e.target.value)} placeholder={copy.searchPlaceholder} aria-label={`${copy.searchAria} ${analysis.unitName}`} /></div>
          <div className="nal-table" role="table"><div className="nal-row table-head" role="row"><span>#</span><span>{copy.type}</span><span>{copy.frameSlice}</span><span>{copy.size}</span><span>{copy.offset}</span></div>{filtered.slice(0, 300).map(unit => <button className={`nal-row ${selected?.index === unit.index ? "selected" : ""}`} key={unit.index} onClick={() => setSelected(unit)} role="row"><span>{String(unit.index).padStart(4, "0")}</span><span><NalBadge unit={unit} codec={analysis.codecKind} /> {localizeTypeName(unit.typeName, locale)}</span><span>{unit.sliceType ?? "—"}</span><span>{formatBytes(unit.size)}</span><span>0x{unit.offset.toString(16).padStart(8,"0")}</span></button>)}</div>
          {filtered.length > 300 && <p className="limit-note">{copy.listLimit}</p>}
        </section>
        <aside>
          <section className="detail-card"><div className="section-title"><div><span>04</span><h3>{copy.unitDetails}</h3></div></div>{selected ? <><div className="detail-title"><NalBadge unit={selected} codec={analysis.codecKind}/><div><b>{localizeTypeName(selected.typeName, locale)}</b><small>{analysis.unitName} #{selected.index}</small></div></div><dl><div><dt>{analysis.codecKind === "av1" ? "obu_type" : "nal_unit_type"}</dt><dd>{selected.type}</dd></div>{analysis.codecKind === "h264" ? <div><dt>nal_ref_idc</dt><dd>{selected.refIdc}</dd></div> : <><div><dt>layer_id</dt><dd>{selected.layerId ?? 0}</dd></div><div><dt>temporal_id</dt><dd>{selected.temporalId ?? 0}</dd></div></>}<div><dt>{analysis.unitName === "NAL" ? "start_code" : "header_size"}</dt><dd>{analysis.unitName === "NAL" ? selected.startCodeSize : selected.headerSize ?? 1} bytes</dd></div><div><dt>payload_size</dt><dd>{formatBytes(Math.max(0, selected.size - selected.startCodeSize - (selected.headerSize ?? 1)))}</dd></div>{selected.sliceType && <div><dt>frame_or_slice_type</dt><dd>{selected.sliceType}</dd></div>}{selected.firstMb !== undefined && <div><dt>first_block_in_slice</dt><dd>{selected.firstMb}</dd></div>}</dl><p className="hex-label">{copy.hexPreview}</p><pre>{selected.hex}</pre></> : <p>{copy.selectUnit}</p>}</section>
          {intraModeDistribution && <section className="intra-distribution-card"><div className="section-title"><div><span>05</span><h3>{copy.intraModeDistribution}</h3></div><small>{intraModeDistribution.sampledCount.toLocaleString(locale === "en" ? "en-US" : "zh-CN")} {copy.intraModeSamples}{intraModeDistribution.limited ? ` · ${copy.distributionLimited}` : ""}</small></div>{intraModeDistribution.items.map(item => <div className="mode-bar-row" key={item.key}><span title={item.name}>{item.name}</span><div><i style={{width:`${Math.max(4, item.count / (intraModeDistribution.items[0]?.count ?? 1) * 100)}%`}} /></div><b>{item.count.toLocaleString(locale === "en" ? "en-US" : "zh-CN")}</b></div>)}</section>}
          {interModeDistribution && <section className="inter-distribution-card"><div className="section-title"><div><span>06</span><h3>{copy.interModeDistribution}</h3></div><small>{interModeDistribution.sampledCount.toLocaleString(locale === "en" ? "en-US" : "zh-CN")} {copy.interModeSamples}{interModeDistribution.limited ? ` · ${copy.distributionLimited}` : ""}</small></div>{interModeDistribution.items.map(item => <div className="mode-bar-row inter" key={item.key}><span title={item.name}>{item.name}</span><div><i style={{width:`${Math.max(4, item.count / (interModeDistribution.items[0]?.count ?? 1) * 100)}%`}} /></div><b>{item.count.toLocaleString(locale === "en" ? "en-US" : "zh-CN")}</b></div>)}</section>}
        </aside>
      </div>
    </div>}
    <footer>BITSTREAM, MADE LEGIBLE <span>{analysis ? copy.analyzedLocally : "01"}</span></footer>
  </main>;
}
