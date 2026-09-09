import {
  Analysis,
  BitReader,
  CodecKind,
  NalUnit,
  SpsInfo,
  analyzeH264,
  findStartCodes,
  formatBytes,
  hexPreview,
  nalColor,
  rbsp,
} from "./h264";

export type { Analysis, CodecKind, NalUnit, SpsInfo } from "./h264";
export { formatBytes };

export const SUPPORTED_EXTENSIONS = [
  ".h264", ".264", ".avc",
  ".h265", ".265", ".hevc",
  ".h266", ".266", ".vvc",
  ".av1", ".obu",
];

const HEVC_NAMES = new Map<number, string>([
  [0, "TRAIL_N 切片"], [1, "TRAIL_R 切片"], [2, "TSA_N 切片"], [3, "TSA_R 切片"],
  [4, "STSA_N 切片"], [5, "STSA_R 切片"], [6, "RADL_N 切片"], [7, "RADL_R 切片"],
  [8, "RASL_N 切片"], [9, "RASL_R 切片"], [16, "BLA_W_LP 关键帧"], [17, "BLA_W_RADL 关键帧"],
  [18, "BLA_N_LP 关键帧"], [19, "IDR_W_RADL 关键帧"], [20, "IDR_N_LP 关键帧"],
  [21, "CRA 关键帧"], [22, "保留 IRAP"], [23, "保留 IRAP"], [32, "VPS 视频参数集"],
  [33, "SPS 序列参数集"], [34, "PPS 图像参数集"], [35, "AUD 访问单元分隔符"],
  [36, "序列结束"], [37, "码流结束"], [38, "填充数据"], [39, "前缀 SEI"], [40, "后缀 SEI"],
]);

const VVC_NAMES = new Map<number, string>([
  [0, "TRAIL 切片"], [1, "STSA 切片"], [2, "RADL 切片"], [3, "RASL 切片"],
  [6, "IDR_W_RADL 关键帧"], [7, "IDR_N_LP 关键帧"], [8, "CRA 关键帧"], [9, "GDR 图像"],
  [12, "OPI 操作点信息"], [13, "DCI 解码能力信息"], [14, "VPS 视频参数集"],
  [15, "SPS 序列参数集"], [16, "PPS 图像参数集"], [17, "前缀 APS"], [18, "后缀 APS"],
  [19, "PH 图像头"], [20, "AUD 访问单元分隔符"], [21, "序列结束"], [22, "码流结束"],
  [23, "前缀 SEI"], [24, "后缀 SEI"],
]);

const AV1_NAMES = new Map<number, string>([
  [1, "Sequence Header"], [2, "Temporal Delimiter"], [3, "Frame Header"],
  [4, "Tile Group"], [5, "Metadata"], [6, "Frame"], [7, "Redundant Frame Header"],
  [8, "Tile List"], [15, "Padding"],
]);

type HevcProfileTierLevel = { profileIdc: number; levelIdc: number };

function skipHevcProfile(reader: BitReader) {
  reader.readBits(2);
  reader.readBit();
  reader.readBits(5);
  reader.readBits(32);
  reader.readBits(4);
  reader.readBits(32);
  reader.readBits(12);
}

function parseHevcProfileTierLevel(reader: BitReader, maxSubLayersMinus1: number): HevcProfileTierLevel {
  reader.readBits(2);
  reader.readBit();
  const profileIdc = reader.readBits(5);
  reader.readBits(32);
  reader.readBits(4);
  reader.readBits(32);
  reader.readBits(12);
  const levelIdc = reader.readBits(8);
  const profilePresent: number[] = [];
  const levelPresent: number[] = [];
  for (let i = 0; i < maxSubLayersMinus1; i++) {
    profilePresent.push(reader.readBit());
    levelPresent.push(reader.readBit());
  }
  if (maxSubLayersMinus1 > 0) for (let i = maxSubLayersMinus1; i < 8; i++) reader.readBits(2);
  for (let i = 0; i < maxSubLayersMinus1; i++) {
    if (profilePresent[i]) skipHevcProfile(reader);
    if (levelPresent[i]) reader.readBits(8);
  }
  return { profileIdc, levelIdc };
}

