import { Analysis, BitReader, NalUnit, rbsp } from "./h264";

export type H264Partition = {
  x: number; y: number; width: number; height: number; mode: string;
};

export type H264Macroblock = {
  address: number; sliceUnitIndex: number; sliceType: string; rawType?: number;
  typeName: string; prediction: "Intra" | "Inter" | "Skip" | "PCM";
  skipped: boolean; codedBlockPattern?: number; qpDelta?: number;
  partitions: H264Partition[];
};

export type H264SubblockAnalysis = {
  status: "parsed" | "partial" | "unsupported" | "error";
  message: string; entropyMode?: "CAVLC" | "CABAC";
  macroblocks: Array<H264Macroblock | undefined>; parsedCount: number;
};

type SpsSyntax = {
  id: number; profileIdc: number; chromaFormatIdc: number; separateColourPlane: boolean;
  bitDepthLuma: number; bitDepthChroma: number; log2MaxFrameNum: number;
  picOrderCntType: number; log2MaxPicOrderCntLsb: number; deltaPicOrderAlwaysZero: boolean;
  widthMbs: number; heightMapUnits: number; frameMbsOnly: boolean; mbAdaptiveFrameField: boolean;
};

type PpsSyntax = {
  id: number; spsId: number; entropyCodingMode: boolean; bottomFieldPicOrderPresent: boolean;
  numSliceGroups: number; numRefL0: number; numRefL1: number; weightedPred: boolean;
  weightedBipredIdc: number; redundantPicCntPresent: boolean; deblockingFilterControlPresent: boolean;
  transform8x8Mode: boolean;
};

type SliceSyntax = {
  firstMb: number; sliceType: "P" | "B" | "I" | "SP" | "SI"; pps: PpsSyntax; sps: SpsSyntax;
  numRefL0: number; numRefL1: number; reader: BitReader;
};

type VlcValue = { bits: string; values: number[] };

// Tables 9-5 through 9-10 of H.264. The compact values were cross-checked against JCodec's
// FreeBSD-licensed CAVLC implementation: https://github.com/jcodec/jcodec
function vlcTriples(source: string): VlcValue[] {
  return source.split(",").map(item => { const [bits, total, trailing] = item.split(":"); return { bits, values: [Number(total), Number(trailing)] }; });
}
function vlcValues(source: string): VlcValue[] {
  return source.split(",").map(item => { const [bits, value] = item.split(":"); return { bits, values: [Number(value)] }; });
}

