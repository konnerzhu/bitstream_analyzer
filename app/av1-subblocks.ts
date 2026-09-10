import type { Analysis } from "./codecs";

const MAX_INSPECTOR_FILE_SIZE = 64 * 1024 * 1024;
const MAX_MATRIX_CELLS = 2_100_000;
const MAX_LEAF_BLOCKS = 600_000;
const INSPECTION_TIMEOUT_MS = 20_000;

type InspectionMap = Record<string, number>;
type InspectionFrame = Record<string, unknown>;

export type Av1IntraModeInfo = Readonly<{
  name: string;
  directional: boolean;
  nominalAngle?: number;
}>;

const AV1_INTRA_MODES = new Map<string, Av1IntraModeInfo>([
  ["DC_PRED", { name: "DC", directional: false }],
  ["V_PRED", { name: "Vertical", directional: true, nominalAngle: 90 }],
  ["H_PRED", { name: "Horizontal", directional: true, nominalAngle: 180 }],
  ["D45_PRED", { name: "Diagonal 45°", directional: true, nominalAngle: 45 }],
  ["D135_PRED", { name: "Diagonal 135°", directional: true, nominalAngle: 135 }],
  ["D113_PRED", { name: "Diagonal 113°", directional: true, nominalAngle: 113 }],
  ["D157_PRED", { name: "Diagonal 157°", directional: true, nominalAngle: 157 }],
  ["D203_PRED", { name: "Diagonal 203°", directional: true, nominalAngle: 203 }],
  ["D67_PRED", { name: "Diagonal 67°", directional: true, nominalAngle: 67 }],
  ["SMOOTH_PRED", { name: "Smooth", directional: false }],
  ["SMOOTH_V_PRED", { name: "Smooth vertical", directional: false }],
  ["SMOOTH_H_PRED", { name: "Smooth horizontal", directional: false }],
  ["PAETH_PRED", { name: "Paeth", directional: false }],
  ["CFL_PRED", { name: "Chroma from luma", directional: false }],
  ["UV_CFL_PRED", { name: "Chroma from luma", directional: false }],
]);

export function getAv1IntraModeInfo(mode: string): Av1IntraModeInfo | undefined {
  return AV1_INTRA_MODES.get(mode);
}

export type Av1LeafBlock = {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  sizeName: string;
  mode: string;
  intraMode?: Av1IntraModeInfo;
  transformSize: string;
  skipped: boolean;
  skipName: string;
  superblockAddress: number;
  tileColumn: number;
  tileRow: number;
};

export type Av1SubblockAnalysis = {
  status: "ready" | "unsupported";
  message: string;
  blocks: Av1LeafBlock[];
  miColumns: number;
  miRows: number;
  frameType?: number;
  baseQIndex?: number;
  tileColumns: number;
  tileRows: number;
};

type WorkerReply = { ok: true; frame: unknown } | { ok: false; error: string };

function unsupported(message: string): Av1SubblockAnalysis {
  return { status: "unsupported", message, blocks: [], miColumns: 0, miRows: 0, tileColumns: 0, tileRows: 0 };
}

function numericMatrix(value: unknown, name: string) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 2_048) throw new Error(`${name} 矩阵尺寸无效`);
  const columns = Array.isArray(value[0]) ? value[0].length : 0;
  if (columns === 0 || columns > 2_048 || value.length * columns > MAX_MATRIX_CELLS) throw new Error(`${name} 矩阵超过安全上限`);
  const matrix = value.map(row => {
    if (!Array.isArray(row) || row.length !== columns || row.some(cell => !Number.isSafeInteger(cell))) throw new Error(`${name} 矩阵内容无效`);
    return row as number[];
  });
  return matrix;
}