function hevcProfileName(profileIdc: number) {
  return new Map<number, string>([
    [1, "Main"], [2, "Main 10"], [3, "Main Still Picture"], [4, "Range Extensions"],
    [5, "High Throughput"], [9, "Screen Content Coding"], [11, "Multiview Main"],
  ]).get(profileIdc) ?? `Profile ${profileIdc}`;
}

function parseHevcSps(payload: Uint8Array): SpsInfo {
  const reader = new BitReader(rbsp(payload));
  reader.readBits(4);
  const maxSubLayersMinus1 = reader.readBits(3);
  reader.readBit();
  const ptl = parseHevcProfileTierLevel(reader, maxSubLayersMinus1);
  const spsId = reader.readUE();
  const chromaFormatIdc = reader.readUE();
  const separateColourPlane = chromaFormatIdc === 3 ? reader.readBit() : 0;
  let width = reader.readUE();
  let height = reader.readUE();
  if (reader.readBit()) {
    const left = reader.readUE();
    const right = reader.readUE();
    const top = reader.readUE();
    const bottom = reader.readUE();
    const subWidth = chromaFormatIdc === 1 || chromaFormatIdc === 2 ? 2 : 1;
    const subHeight = chromaFormatIdc === 1 ? 2 : 1;
    width -= (left + right) * (separateColourPlane ? 1 : subWidth);
    height -= (top + bottom) * (separateColourPlane ? 1 : subHeight);
  }
  const bitDepth = 8 + reader.readUE();
  reader.readUE();
  reader.readUE();
  const subLayerOrderingInfoPresent = reader.readBit();
  for (let i = subLayerOrderingInfoPresent ? 0 : maxSubLayersMinus1; i <= maxSubLayersMinus1; i++) {
    reader.readUE(); reader.readUE(); reader.readUE();
  }
  const minCodingBlockLog2 = reader.readUE() + 3;
  const diffMaxMinCodingBlockLog2 = reader.readUE();
  const blockSize = 2 ** (minCodingBlockLog2 + diffMaxMinCodingBlockLog2);
  const chromaNames = ["Monochrome", "4:2:0", "4:2:2", "4:4:4"];
  const codecProfile = ptl.profileIdc === 2 ? "2.4" : "1.6";
  return {
    profileIdc: ptl.profileIdc,
    profile: hevcProfileName(ptl.profileIdc),
    level: (ptl.levelIdc / 30).toFixed(1),
    width,
    height,
    chromaFormat: chromaNames[chromaFormatIdc] ?? `Chroma ${chromaFormatIdc}`,
    bitDepth,
    spsId,
    frameMbsOnly: true,
    codec: `hev1.${codecProfile}.L${ptl.levelIdc}.B0`,
    blockSize,
  };
}