const CT0 = vlcTriples("1:0:0,000101:1:0,01:1:1,00000111:2:0,000100:2:1,001:2:2,000000111:3:0,00000110:3:1,0000101:3:2,00011:3:3,0000000111:4:0,000000110:4:1,00000101:4:2,000011:4:3,00000000111:5:0,0000000110:5:1,000000101:5:2,0000100:5:3,0000000001111:6:0,00000000110:6:1,0000000101:6:2,00000100:6:3,0000000001011:7:0,0000000001110:7:1,00000000101:7:2,000000100:7:3,0000000001000:8:0,0000000001010:8:1,0000000001101:8:2,0000000100:8:3,00000000001111:9:0,00000000001110:9:1,0000000001001:9:2,00000000100:9:3,00000000001011:10:0,00000000001010:10:1,00000000001101:10:2,0000000001100:10:3,000000000001111:11:0,000000000001110:11:1,00000000001001:11:2,00000000001100:11:3,000000000001011:12:0,000000000001010:12:1,000000000001101:12:2,00000000001000:12:3,0000000000001111:13:0,000000000000001:13:1,000000000001001:13:2,000000000001100:13:3,0000000000001011:14:0,0000000000001110:14:1,0000000000001101:14:2,000000000001000:14:3,0000000000000111:15:0,0000000000001010:15:1,0000000000001001:15:2,0000000000001100:15:3,0000000000000100:16:0,0000000000000110:16:1,0000000000000101:16:2,0000000000001000:16:3");
const CT2 = vlcTriples("11:0:0,001011:1:0,10:1:1,000111:2:0,00111:2:1,011:2:2,0000111:3:0,001010:3:1,001001:3:2,0101:3:3,00000111:4:0,000110:4:1,000101:4:2,0100:4:3,00000100:5:0,0000110:5:1,0000101:5:2,00110:5:3,000000111:6:0,00000110:6:1,00000101:6:2,001000:6:3,00000001111:7:0,000000110:7:1,000000101:7:2,000100:7:3,00000001011:8:0,00000001110:8:1,00000001101:8:2,0000100:8:3,000000001111:9:0,00000001010:9:1,00000001001:9:2,000000100:9:3,000000001011:10:0,000000001110:10:1,000000001101:10:2,00000001100:10:3,000000001000:11:0,000000001010:11:1,000000001001:11:2,00000001000:11:3,0000000001111:12:0,0000000001110:12:1,0000000001101:12:2,000000001100:12:3,0000000001011:13:0,0000000001010:13:1,0000000001001:13:2,0000000001100:13:3,0000000000111:14:0,00000000001011:14:1,0000000000110:14:2,0000000001000:14:3,00000000001001:15:0,00000000001000:15:1,00000000001010:15:2,0000000000001:15:3,00000000000111:16:0,00000000000110:16:1,00000000000101:16:2,00000000000100:16:3");
const CT4 = vlcTriples("1111:0:0,001111:1:0,1110:1:1,001011:2:0,01111:2:1,1101:2:2,001000:3:0,01100:3:1,01110:3:2,1100:3:3,0001111:4:0,01010:4:1,01011:4:2,1011:4:3,0001011:5:0,01000:5:1,01001:5:2,1010:5:3,0001001:6:0,001110:6:1,001101:6:2,1001:6:3,0001000:7:0,001010:7:1,001001:7:2,1000:7:3,00001111:8:0,0001110:8:1,0001101:8:2,01101:8:3,00001011:9:0,00001110:9:1,0001010:9:2,001100:9:3,000001111:10:0,00001010:10:1,00001101:10:2,0001100:10:3,000001011:11:0,000001110:11:1,00001001:11:2,00001100:11:3,000001000:12:0,000001010:12:1,000001101:12:2,00001000:12:3,0000001101:13:0,000000111:13:1,000001001:13:2,000001100:13:3,0000001001:14:0,0000001100:14:1,0000001011:14:2,0000001010:14:3,0000000101:15:0,0000001000:15:1,0000000111:15:2,0000000110:15:3,0000000001:16:0,0000000100:16:1,0000000011:16:2,0000000010:16:3");
const CT8 = vlcTriples("000011:0:0,000000:1:0,000001:1:1,000100:2:0,000101:2:1,000110:2:2,001000:3:0,001001:3:1,001010:3:2,001011:3:3,001100:4:0,001101:4:1,001110:4:2,001111:4:3,010000:5:0,010001:5:1,010010:5:2,010011:5:3,010100:6:0,010101:6:1,010110:6:2,010111:6:3,011000:7:0,011001:7:1,011010:7:2,011011:7:3,011100:8:0,011101:8:1,011110:8:2,011111:8:3,100000:9:0,100001:9:1,100010:9:2,100011:9:3,100100:10:0,100101:10:1,100110:10:2,100111:10:3,101000:11:0,101001:11:1,101010:11:2,101011:11:3,101100:12:0,101101:12:1,101110:12:2,101111:12:3,110000:13:0,110001:13:1,110010:13:2,110011:13:3,110100:14:0,110101:14:1,110110:14:2,110111:14:3,111000:15:0,111001:15:1,111010:15:2,111011:15:3,111100:16:0,111101:16:1,111110:16:2,111111:16:3");
const CT_CHROMA_420 = vlcTriples("01:0:0,000111:1:0,1:1:1,000100:2:0,000110:2:1,001:2:2,000011:3:0,0000011:3:1,0000010:3:2,000101:3:3,000010:4:0,00000011:4:1,00000010:4:2,0000000:4:3");
const RUN_BEFORE = ["1:0,0:1","1:0,01:1,00:2","11:0,10:1,01:2,00:3","11:0,10:1,01:2,001:3,000:4","11:0,10:1,011:2,010:3,001:4,000:5","11:0,000:1,001:2,011:3,010:4,101:5,100:6","111:0,110:1,101:2,100:3,011:4,010:5,001:6,0001:7,00001:8,000001:9,0000001:10,00000001:11,000000001:12,0000000001:13,00000000001:14"].map(vlcValues);
const TOTAL_ZEROS_16 = ["1:0,011:1,010:2,0011:3,0010:4,00011:5,00010:6,000011:7,000010:8,0000011:9,0000010:10,00000011:11,00000010:12,000000011:13,000000010:14,000000001:15","111:0,110:1,101:2,100:3,011:4,0101:5,0100:6,0011:7,0010:8,00011:9,00010:10,000011:11,000010:12,000001:13,000000:14","0101:0,111:1,110:2,101:3,0100:4,0011:5,100:6,011:7,0010:8,00011:9,00010:10,000001:11,00001:12,000000:13","00011:0,111:1,0101:2,0100:3,110:4,101:5,100:6,0011:7,011:8,0010:9,00010:10,00001:11,00000:12","0101:0,0100:1,0011:2,111:3,110:4,101:5,100:6,011:7,0010:8,00001:9,0001:10,00000:11","000001:0,00001:1,111:2,110:3,101:4,100:5,011:6,010:7,0001:8,001:9,000000:10","000001:0,00001:1,101:2,100:3,011:4,11:5,010:6,0001:7,001:8,000000:9","000001:0,0001:1,00001:2,011:3,11:4,10:5,010:6,001:7,000000:8","000001:0,000000:1,0001:2,11:3,10:4,001:5,01:6,00001:7","00001:0,00000:1,001:2,11:3,10:4,01:5,0001:6","0000:0,0001:1,001:2,010:3,1:4,011:5","0000:0,0001:1,01:2,1:3,001:4","000:0,001:1,1:2,01:3","00:0,01:1,1:2","0:0,1:1"].map(vlcValues);
const TOTAL_ZEROS_4 = ["1:0,01:1,001:2,000:3","1:0,01:1,00:2","1:0,0:1"].map(vlcValues);