function inspectionMap(value: unknown, name: string): InspectionMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} 映射无效`);
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > 128) throw new Error(`${name} 映射大小无效`);
  const map: InspectionMap = {};
  for (const [key, id] of entries) {
    if (!/^[A-Z0-9_]{1,48}$/.test(key) || !Number.isSafeInteger(id)) throw new Error(`${name} 映射内容无效`);
    map[key] = id as number;
  }
  return map;
}

function invert(map: InspectionMap) {
  return new Map(Object.entries(map).map(([name, id]) => [id, name]));
}

function dimensions(name: string, prefix: string) {
  const match = new RegExp(`^${prefix}_(\\d{1,3})X(\\d{1,3})$`).exec(name);
  if (!match) throw new Error(`未知的 AV1 块尺寸 ${name}`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 4 || height < 4 || width > 128 || height > 128) throw new Error(`AV1 块尺寸超出范围 ${name}`);
  return { width, height };
}

function numberField(frame: InspectionFrame, name: string) {
  const value = frame[name];
  return Number.isSafeInteger(value) ? value as number : undefined;
}

function tileIndex(boundaries: number[], coordinate: number) {
  let index = 0;
  while (index + 1 < boundaries.length && coordinate >= boundaries[index + 1]) index += 1;
  return Math.max(0, Math.min(index, boundaries.length - 2));
}

function tileBoundaries(value: unknown, maximum: number) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 65) return [0, maximum];
  const result = value.map(entry => Number(entry));
  if (result[0] !== 0 || result.at(-1) !== maximum || result.some((entry, index) => !Number.isSafeInteger(entry) || entry < 0 || entry > maximum || (index > 0 && entry <= result[index - 1]))) return [0, maximum];
  return result;
}

export function convertAv1InspectionFrame(raw: unknown, analysis: Analysis): Av1SubblockAnalysis {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !analysis.sps) throw new Error("AV1 inspection 帧数据无效");
  const frame = raw as InspectionFrame;
  const blockSize = numericMatrix(frame.blockSize, "blockSize");
  const transformSize = numericMatrix(frame.transformSize, "transformSize");
  const mode = numericMatrix(frame.mode, "mode");
  const skip = numericMatrix(frame.skip, "skip");
  const miRows = blockSize.length;
  const miColumns = blockSize[0].length;
  for (const matrix of [transformSize, mode, skip]) {
    if (matrix.length !== miRows || matrix[0].length !== miColumns) throw new Error("AV1 inspection 矩阵尺寸不一致");
  }

  const blockNames = invert(inspectionMap(frame.blockSizeMap, "blockSizeMap"));
  const transformNames = invert(inspectionMap(frame.transformSizeMap, "transformSizeMap"));
  const modeNames = invert(inspectionMap(frame.modeMap, "modeMap"));
  const skipNames = invert(inspectionMap(frame.skipMap, "skipMap"));
  const tileColumns = tileBoundaries(frame.tileCols, miColumns);
  const tileRows = tileBoundaries(frame.tileRows, miRows);
  const visited = new Uint8Array(miRows * miColumns);
  const blocks: Av1LeafBlock[] = [];
  const pictureWidth = analysis.sps.width;
  const pictureHeight = analysis.sps.height;
  const superblockSize = analysis.blockSize;
  const superblockColumns = Math.ceil(pictureWidth / superblockSize);

  for (let row = 0; row < miRows; row += 1) {
    for (let column = 0; column < miColumns; column += 1) {
      const cell = row * miColumns + column;
      if (visited[cell]) continue;
      const sizeName = blockNames.get(blockSize[row][column]);
      if (!sizeName) throw new Error(`未知的 AV1 blockSize id ${blockSize[row][column]}`);
      const size = dimensions(sizeName, "BLOCK");
      const widthInMi = Math.ceil(size.width / 4);
      const heightInMi = Math.ceil(size.height / 4);
      for (let y = row; y < Math.min(miRows, row + heightInMi); y += 1) {
        visited.fill(1, y * miColumns + column, y * miColumns + Math.min(miColumns, column + widthInMi));
      }
      const x = column * 4;
      const y = row * 4;
      if (x >= pictureWidth || y >= pictureHeight) continue;
      if (blocks.length >= MAX_LEAF_BLOCKS) throw new Error("AV1 叶子块数量超过 600,000 安全上限");
      const rawMode = modeNames.get(mode[row][column]);
      const rawTransform = transformNames.get(transformSize[row][column]);
      const rawSkip = skipNames.get(skip[row][column]);
      const decodedMode = rawMode ?? `MODE_${mode[row][column]}`;
      blocks.push({
        id: blocks.length,
        x,
        y,
        width: Math.min(size.width, pictureWidth - x),
        height: Math.min(size.height, pictureHeight - y),
        sizeName: sizeName.replace(/^BLOCK_/, ""),
        mode: decodedMode,
        intraMode: getAv1IntraModeInfo(decodedMode),
        transformSize: (rawTransform ?? `TX_${transformSize[row][column]}`).replace(/^TX_/, ""),
        skipped: rawSkip === "SKIP" || skip[row][column] === 1,
        skipName: rawSkip ?? `SKIP_${skip[row][column]}`,
        superblockAddress: Math.floor(y / superblockSize) * superblockColumns + Math.floor(x / superblockSize),
        tileColumn: tileIndex(tileColumns, column),
        tileRow: tileIndex(tileRows, row),
      });
    }
  }

  return {
    status: "ready",
    message: `libaom inspection · ${blocks.length.toLocaleString()} 个熵解码叶子块`,
    blocks,
    miColumns,
    miRows,
    frameType: numberField(frame, "frameType"),
    baseQIndex: numberField(frame, "baseQIndex"),
    tileColumns: tileColumns.length - 1,
    tileRows: tileRows.length - 1,
  };
}

export function inspectAv1Subblocks(bytes: Uint8Array, analysis: Analysis, frameIndex: number, signal?: AbortSignal): Promise<Av1SubblockAnalysis> {
  if (analysis.codecKind !== "av1") return Promise.resolve(unsupported("当前码流不是 AV1"));
  if (analysis.containerName !== "IVF") return Promise.resolve(unsupported("AV1 子块熵解码目前仅支持 IVF；裸 OBU 仍显示 Superblock 网格"));
  if (bytes.byteLength > MAX_INSPECTOR_FILE_SIZE) return Promise.resolve(unsupported("IVF 超过 64 MB，已跳过 AV1 子块 inspection"));
  if (typeof Worker === "undefined") return Promise.resolve(unsupported("当前浏览器不支持 Web Worker"));

  return new Promise(resolve => {
    let worker: Worker;
    try {
      worker = new Worker("/av1-inspector-worker.js");
    } catch {
      resolve(unsupported("无法创建 AV1 子块 inspection Worker"));
      return;
    }
    let settled = false;
    const finish = (result: Av1SubblockAnalysis) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      resolve(result);
    };
    const abort = () => finish(unsupported("AV1 子块 inspection 已取消"));
    const timeout = window.setTimeout(() => finish(unsupported("AV1 子块 inspection 超过 20 秒，已终止 Worker")), INSPECTION_TIMEOUT_MS);
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = () => finish(unsupported("AV1 子块 inspection Worker 运行失败"));
    worker.onmessage = event => {
      const reply = event.data as WorkerReply;
      if (!reply || reply.ok !== true) {
        finish(unsupported(reply && "error" in reply && typeof reply.error === "string" ? reply.error.slice(0, 240) : "AV1 子块 inspection 失败"));
        return;
      }
      try {
        finish(convertAv1InspectionFrame(reply.frame, analysis));
      } catch (error) {
        finish(unsupported(error instanceof Error ? error.message : "AV1 子块 inspection 数据无效"));
      }
    };
    const copy = bytes.slice().buffer;
    worker.postMessage({ bytes: copy, frameIndex }, [copy]);
  });
}