function annexBUnits(bytes: Uint8Array, codec: "h265" | "h266") {
  const starts = findStartCodes(bytes);
  if (!starts.length) throw new Error(`${codec === "h265" ? "H.265/HEVC" : "H.266/VVC"} 裸码流未发现 Annex-B 起始码`);
  const units: NalUnit[] = [];
  const counts = new Map<number, number>();
  let sps: SpsInfo | undefined;
  let vvcBlockSize = 128;

  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const nalOffset = start.offset + start.size;
    let end = i + 1 < starts.length ? starts[i + 1].offset : bytes.length;
    while (end > nalOffset && bytes[end - 1] === 0) end--;
    if (nalOffset + 1 >= end) continue;
    const first = bytes[nalOffset];
    const second = bytes[nalOffset + 1];
    if (first & 0x80) throw new Error(`NAL #${i} 的 forbidden_zero_bit 非零`);

    const type = codec === "h265" ? (first >> 1) & 0x3f : (second >> 3) & 0x1f;
    const layerId = codec === "h265" ? ((first & 1) << 5) | (second >> 3) : first & 0x3f;
    const temporalIdPlusOne = second & 7;
    if (temporalIdPlusOne === 0) throw new Error(`NAL #${i} 的 nuh_temporal_id_plus1 为零`);
    if (codec === "h266" && (first & 0x40)) throw new Error(`NAL #${i} 的 nuh_reserved_zero_bit 非零`);
    const payload = bytes.subarray(nalOffset + 2, end);
    const isVcl = codec === "h265" ? type <= 31 : type <= 11;
    const keyFrame = codec === "h265" ? type >= 16 && type <= 23 : type >= 6 && type <= 9;
    let frameStart = false;
    let firstMb: number | undefined;
    if (codec === "h265" && isVcl && payload.length) {
      try {
        frameStart = new BitReader(rbsp(payload)).readBit() === 1;
        if (frameStart) firstMb = 0;
      } catch { /* damaged slice still appears in the unit list */ }
    }
    if (codec === "h266") frameStart = type === 19;
    if (codec === "h265" && type === 33 && !sps) {
      try { sps = parseHevcSps(payload); } catch { /* keep listing a damaged SPS */ }
    }
    if (codec === "h266" && type === 15 && payload.length) {
      try {
        const reader = new BitReader(rbsp(payload));
        reader.readBits(4); reader.readBits(4); reader.readBits(3); reader.readBits(2);
        vvcBlockSize = 2 ** (reader.readBits(2) + 5);
      } catch { /* retain the standard default */ }
    }
    counts.set(type, (counts.get(type) ?? 0) + 1);
    units.push({
      index: units.length,
      offset: start.offset,
      size: end - start.offset,
      startCodeSize: start.size,
      headerSize: 2,
      type,
      typeName: (codec === "h265" ? HEVC_NAMES : VVC_NAMES).get(type) ?? `${isVcl ? "保留切片" : "保留 NAL"} ${type}`,
      refIdc: 0,
      sliceType: isVcl ? (keyFrame ? "IRAP" : "VCL") : undefined,
      firstMb,
      keyFrame,
      frameStart,
      layerId,
      temporalId: temporalIdPlusOne - 1,
      fields: { nuh_layer_id: layerId, nuh_temporal_id_plus1: temporalIdPlusOne },
      hex: hexPreview(bytes.subarray(start.offset, end)),
    });
  }

  if (codec === "h266" && !units.some(unit => unit.frameStart)) {
    const accessUnitMarkers = units.filter(unit => unit.type === 20);
    if (accessUnitMarkers.length) accessUnitMarkers.forEach(unit => { unit.frameStart = true; });
    else units.filter(unit => unit.type <= 11).forEach(unit => { unit.frameStart = true; });
  }
  const frameCount = units.filter(unit => unit.frameStart).length;
  const idrCount = units.filter(unit => unit.keyFrame && (codec === "h266" || unit.frameStart)).length;
  const blockSize = codec === "h265" ? sps?.blockSize ?? 64 : vvcBlockSize;
  return {
    units,
    sps,
    frameCount,
    idrCount,
    totalBytes: bytes.length,
    counts,
    codecKind: codec,
    codecName: codec === "h265" ? "H.265 / HEVC" : "H.266 / VVC",
    unitName: "NAL" as const,
    blockName: codec === "h265" ? "CTU" : "编码树单元",
    blockSize,
    parameterSetTypes: codec === "h265" ? [32, 33, 34] : [14, 15, 16],
    parameterSetName: codec === "h265" ? "HEVC SPS 参数" : "VVC 参数集",
  } satisfies Analysis;
}

type Av1Sequence = { info: SpsInfo; reducedStillPictureHeader: boolean };

function av1LevelName(levelIdx: number) {
  if (levelIdx > 23) return `Index ${levelIdx}`;
  return `${2 + Math.floor(levelIdx / 4)}.${levelIdx % 4}`;
}