const CBP_INTRA = [47,31,15,0,23,27,29,30,7,11,13,14,39,43,45,46,16,3,5,10,12,19,21,26,28,35,37,42,44,1,2,4,8,17,18,20,24,6,9,22,25,32,33,34,36,40,38,41];
const CBP_INTER = [0,16,1,2,4,8,32,3,5,10,12,15,47,7,11,13,14,6,9,31,35,37,42,44,33,34,36,40,39,43,45,46,17,18,20,24,19,21,26,28,23,27,29,30,22,25,38,41];
const BLOCK_X = [0,1,0,1,2,3,2,3,0,1,0,1,2,3,2,3];
const BLOCK_Y = [0,0,1,1,0,0,1,1,2,2,3,3,2,2,3,3];
const MAX_MACROBLOCKS = 262_144;

function readVlc(reader: BitReader, table: VlcValue[]) {
  let code = "";
  const max = table.reduce((value, entry) => Math.max(value, entry.bits.length), 0);
  for (let i = 0; i < max; i++) {
    code += reader.readBit();
    const match = table.find(entry => entry.bits === code);
    if (match) return match.values;
  }
  throw new Error("无效的 CAVLC VLC 码字");
}

function skipScalingList(reader: BitReader, size: number) {
  let last = 8, next = 8;
  for (let i = 0; i < size; i++) { if (next !== 0) next = (last + reader.readSE() + 256) % 256; last = next === 0 ? last : next; }
}

function parseSpsSyntax(payload: Uint8Array): SpsSyntax {
  const reader = new BitReader(rbsp(payload));
  const profileIdc = reader.readBits(8); reader.readBits(8); reader.readBits(8);
  const id = reader.readUE();
  let chromaFormatIdc = 1, separateColourPlane = false, bitDepthLuma = 8, bitDepthChroma = 8;
  if (new Set([100,110,122,244,44,83,86,118,128,138,139,134,135]).has(profileIdc)) {
    chromaFormatIdc = reader.readUE();
    if (chromaFormatIdc === 3) separateColourPlane = Boolean(reader.readBit());
    bitDepthLuma = 8 + reader.readUE(); bitDepthChroma = 8 + reader.readUE(); reader.readBit();
    if (reader.readBit()) for (let i = 0, count = chromaFormatIdc === 3 ? 12 : 8; i < count; i++) if (reader.readBit()) skipScalingList(reader, i < 6 ? 16 : 64);
  }
  const log2MaxFrameNum = reader.readUE() + 4;
  const picOrderCntType = reader.readUE();
  let log2MaxPicOrderCntLsb = 0, deltaPicOrderAlwaysZero = false;
  if (picOrderCntType === 0) log2MaxPicOrderCntLsb = reader.readUE() + 4;
  else if (picOrderCntType === 1) {
    deltaPicOrderAlwaysZero = Boolean(reader.readBit()); reader.readSE(); reader.readSE();
    const cycle = reader.readUE(); if (cycle > 256) throw new Error("SPS POC cycle 过大");
    for (let i = 0; i < cycle; i++) reader.readSE();
  }
  reader.readUE(); reader.readBit();
  const widthMbs = reader.readUE() + 1, heightMapUnits = reader.readUE() + 1;
  const frameMbsOnly = Boolean(reader.readBit());
  const mbAdaptiveFrameField = !frameMbsOnly && Boolean(reader.readBit());
  return { id, profileIdc, chromaFormatIdc, separateColourPlane, bitDepthLuma, bitDepthChroma, log2MaxFrameNum, picOrderCntType, log2MaxPicOrderCntLsb, deltaPicOrderAlwaysZero, widthMbs, heightMapUnits, frameMbsOnly, mbAdaptiveFrameField };
}

