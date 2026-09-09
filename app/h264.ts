export type SpsInfo = {
  profileIdc: number; profile: string; level: string; width: number; height: number;
  chromaFormat: string; bitDepth: number; fps?: number; spsId: number; frameMbsOnly: boolean; codec: string;
  blockSize?: number;
};

export type CodecKind = "h264" | "h265" | "h266" | "av1";

export type NalUnit = {
  index: number; offset: number; size: number; startCodeSize: number; type: number;
  typeName: string; refIdc: number; sliceType?: string; firstMb?: number; hex: string;
  headerSize?: number; keyFrame?: boolean; frameStart?: boolean; layerId?: number; temporalId?: number;
  sampleOffset?: number; sampleSize?: number; timestamp?: number;
  fields?: Record<string, string | number | boolean>;
};

export type Analysis = {
  units: NalUnit[]; sps?: SpsInfo; duration?: number; frameCount: number;
  idrCount: number; totalBytes: number; counts: Map<number, number>;
  codecKind: CodecKind; codecName: string; unitName: "NAL" | "OBU"; blockName: string;
  blockSize: number; parameterSetTypes: number[]; parameterSetName: string;
  containerName?: string; declaredFrameCount?: number;
};

const NAL_NAMES = new Map<number, string>([
  [1, "非 IDR 切片"], [2, "切片数据 A"], [3, "切片数据 B"], [4, "切片数据 C"],
  [5, "IDR 关键帧"], [6, "SEI 补充信息"], [7, "SPS 序列参数集"], [8, "PPS 图像参数集"],
  [9, "AUD 访问单元分隔符"], [10, "序列结束"], [11, "码流结束"], [12, "填充数据"],
  [13, "SPS 扩展"], [14, "前缀 NAL"], [19, "辅助编码切片"], [20, "扩展切片"],
]);

const PROFILES = new Map<number, string>([
  [66, "Baseline"], [77, "Main"], [88, "Extended"], [100, "High"], [110, "High 10"],
  [122, "High 4:2:2"], [244, "High 4:4:4 Predictive"], [44, "CAVLC 4:4:4"],
]);

export class BitReader {
  private bit = 0;
  constructor(private readonly data: Uint8Array) {}
  readBit() {
    if (this.bit >= this.data.length * 8) throw new Error("码流数据不完整");
    const value = (this.data[this.bit >> 3] >> (7 - (this.bit & 7))) & 1;
    this.bit++;
    return value;
  }
  readBits(count: number) {
    if (count < 0 || count > 32) throw new Error("无效的位字段长度");
    let value = 0;
    for (let i = 0; i < count; i++) value = value * 2 + this.readBit();
    return value;
  }
  readUE() {
    let zeros = 0;
    while (this.readBit() === 0) {
      zeros++;
      if (zeros > 31) throw new Error("Exp-Golomb 值过大");
    }
    return zeros === 0 ? 0 : 2 ** zeros - 1 + this.readBits(zeros);
  }
  readSE() {
    const code = this.readUE();
    return code & 1 ? (code + 1) / 2 : -(code / 2);
  }
}

export function rbsp(data: Uint8Array) {
  const out: number[] = [];
  let zeros = 0;
  for (const byte of data) {
    if (zeros >= 2 && byte === 3) { zeros = 0; continue; }
    out.push(byte);
    zeros = byte === 0 ? zeros + 1 : 0;
  }
  return new Uint8Array(out);
}

function skipScalingList(reader: BitReader, size: number) {
  let last = 8;
  let next = 8;
  for (let i = 0; i < size; i++) {
    if (next !== 0) next = (last + reader.readSE() + 256) % 256;
    last = next === 0 ? last : next;
  }
}

function parseVui(reader: BitReader) {
  if (reader.readBit()) {
    const aspect = reader.readBits(8);
    if (aspect === 255) { reader.readBits(16); reader.readBits(16); }
  }
  if (reader.readBit()) reader.readBit();
  if (reader.readBit()) {
    reader.readBits(3); reader.readBit();
    if (reader.readBit()) { reader.readBits(8); reader.readBits(8); reader.readBits(8); }
  }
  if (reader.readBit()) { reader.readUE(); reader.readUE(); }
  if (reader.readBit()) {
    const numUnitsInTick = reader.readBits(32);
    const timeScale = reader.readBits(32);
    reader.readBit();
    if (numUnitsInTick > 0) return timeScale / (2 * numUnitsInTick);
  }
  return undefined;
}