function parseAv1SequenceHeader(payload: Uint8Array): Av1Sequence {
  const reader = new BitReader(payload);
  const profileIdc = reader.readBits(3);
  reader.readBit();
  const reducedStillPictureHeader = reader.readBit() === 1;
  let levelIdx = 0;
  let tier = 0;
  let fps: number | undefined;
  let decoderModelInfoPresent = 0;
  let bufferDelayLength = 0;
  let initialDisplayDelayPresent = 0;

  if (reducedStillPictureHeader) {
    levelIdx = reader.readBits(5);
  } else {
    if (reader.readBit()) {
      const numUnitsInDisplayTick = reader.readBits(32);
      const timeScale = reader.readBits(32);
      const equalPictureInterval = reader.readBit();
      const ticksPerPicture = equalPictureInterval ? reader.readUE() + 1 : 1;
      if (numUnitsInDisplayTick) fps = timeScale / numUnitsInDisplayTick / ticksPerPicture;
      decoderModelInfoPresent = reader.readBit();
      if (decoderModelInfoPresent) {
        bufferDelayLength = reader.readBits(5) + 1;
        reader.readBits(32);
        reader.readBits(5);
        reader.readBits(5);
      }
    }
    initialDisplayDelayPresent = reader.readBit();
    const operatingPointsCntMinus1 = reader.readBits(5);
    for (let i = 0; i <= operatingPointsCntMinus1; i++) {
      reader.readBits(12);
      const currentLevel = reader.readBits(5);
      const currentTier = currentLevel > 7 ? reader.readBit() : 0;
      if (i === 0) { levelIdx = currentLevel; tier = currentTier; }
      if (decoderModelInfoPresent && reader.readBit()) {
        reader.readBits(bufferDelayLength); reader.readBits(bufferDelayLength); reader.readBit();
      }
      if (initialDisplayDelayPresent && reader.readBit()) reader.readBits(4);
    }
  }

  const widthBits = reader.readBits(4) + 1;
  const heightBits = reader.readBits(4) + 1;
  const width = reader.readBits(widthBits) + 1;
  const height = reader.readBits(heightBits) + 1;
  if (!reducedStillPictureHeader && reader.readBit()) {
    reader.readBits(4); reader.readBits(3);
  }
  const blockSize = reader.readBit() ? 128 : 64;
  reader.readBit();
  reader.readBit();
  let enableOrderHint = 0;
  if (!reducedStillPictureHeader) {
    reader.readBit(); reader.readBit(); reader.readBit(); reader.readBit();
    enableOrderHint = reader.readBit();
    if (enableOrderHint) { reader.readBit(); reader.readBit(); }
    const chooseScreenContentTools = reader.readBit();
    const forceScreenContentTools = chooseScreenContentTools ? 2 : reader.readBit();
    if (forceScreenContentTools > 0) {
      const chooseIntegerMv = reader.readBit();
      if (!chooseIntegerMv) reader.readBit();
    }
    if (enableOrderHint) reader.readBits(3);
  }
  reader.readBit();
  reader.readBit();
  reader.readBit();

  const highBitDepth = reader.readBit();
  const twelveBit = profileIdc === 2 && highBitDepth ? reader.readBit() : 0;
  const bitDepth = highBitDepth ? (twelveBit ? 12 : 10) : 8;
  const monochrome = profileIdc === 1 ? 0 : reader.readBit();
  let colorPrimaries = 2;
  let transferCharacteristics = 2;
  let matrixCoefficients = 2;
  if (reader.readBit()) {
    colorPrimaries = reader.readBits(8);
    transferCharacteristics = reader.readBits(8);
    matrixCoefficients = reader.readBits(8);
  }
  let subsamplingX = 1;
  let subsamplingY = 1;
  if (monochrome) {
    reader.readBit();
  } else if (colorPrimaries === 1 && transferCharacteristics === 13 && matrixCoefficients === 0) {
    subsamplingX = 0; subsamplingY = 0;
  } else {
    reader.readBit();
    if (profileIdc === 0) {
      subsamplingX = 1; subsamplingY = 1;
    } else if (profileIdc === 1) {
      subsamplingX = 0; subsamplingY = 0;
    } else if (bitDepth === 12) {
      subsamplingX = reader.readBit();
      subsamplingY = subsamplingX ? reader.readBit() : 0;
    } else {
      subsamplingX = 1; subsamplingY = 0;
    }
    if (subsamplingX && subsamplingY) reader.readBits(2);
  }
  reader.readBit();
  const chromaFormat = monochrome ? "Monochrome" : subsamplingX ? (subsamplingY ? "4:2:0" : "4:2:2") : "4:4:4";
  const profile = ["Main", "High", "Professional"][profileIdc] ?? `Profile ${profileIdc}`;
  const codec = `av01.${profileIdc}.${String(levelIdx).padStart(2, "0")}${tier ? "H" : "M"}.${String(bitDepth).padStart(2, "0")}`;
  return {
    reducedStillPictureHeader,
    info: {
      profileIdc, profile, level: av1LevelName(levelIdx), width, height, chromaFormat, bitDepth,
      fps, spsId: 0, frameMbsOnly: true, codec, blockSize,
    },
  };
}