function parsePpsSyntax(payload: Uint8Array): PpsSyntax {
  const reader = new BitReader(rbsp(payload));
  const id = reader.readUE(), spsId = reader.readUE();
  const entropyCodingMode = Boolean(reader.readBit()), bottomFieldPicOrderPresent = Boolean(reader.readBit());
  const numSliceGroups = reader.readUE() + 1;
  if (numSliceGroups !== 1) throw new Error("暂不支持 FMO 多 slice group");
  const numRefL0 = reader.readUE() + 1, numRefL1 = reader.readUE() + 1;
  const weightedPred = Boolean(reader.readBit()), weightedBipredIdc = reader.readBits(2);
  reader.readSE(); reader.readSE(); reader.readSE();
  const deblockingFilterControlPresent = Boolean(reader.readBit()); reader.readBit();
  const redundantPicCntPresent = Boolean(reader.readBit());
  let transform8x8Mode = false;
  if (reader.moreRbspData()) {
    transform8x8Mode = Boolean(reader.readBit());
    if (reader.readBit()) throw new Error("暂不支持 PPS pic_scaling_matrix");
    if (reader.moreRbspData()) reader.readSE();
  }
  return { id, spsId, entropyCodingMode, bottomFieldPicOrderPresent, numSliceGroups, numRefL0, numRefL1, weightedPred, weightedBipredIdc, redundantPicCntPresent, deblockingFilterControlPresent, transform8x8Mode };
}

function skipRefPicListModification(reader: BitReader, sliceType: string) {
  const skipList = () => { if (!reader.readBit()) return; for (let i = 0; i < 1024; i++) { const idc = reader.readUE(); if (idc === 3) return; if (idc === 0 || idc === 1) reader.readUE(); else if (idc === 2) reader.readUE(); else throw new Error("无效 ref_pic_list_modification_idc"); } throw new Error("参考图像列表过长"); };
  if (sliceType !== "I" && sliceType !== "SI") skipList();
  if (sliceType === "B") skipList();
}

function skipPredWeightTable(reader: BitReader, sps: SpsSyntax, refsL0: number, refsL1: number, sliceType: string) {
  reader.readUE(); if (sps.chromaFormatIdc !== 0) reader.readUE();
  const list = (count: number) => { if (count > 64) throw new Error("参考图像数过大"); for (let i = 0; i < count; i++) { if (reader.readBit()) { reader.readSE(); reader.readSE(); } if (sps.chromaFormatIdc !== 0 && reader.readBit()) for (let j = 0; j < 2; j++) { reader.readSE(); reader.readSE(); } } };
  list(refsL0); if (sliceType === "B") list(refsL1);
}

function skipDecRefPicMarking(reader: BitReader, nalType: number, refIdc: number) {
  if (!refIdc) return;
  if (nalType === 5) { reader.readBit(); reader.readBit(); return; }
  if (!reader.readBit()) return;
  for (let i = 0; i < 1024; i++) {
    const op = reader.readUE(); if (op === 0) return;
    if (op === 1 || op === 3) reader.readUE(); if (op === 2) reader.readUE();
    if (op === 3 || op === 6) reader.readUE(); if (op === 4) reader.readUE();
    if (op > 6) throw new Error("无效 memory_management_control_operation");
  }
  throw new Error("参考图像标记操作过长");
}