export function parseSps(payload: Uint8Array): SpsInfo {
  const reader = new BitReader(rbsp(payload));
  const profileIdc = reader.readBits(8);
  const profileCompatibility = reader.readBits(8);
  const levelIdc = reader.readBits(8);
  const spsId = reader.readUE();
  let chromaFormatIdc = 1;
  let separateColourPlane = 0;
  let bitDepth = 8;
  const highProfiles = new Set([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135]);
  if (highProfiles.has(profileIdc)) {
    chromaFormatIdc = reader.readUE();
    if (chromaFormatIdc === 3) separateColourPlane = reader.readBit();
    bitDepth = 8 + reader.readUE();
    reader.readUE();
    reader.readBit();
    if (reader.readBit()) {
      const count = chromaFormatIdc !== 3 ? 8 : 12;
      for (let i = 0; i < count; i++) if (reader.readBit()) skipScalingList(reader, i < 6 ? 16 : 64);
    }
  }
  reader.readUE();
  const picOrderCntType = reader.readUE();
  if (picOrderCntType === 0) reader.readUE();
  else if (picOrderCntType === 1) {
    reader.readBit(); reader.readSE(); reader.readSE();
    const cycle = reader.readUE();
    for (let i = 0; i < cycle; i++) reader.readSE();
  }
  reader.readUE();
  reader.readBit();
  const picWidthInMbsMinus1 = reader.readUE();
  const picHeightInMapUnitsMinus1 = reader.readUE();
  const frameMbsOnly = reader.readBit() === 1;
  if (!frameMbsOnly) reader.readBit();
  reader.readBit();
  let cropLeft = 0, cropRight = 0, cropTop = 0, cropBottom = 0;
  if (reader.readBit()) {
    cropLeft = reader.readUE(); cropRight = reader.readUE(); cropTop = reader.readUE(); cropBottom = reader.readUE();
  }
  const fps = reader.readBit() ? parseVui(reader) : undefined;
  const subWidth = chromaFormatIdc === 1 || chromaFormatIdc === 2 ? 2 : 1;
  const subHeight = chromaFormatIdc === 1 ? 2 : 1;
  const cropUnitX = chromaFormatIdc === 0 || separateColourPlane ? 1 : subWidth;
  const cropUnitY = chromaFormatIdc === 0 || separateColourPlane ? 2 - Number(frameMbsOnly) : subHeight * (2 - Number(frameMbsOnly));
  const width = (picWidthInMbsMinus1 + 1) * 16 - (cropLeft + cropRight) * cropUnitX;
  const height = (picHeightInMapUnitsMinus1 + 1) * 16 * (2 - Number(frameMbsOnly)) - (cropTop + cropBottom) * cropUnitY;
  const chromaNames = ["Monochrome", "4:2:0", "4:2:2", "4:4:4"];
  return {
    profileIdc, profile: PROFILES.get(profileIdc) ?? `Profile ${profileIdc}`,
    level: (levelIdc / 10).toFixed(1), width, height,
    chromaFormat: chromaNames[chromaFormatIdc] ?? `Chroma ${chromaFormatIdc}`,
    bitDepth, fps, spsId, frameMbsOnly,
    codec: `avc1.${profileIdc.toString(16).padStart(2, "0")}${profileCompatibility.toString(16).padStart(2, "0")}${levelIdc.toString(16).padStart(2, "0")}`,
  };
}

export function findStartCodes(bytes: Uint8Array) {
  const starts: { offset: number; size: number }[] = [];
  for (let i = 0; i + 3 < bytes.length;) {
    if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) {
      starts.push({ offset: i, size: 3 }); i += 3;
    } else if (i + 4 <= bytes.length && bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 0 && bytes[i + 3] === 1) {
      starts.push({ offset: i, size: 4 }); i += 4;
    } else i++;
    if (starts.length > 100_000) throw new Error("NAL 单元超过 100,000 个，为避免浏览器失去响应已停止解析");
  }
  return starts;
}

export function hexPreview(data: Uint8Array, max = 48) {
  return Array.from(data.subarray(0, Math.min(max, data.length)), b => b.toString(16).padStart(2, "0")).join(" ");
}

function parseSlice(payload: Uint8Array) {
  try {
    const reader = new BitReader(rbsp(payload));
    const firstMb = reader.readUE();
    const rawType = reader.readUE();
    const ppsId = reader.readUE();
    const types = ["P", "B", "I", "SP", "SI"];
    return { sliceType: types[rawType % 5] ?? "?", ppsId, firstMb };
  } catch { return {}; }
}

export function analyzeH264(bytes: Uint8Array): Analysis {
  const starts = findStartCodes(bytes);
  if (!starts.length) throw new Error("未发现 Annex-B 起始码（00 00 01 或 00 00 00 01）");
  const units: NalUnit[] = [];
  const counts = new Map<number, number>();
  let sps: SpsInfo | undefined;
  let frameCount = 0;
  let idrCount = 0;
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const nalOffset = start.offset + start.size;
    let end = i + 1 < starts.length ? starts[i + 1].offset : bytes.length;
    while (end > nalOffset && bytes[end - 1] === 0) end--;
    if (nalOffset >= end) continue;
    const header = bytes[nalOffset];
    if (header & 0x80) throw new Error(`NAL #${i} 的 forbidden_zero_bit 非零`);
    const type = header & 0x1f;
    const refIdc = (header >> 5) & 3;
    const payload = bytes.subarray(nalOffset + 1, end);
    if (type === 7 && !sps) {
      try { sps = parseSps(payload); } catch { /* keep listing damaged SPS */ }
    }
    const slice = type >= 1 && type <= 5 ? parseSlice(payload) : {};
    if (type >= 1 && type <= 5 && slice.firstMb === 0) frameCount++;
    if (type === 5 && slice.firstMb === 0) idrCount++;
    counts.set(type, (counts.get(type) ?? 0) + 1);
    units.push({
      index: units.length, offset: start.offset, size: end - start.offset,
      startCodeSize: start.size, type, typeName: NAL_NAMES.get(type) ?? `保留类型 ${type}`,
      refIdc, headerSize: 1, keyFrame: type === 5, frameStart: type >= 1 && type <= 5 && slice.firstMb === 0,
      ...slice, hex: hexPreview(bytes.subarray(start.offset, end)),
    });
  }
  const duration = sps?.fps ? frameCount / sps.fps : undefined;
  return {
    units, sps, duration, frameCount, idrCount, totalBytes: bytes.length, counts,
    codecKind: "h264", codecName: "H.264 / AVC", unitName: "NAL", blockName: "宏块",
    blockSize: 16, parameterSetTypes: [7, 8], parameterSetName: "SPS 参数",
  };
}

export function nalColor(type: number) {
  if (type === 5) return "#ff6b35";
  if (type === 1) return "#3b82f6";
  if (type === 7) return "#d9ff43";
  if (type === 8) return "#b794f4";
  if (type === 6) return "#f6c445";
  return "#9ca3af";
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
}