function readLeb128(bytes: Uint8Array, offset: number) {
  let value = 0;
  let shift = 0;
  for (let i = 0; i < 8; i++) {
    if (offset + i >= bytes.length) throw new Error("AV1 OBU 的 LEB128 长度字段不完整");
    const byte = bytes[offset + i];
    value += (byte & 0x7f) * 2 ** shift;
    if (!(byte & 0x80)) return { value, length: i + 1 };
    shift += 7;
  }
  throw new Error("AV1 OBU 的 LEB128 长度字段过长");
}

function parseAv1FrameType(payload: Uint8Array, reducedStillPictureHeader: boolean) {
  if (reducedStillPictureHeader) return { frameType: "KEY", keyFrame: true };
  try {
    const reader = new BitReader(payload);
    const showExistingFrame = reader.readBit() === 1;
    if (showExistingFrame) return { frameType: "SHOW_EXISTING", keyFrame: false };
    const raw = reader.readBits(2);
    return { frameType: ["KEY", "INTER", "INTRA_ONLY", "SWITCH"][raw], keyFrame: raw === 0 || raw === 3 };
  } catch {
    return { frameType: "FRAME", keyFrame: false };
  }
}

function analyzeAv1(bytes: Uint8Array): Analysis {
  const units: NalUnit[] = [];
  const counts = new Map<number, number>();
  let offset = 0;
  let sequence: Av1Sequence | undefined;
  while (offset < bytes.length) {
    const start = offset;
    const header = bytes[offset++];
    if (header & 0x80) throw new Error(`OBU #${units.length} 的 obu_forbidden_bit 非零`);
    const type = (header >> 3) & 0xf;
    const extensionFlag = (header >> 2) & 1;
    const hasSizeField = (header >> 1) & 1;
    if (header & 1) throw new Error(`OBU #${units.length} 的 obu_reserved_1bit 非零`);
    let temporalId = 0;
    let spatialId = 0;
    if (extensionFlag) {
      if (offset >= bytes.length) throw new Error("AV1 OBU 扩展头不完整");
      const extension = bytes[offset++];
      temporalId = extension >> 5;
      spatialId = (extension >> 3) & 3;
      if (extension & 7) throw new Error(`OBU #${units.length} 的扩展保留位非零`);
    }
    let payloadSize = bytes.length - offset;
    let sizeFieldLength = 0;
    if (hasSizeField) {
      const leb = readLeb128(bytes, offset);
      payloadSize = leb.value;
      sizeFieldLength = leb.length;
      offset += leb.length;
    }
    if (payloadSize < 0 || offset + payloadSize > bytes.length) throw new Error(`OBU #${units.length} 的大小超过文件边界`);
    const payload = bytes.subarray(offset, offset + payloadSize);
    if (type === 1 && !sequence) {
      try { sequence = parseAv1SequenceHeader(payload); } catch { /* damaged header remains inspectable */ }
    }
    const isFrame = type === 3 || type === 6;
    const frame = isFrame ? parseAv1FrameType(payload, sequence?.reducedStillPictureHeader ?? false) : undefined;
    const size = offset + payloadSize - start;
    counts.set(type, (counts.get(type) ?? 0) + 1);
    units.push({
      index: units.length, offset: start, size, startCodeSize: 0,
      headerSize: 1 + extensionFlag + sizeFieldLength,
      type, typeName: AV1_NAMES.get(type) ?? `Reserved OBU ${type}`,
      refIdc: spatialId, sliceType: frame?.frameType,
      keyFrame: frame?.keyFrame, frameStart: isFrame,
      temporalId, layerId: spatialId,
      fields: { obu_extension_flag: Boolean(extensionFlag), temporal_id: temporalId, spatial_id: spatialId },
      hex: hexPreview(bytes.subarray(start, start + size)),
    });
    offset += payloadSize;
    if (!hasSizeField) break;
    if (units.length > 100_000) throw new Error("OBU 超过 100,000 个，为避免浏览器失去响应已停止解析");
  }
  if (!units.length) throw new Error("文件中没有可识别的 AV1 OBU");
  const frameCount = units.filter(unit => unit.frameStart).length;
  const idrCount = units.filter(unit => unit.frameStart && unit.keyFrame).length;
  return {
    units, sps: sequence?.info,
    duration: sequence?.info.fps ? frameCount / sequence.info.fps : undefined,
    frameCount, idrCount, totalBytes: bytes.length, counts,
    codecKind: "av1", codecName: "AV1", unitName: "OBU", blockName: "Superblock",
    blockSize: sequence?.info.blockSize ?? 64, parameterSetTypes: [1], parameterSetName: "Sequence Header",
  };
}