function parseSliceHeader(payload: Uint8Array, unit: NalUnit, ppsMap: Map<number, PpsSyntax>, spsMap: Map<number, SpsSyntax>): SliceSyntax {
  const reader = new BitReader(rbsp(payload));
  const firstMb = reader.readUE(), rawSliceType = reader.readUE();
  const sliceType = (["P","B","I","SP","SI"] as const)[rawSliceType % 5];
  const ppsId = reader.readUE(), pps = ppsMap.get(ppsId);
  if (!pps) throw new Error(`Slice 引用缺失的 PPS ${ppsId}`);
  const sps = spsMap.get(pps.spsId); if (!sps) throw new Error(`PPS ${ppsId} 引用缺失的 SPS ${pps.spsId}`);
  if (sps.separateColourPlane) reader.readBits(2);
  reader.readBits(sps.log2MaxFrameNum);
  let fieldPic = false;
  if (!sps.frameMbsOnly) { fieldPic = Boolean(reader.readBit()); if (fieldPic) reader.readBit(); }
  if (unit.type === 5) reader.readUE();
  if (sps.picOrderCntType === 0) { reader.readBits(sps.log2MaxPicOrderCntLsb); if (pps.bottomFieldPicOrderPresent && !fieldPic) reader.readSE(); }
  else if (sps.picOrderCntType === 1 && !sps.deltaPicOrderAlwaysZero) { reader.readSE(); if (pps.bottomFieldPicOrderPresent && !fieldPic) reader.readSE(); }
  if (pps.redundantPicCntPresent) reader.readUE();
  if (sliceType === "B") reader.readBit();
  let numRefL0 = pps.numRefL0, numRefL1 = pps.numRefL1;
  if (sliceType === "P" || sliceType === "SP" || sliceType === "B") if (reader.readBit()) { numRefL0 = reader.readUE() + 1; if (sliceType === "B") numRefL1 = reader.readUE() + 1; }
  skipRefPicListModification(reader, sliceType);
  if ((pps.weightedPred && (sliceType === "P" || sliceType === "SP")) || (pps.weightedBipredIdc === 1 && sliceType === "B")) skipPredWeightTable(reader, sps, numRefL0, numRefL1, sliceType);
  skipDecRefPicMarking(reader, unit.type, unit.refIdc);
  if (pps.entropyCodingMode && sliceType !== "I" && sliceType !== "SI") reader.readUE();
  reader.readSE();
  if (sliceType === "SP" || sliceType === "SI") { if (sliceType === "SP") reader.readBit(); reader.readSE(); }
  if (pps.deblockingFilterControlPresent) { const disable = reader.readUE(); if (disable !== 1) { reader.readSE(); reader.readSE(); } }
  return { firstMb, sliceType, pps, sps, numRefL0, numRefL1, reader };
}

function rectanglePartitions(mode: string): H264Partition[] {
  if (mode === "16×8") return [{x:0,y:0,width:16,height:8,mode},{x:0,y:8,width:16,height:8,mode}];
  if (mode === "8×16") return [{x:0,y:0,width:8,height:16,mode},{x:8,y:0,width:8,height:16,mode}];
  if (mode === "8×8") return [0,1,2,3].map(i => ({x:(i&1)*8,y:(i>>1)*8,width:8,height:8,mode}));
  if (mode === "4×4") return Array.from({length:16},(_,i)=>({x:(i&3)*4,y:(i>>2)*4,width:4,height:4,mode}));
  return [{x:0,y:0,width:16,height:16,mode:"16×16"}];
}

function subPartitions(types: number[]) {
  const result: H264Partition[] = [];
  for (let i = 0; i < 4; i++) {
    const baseX = (i & 1) * 8, baseY = (i >> 1) * 8, type = types[i];
    if (type === 0) result.push({x:baseX,y:baseY,width:8,height:8,mode:"P_L0_8×8"});
    else if (type === 1) for (let y = 0; y < 8; y += 4) result.push({x:baseX,y:baseY+y,width:8,height:4,mode:"P_L0_8×4"});
    else if (type === 2) for (let x = 0; x < 8; x += 4) result.push({x:baseX+x,y:baseY,width:4,height:8,mode:"P_L0_4×8"});
    else if (type === 3) for (let y = 0; y < 8; y += 4) for (let x = 0; x < 8; x += 4) result.push({x:baseX+x,y:baseY+y,width:4,height:4,mode:"P_L0_4×4"});
    else throw new Error(`无效 sub_mb_type ${type}`);
  }
  return result;
}

function readCoeffBlock(reader: BitReader, nC: number, maxCoeff: number, chromaDc = false) {
  const table = chromaDc ? CT_CHROMA_420 : nC < 2 ? CT0 : nC < 4 ? CT2 : nC < 8 ? CT4 : CT8;
  const [totalCoeff, trailingOnes] = readVlc(reader, table);
  if (totalCoeff > maxCoeff || trailingOnes > totalCoeff) throw new Error("无效 coeff_token");
  for (let i = 0; i < trailingOnes; i++) reader.readBit();
  let suffixLength = totalCoeff > 10 && trailingOnes < 3 ? 1 : 0;
  for (let i = trailingOnes; i < totalCoeff; i++) {
    let prefix = 0; while (reader.readBit() === 0) { if (++prefix > 31) throw new Error("CAVLC level_prefix 过大"); }
    let suffixSize = suffixLength; if (prefix === 14 && suffixLength === 0) suffixSize = 4; else if (prefix >= 15) suffixSize = prefix - 3;
    let levelCode = Math.min(15, prefix) << suffixLength;
    if (suffixSize) levelCode += reader.readBits(suffixSize);
    if (prefix >= 15 && suffixLength === 0) levelCode += 15;
    if (prefix >= 16) levelCode += 2 ** (prefix - 3) - 4096;
    if (i === trailingOnes && trailingOnes < 3) levelCode += 2;
    const level = levelCode % 2 === 0 ? (levelCode + 2) >> 1 : (-levelCode - 1) >> 1;
    if (suffixLength === 0) suffixLength = 1;
    if (Math.abs(level) > (3 << (suffixLength - 1)) && suffixLength < 6) suffixLength++;
  }
  let zerosLeft = totalCoeff < maxCoeff && totalCoeff > 0 ? readVlc(reader, maxCoeff === 4 ? TOTAL_ZEROS_4[totalCoeff - 1] : TOTAL_ZEROS_16[totalCoeff - 1])[0] : 0;
  for (let i = 0; i < totalCoeff - 1 && zerosLeft > 0; i++) { const run = readVlc(reader, RUN_BEFORE[Math.min(6, zerosLeft - 1)])[0]; zerosLeft -= run; }
  return totalCoeff;
}

class CavlcPicture {
  private readonly luma: Int16Array;
  private readonly chromaU: Int16Array;
  private readonly chromaV: Int16Array;
  constructor(private readonly widthMbs: number, heightMbs: number) {
    if (widthMbs * heightMbs > MAX_MACROBLOCKS) throw new Error(`图像超过 ${MAX_MACROBLOCKS.toLocaleString()} 个宏块的解析上限`);
    this.luma = new Int16Array(widthMbs * 4 * heightMbs * 4); this.luma.fill(-1);
    this.chromaU = new Int16Array(widthMbs * 2 * heightMbs * 2); this.chromaU.fill(-1);
    this.chromaV = new Int16Array(widthMbs * 2 * heightMbs * 2); this.chromaV.fill(-1);
  }
  private context(grid: Int16Array, width: number, x: number, y: number) {
    const left = x > 0 ? grid[y * width + x - 1] : -1, top = y > 0 ? grid[(y - 1) * width + x] : -1;
    return left >= 0 && top >= 0 ? (left + top + 1) >> 1 : left >= 0 ? left : top >= 0 ? top : 0;
  }
  resetMacroblock(address: number) {
    const mbX = address % this.widthMbs, mbY = Math.floor(address / this.widthMbs), lumaWidth = this.widthMbs * 4, chromaWidth = this.widthMbs * 2;
    for (let y=0;y<4;y++) for(let x=0;x<4;x++) this.luma[(mbY*4+y)*lumaWidth+mbX*4+x]=0;
    for (const grid of [this.chromaU,this.chromaV]) for(let y=0;y<2;y++) for(let x=0;x<2;x++) grid[(mbY*2+y)*chromaWidth+mbX*2+x]=0;
  }
  readLuma(reader: BitReader, address: number, cbpLuma: number, intra16: boolean) {
    const mbX = address % this.widthMbs, mbY = Math.floor(address / this.widthMbs), width = this.widthMbs * 4;
    if (intra16) readCoeffBlock(reader, this.context(this.luma,width,mbX*4,mbY*4),16);
    for (let i=0;i<16;i++) {
      const x=mbX*4+BLOCK_X[i], y=mbY*4+BLOCK_Y[i], index=y*width+x;
      this.luma[index]=(cbpLuma&(1<<(i>>2))) ? readCoeffBlock(reader,this.context(this.luma,width,x,y),intra16?15:16) : 0;
    }
  }
  readChroma(reader: BitReader, address: number, cbpChroma: number) {
    const mbX=address%this.widthMbs,mbY=Math.floor(address/this.widthMbs),width=this.widthMbs*2;
    if (cbpChroma) { readCoeffBlock(reader,0,4,true); readCoeffBlock(reader,0,4,true); }
    for (const grid of [this.chromaU,this.chromaV]) for(let i=0;i<4;i++) {
      const x=mbX*2+(i&1),y=mbY*2+(i>>1),index=y*width+x;
      grid[index]=(cbpChroma&2)?readCoeffBlock(reader,this.context(grid,width,x,y),15):0;
    }
  }
}