function extensionOf(fileName: string) {
  const lower = fileName.toLowerCase();
  return SUPPORTED_EXTENSIONS.find(extension => lower.endsWith(extension));
}

function detectAnnexBCodec(bytes: Uint8Array): CodecKind {
  const starts = findStartCodes(bytes).slice(0, 200);
  let h264 = 0;
  let h265 = 0;
  let h266 = 0;
  for (const start of starts) {
    const offset = start.offset + start.size;
    if (offset + 1 >= bytes.length) continue;
    const first = bytes[offset];
    const second = bytes[offset + 1];
    const avcType = first & 0x1f;
    const hevcType = (first >> 1) & 0x3f;
    const vvcType = (second >> 3) & 0x1f;
    if (avcType === 7 || avcType === 8) h264 += 8;
    else if (avcType > 0 && avcType <= 23) h264++;
    if ((second & 7) !== 0) {
      if (hevcType >= 32 && hevcType <= 40) h265 += hevcType <= 34 ? 8 : 2;
      else if (hevcType <= 31) h265++;
      if (!(first & 0x40)) {
        if (vvcType >= 14 && vvcType <= 24) h266 += vvcType <= 16 ? 8 : 2;
        else if (vvcType <= 11) h266++;
      }
    }
  }
  if (h265 > h264 && h265 >= h266) return "h265";
  if (h266 > h264 && h266 > h265) return "h266";
  return "h264";
}

export function analyzeBitstream(bytes: Uint8Array, fileName = ""): Analysis {
  const extension = extensionOf(fileName);
  if ([".h265", ".265", ".hevc"].includes(extension ?? "")) return annexBUnits(bytes, "h265");
  if ([".h266", ".266", ".vvc"].includes(extension ?? "")) return annexBUnits(bytes, "h266");
  if ([".av1", ".obu"].includes(extension ?? "")) return analyzeAv1(bytes);
  if ([".h264", ".264", ".avc"].includes(extension ?? "")) return analyzeH264(bytes);
  if (findStartCodes(bytes).length) {
    const codec = detectAnnexBCodec(bytes);
    return codec === "h264" ? analyzeH264(bytes) : annexBUnits(bytes, codec);
  }
  return analyzeAv1(bytes);
}

export function unitColor(type: number, codec: CodecKind) {
  if (codec === "h264") return nalColor(type);
  if (codec === "h265") {
    if (type >= 16 && type <= 23) return "#ff6b35";
    if (type <= 31) return "#3b82f6";
    if (type === 32 || type === 33) return "#d9ff43";
    if (type === 34) return "#b794f4";
    if (type === 39 || type === 40) return "#f6c445";
  }
  if (codec === "h266") {
    if (type >= 6 && type <= 9) return "#ff6b35";
    if (type <= 11) return "#3b82f6";
    if (type === 14 || type === 15) return "#d9ff43";
    if (type === 16 || type === 17 || type === 18) return "#b794f4";
    if (type === 23 || type === 24) return "#f6c445";
  }
  if (codec === "av1") {
    if (type === 1) return "#d9ff43";
    if (type === 3 || type === 6) return "#3b82f6";
    if (type === 4) return "#b794f4";
    if (type === 5) return "#f6c445";
  }
  return "#9ca3af";
}