function readTe(reader: BitReader, count: number) { return count <= 1 ? (count === 1 ? 1-reader.readBit() : 0) : reader.readUE(); }
function skipMotion(reader: BitReader, partitionCount: number, refs: number) { for(let i=0;i<partitionCount;i++) if(refs>1) readTe(reader,refs-1); for(let i=0;i<partitionCount;i++){reader.readSE();reader.readSE();} }

function parseMacroblock(reader: BitReader, slice: SliceSyntax, address: number, unitIndex: number, picture: CavlcPicture): H264Macroblock {
  const rawType=reader.readUE();
  let intraType=rawType, typeName="", prediction:H264Macroblock["prediction"]="Inter", partitions:H264Partition[]=[], cbp=0, qpDelta:number|undefined;
  if(slice.sliceType==="P") {
    if(rawType===0){typeName="P_L0_16×16";partitions=rectanglePartitions("16×16");skipMotion(reader,1,slice.numRefL0);}
    else if(rawType===1){typeName="P_L0_L0_16×8";partitions=rectanglePartitions("16×8");skipMotion(reader,2,slice.numRefL0);}
    else if(rawType===2){typeName="P_L0_L0_8×16";partitions=rectanglePartitions("8×16");skipMotion(reader,2,slice.numRefL0);}
    else if(rawType===3||rawType===4){const types=[reader.readUE(),reader.readUE(),reader.readUE(),reader.readUE()];typeName=rawType===3?"P_8×8":"P_8×8ref0";partitions=subPartitions(types);if(rawType===3&&slice.numRefL0>1)for(let i=0;i<4;i++)readTe(reader,slice.numRefL0-1);for(const type of types)for(let i=0;i<[1,2,2,4][type];i++){reader.readSE();reader.readSE();}}
    else intraType=rawType-5;
  }
  if(slice.sliceType==="I"||intraType!==rawType) {
    prediction="Intra";
    if(intraType===0){const transform8=slice.pps.transform8x8Mode&&Boolean(reader.readBit());const blocks=transform8?4:16;for(let i=0;i<blocks;i++)if(!reader.readBit())reader.readBits(3);reader.readUE();const code=reader.readUE();if(code>=CBP_INTRA.length)throw new Error("无效 intra coded_block_pattern");cbp=CBP_INTRA[code];if(cbp)qpDelta=reader.readSE();typeName=transform8?"I_8×8":"I_4×4";partitions=rectanglePartitions(transform8?"8×8":"4×4");picture.readLuma(reader,address,cbp&15,false);picture.readChroma(reader,address,cbp>>4);}
    else if(intraType>=1&&intraType<=24){const value=intraType-1;cbp=((Math.floor(value/12))*15)|((Math.floor(value/4)%3)<<4);reader.readUE();qpDelta=reader.readSE();typeName=`I_16×16 (${value%4})`;partitions=rectanglePartitions("16×16");picture.readLuma(reader,address,cbp&15,true);picture.readChroma(reader,address,cbp>>4);}
    else if(intraType===25){reader.align();const samples=256+2*8*8;if(reader.bitsRemaining<samples*8)throw new Error("I_PCM 数据不完整");for(let i=0;i<samples;i++)reader.readBits(8);typeName="I_PCM";prediction="PCM";partitions=rectanglePartitions("16×16");picture.resetMacroblock(address);}
    else throw new Error(`无效 I mb_type ${intraType}`);
  } else {
    if(!partitions.length)throw new Error(`暂不支持 ${slice.sliceType} mb_type ${rawType}`);
    const code=reader.readUE();if(code>=CBP_INTER.length)throw new Error("无效 inter coded_block_pattern");cbp=CBP_INTER[code];
    if(cbp&&slice.pps.transform8x8Mode)reader.readBit();if(cbp)qpDelta=reader.readSE();picture.readLuma(reader,address,cbp&15,false);picture.readChroma(reader,address,cbp>>4);
  }
  return {address,sliceUnitIndex:unitIndex,sliceType:slice.sliceType,rawType,typeName,prediction,skipped:false,codedBlockPattern:cbp,qpDelta,partitions};
}

function unitPayload(bytes: Uint8Array, unit: NalUnit) { return bytes.subarray(unit.offset+unit.startCodeSize+1,unit.offset+unit.size); }

export function analyzeH264Subblocks(bytes: Uint8Array, analysis: Analysis, frameUnitIndex: number): H264SubblockAnalysis {
  const empty: Array<H264Macroblock|undefined>=[];
  if(analysis.codecKind!=="h264")return {status:"unsupported",message:"子块语法解析目前先支持 H.264",macroblocks:empty,parsedCount:0};
  try {
    const spsMap=new Map<number,SpsSyntax>(),ppsMap=new Map<number,PpsSyntax>();
    const nextFrame=analysis.units.find(unit=>unit.index>frameUnitIndex&&unit.frameStart)?.index??analysis.units.length;
    for(const unit of analysis.units){if(unit.index>=nextFrame)break;try{if(unit.type===7){const s=parseSpsSyntax(unitPayload(bytes,unit));spsMap.set(s.id,s);}else if(unit.type===8){const p=parsePpsSyntax(unitPayload(bytes,unit));ppsMap.set(p.id,p);}}catch{/* damaged or unsupported parameter set is reported by the referenced slice */}}
    const sliceUnits=analysis.units.filter(unit=>unit.index>=frameUnitIndex&&unit.index<nextFrame&&unit.type>=1&&unit.type<=5);
    if(!sliceUnits.length)return {status:"error",message:"该帧没有 H.264 VCL Slice",macroblocks:empty,parsedCount:0};
    let macroblocks:Array<H264Macroblock|undefined>=[],entropyMode:"CAVLC"|"CABAC"|undefined,reason="";
    for(const unit of sliceUnits){
      let slice:SliceSyntax;try{slice=parseSliceHeader(unitPayload(bytes,unit),unit,ppsMap,spsMap);}catch(error){reason=error instanceof Error?error.message:"Slice Header 解析失败";continue;}
      entropyMode=slice.pps.entropyCodingMode?"CABAC":"CAVLC";
      const heightMbs=slice.sps.heightMapUnits*(slice.sps.frameMbsOnly?1:2),count=slice.sps.widthMbs*heightMbs;
      if(!Number.isSafeInteger(count)||count<=0||count>MAX_MACROBLOCKS)throw new Error(`图像宏块数无效或超过 ${MAX_MACROBLOCKS.toLocaleString()} 上限`);
      if(!macroblocks.length)macroblocks=new Array(count);
      if(slice.pps.entropyCodingMode){reason="该帧使用 CABAC；当前版本先实现 CAVLC 子块解析";continue;}
      if(!slice.sps.frameMbsOnly||slice.sps.mbAdaptiveFrameField){reason="当前子块解析仅支持逐行 frame_mbs_only 码流";continue;}
      if(slice.sps.chromaFormatIdc!==1||slice.sps.bitDepthLuma!==8||slice.sps.bitDepthChroma!==8){reason="当前子块解析仅支持 8-bit 4:2:0 CAVLC 码流";continue;}
      if(slice.sliceType!=="I"&&slice.sliceType!=="P"){reason=`当前子块解析暂不支持 ${slice.sliceType} Slice`;continue;}
      // CAVLC neighbouring blocks across a slice boundary are unavailable, so each slice owns
      // a fresh coefficient-context grid even though the output macroblock array is per picture.
      const picture=new CavlcPicture(slice.sps.widthMbs,heightMbs);
      let address=slice.firstMb;
      try{
        while(slice.reader.moreRbspData()&&address<count){
          if(slice.sliceType==="P"){
            const skipRun=slice.reader.readUE();if(skipRun>count-address)throw new Error("mb_skip_run 超出图像范围");
            for(let i=0;i<skipRun;i++,address++){picture.resetMacroblock(address);macroblocks[address]={address,sliceUnitIndex:unit.index,sliceType:"P",typeName:"P_SKIP",prediction:"Skip",skipped:true,partitions:rectanglePartitions("16×16")};}
            if(!slice.reader.moreRbspData()||address>=count)break;
          }
          macroblocks[address]=parseMacroblock(slice.reader,slice,address,unit.index,picture);address++;
        }
      }catch(error){reason=`NAL #${unit.index}: ${error instanceof Error?error.message:"宏块解析失败"}`;}
    }
    const parsedCount=macroblocks.reduce((sum,item)=>sum+Number(Boolean(item)),0);
    if(!parsedCount)return {status:"unsupported",message:reason||"没有可解析的 H.264 宏块",entropyMode,macroblocks,parsedCount};
    return {status:reason?"partial":"parsed",message:reason||`已从 CAVLC 语法解析 ${parsedCount} 个宏块及其分区`,entropyMode,macroblocks,parsedCount};
  }catch(error){return {status:"error",message:error instanceof Error?error.message:"H.264 子块解析失败",macroblocks:empty,parsedCount:0};}
}
