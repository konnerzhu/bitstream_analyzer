import type { Analysis, CodecKind, NalUnit } from "./h264";

export const MAX_SYNTAX_NODES = 250_000;
export const MAX_SYNTAX_SEARCH_RESULTS = 500;
export const MAX_SYNTAX_QUERY_LENGTH = 256;

export type SyntaxValue = string | number | boolean;
export type SyntaxNodeKind = "stream" | "group" | "unit" | "field" | "payload";

export type SyntaxSourceRange = {
  byteOffset: number;
  byteLength: number;
  bitOffset?: number;
  bitLength?: number;
};

export type SyntaxNode = {
  id: string;
  path: string;
  name: string;
  kind: SyntaxNodeKind;
  value?: SyntaxValue;
  description?: string;
  unitIndex?: number;
  source?: SyntaxSourceRange;
  children: SyntaxNode[];
};

export type SyntaxSearchEntry = {
  node: SyntaxNode;
  searchText: string;
};

export type SyntaxReport = {
  root: SyntaxNode;
  searchIndex: SyntaxSearchEntry[];
  nodeCount: number;
  truncated: boolean;
};

type NodeBuilder = {
  count: number;
  truncated: boolean;
  index: SyntaxSearchEntry[];
};

function source(byteOffset: number, byteLength: number, bitOffset?: number, bitLength?: number): SyntaxSourceRange {
  return { byteOffset, byteLength, bitOffset, bitLength };
}

function displayValue(value: SyntaxValue | undefined) {
  if (value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function addNode(
  builder: NodeBuilder,
  parent: SyntaxNode | null,
  path: string,
  name: string,
  kind: SyntaxNodeKind,
  options: Omit<SyntaxNode, "id" | "path" | "name" | "kind" | "children"> = {},
) {
  if (builder.count >= MAX_SYNTAX_NODES) {
    builder.truncated = true;
    return null;
  }
  const node: SyntaxNode = { id: `syntax:${path}`, path, name, kind, ...options, children: [] };
  const sourceText = options.source
    ? `${options.source.byteOffset} 0x${options.source.byteOffset.toString(16).padStart(8, "0")} ${options.source.byteLength}`
    : "";
  builder.count += 1;
  builder.index.push({
    node,
    searchText: `${path}\n${name}\n${displayValue(options.value)}\n${options.description ?? ""}\n${sourceText}`.toLocaleLowerCase(),
  });
  parent?.children.push(node);
  return node;
}

function field(
  builder: NodeBuilder,
  parent: SyntaxNode,
  name: string,
  value: SyntaxValue,
  range?: SyntaxSourceRange,
  description?: string,
) {
  return addNode(builder, parent, `${parent.path}.${name}`, name, "field", {
    value,
    description,
    unitIndex: parent.unitIndex,
    source: range,
  });
}

function headerFieldRange(codec: CodecKind, unit: NalUnit, name: string): SyntaxSourceRange | undefined {
  const headerOffset = unit.offset + unit.startCodeSize;
  if (codec === "h264") {
    const bits = new Map<string, [number, number]>([
      ["forbidden_zero_bit", [0, 1]],
      ["nal_ref_idc", [1, 2]],
      ["nal_unit_type", [3, 5]],
    ]);
    const range = bits.get(name);
    return range ? source(headerOffset, 1, range[0], range[1]) : undefined;
  }
  if (codec === "h265") {
    const bits = new Map<string, [number, number]>([
      ["forbidden_zero_bit", [0, 1]],
      ["nal_unit_type", [1, 6]],
      ["nuh_layer_id", [7, 6]],
      ["nuh_temporal_id_plus1", [13, 3]],
    ]);
    const range = bits.get(name);
    return range ? source(headerOffset, 2, range[0], range[1]) : undefined;
  }
  if (codec === "h266") {
    const bits = new Map<string, [number, number]>([
      ["forbidden_zero_bit", [0, 1]],
      ["nuh_reserved_zero_bit", [1, 1]],
      ["nuh_layer_id", [2, 6]],
      ["nal_unit_type", [8, 5]],
      ["nuh_temporal_id_plus1", [13, 3]],
    ]);
    const range = bits.get(name);
    return range ? source(headerOffset, 2, range[0], range[1]) : undefined;
  }
  const bits = new Map<string, [number, number]>([
    ["obu_forbidden_bit", [0, 1]],
    ["obu_type", [1, 4]],
    ["obu_extension_flag", [5, 1]],
    ["obu_has_size_field", [6, 1]],
    ["obu_reserved_1bit", [7, 1]],
  ]);
  if (name === "extension_header_reserved_3bits") return source(headerOffset + 1, 1, 5, 3);
  if (name === "temporal_id") return source(headerOffset + 1, 1, 0, 3);
  if (name === "spatial_id") return source(headerOffset + 1, 1, 3, 2);
  const range = bits.get(name);
  return range ? source(headerOffset, 1, range[0], range[1]) : undefined;
}

function addSummary(builder: NodeBuilder, root: SyntaxNode, analysis: Analysis) {
  const summary = addNode(builder, root, "stream.summary", "stream_summary", "group");
  if (!summary) return;
  field(builder, summary, "codec", analysis.codecName);
  field(builder, summary, "byte_length", analysis.totalBytes);
  field(builder, summary, "unit_count", analysis.units.length);
  field(builder, summary, "frame_count", analysis.frameCount);
  field(builder, summary, "key_frame_count", analysis.idrCount);
  if (analysis.containerName) field(builder, summary, "container", analysis.containerName);
  if (analysis.declaredFrameCount !== undefined) field(builder, summary, "declared_frame_count", analysis.declaredFrameCount);
  if (analysis.containerFrameCount !== undefined) field(builder, summary, "frame_record_count", analysis.containerFrameCount);

  if (analysis.sps) {
    const parameters = addNode(builder, root, "stream.sequence_parameters", "sequence_parameters", "group");
    if (!parameters) return;
    field(builder, parameters, "profile_idc", analysis.sps.profileIdc);
    field(builder, parameters, "profile", analysis.sps.profile);
    field(builder, parameters, "level", analysis.sps.level);
    field(builder, parameters, "coded_width", analysis.sps.width);
    field(builder, parameters, "coded_height", analysis.sps.height);
    field(builder, parameters, "chroma_format", analysis.sps.chromaFormat);
    field(builder, parameters, "bit_depth", analysis.sps.bitDepth);
    field(builder, parameters, "frame_mbs_only_flag", analysis.sps.frameMbsOnly);
    field(builder, parameters, "codec_string", analysis.sps.codec);
    if (analysis.sps.blockSize !== undefined) field(builder, parameters, "maximum_block_size", analysis.sps.blockSize);
  }
}

function addIvfHeader(builder: NodeBuilder, root: SyntaxNode, bytes: Uint8Array) {
  if (bytes.length < 32 || String.fromCharCode(...bytes.subarray(0, 4)) !== "DKIF") return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const container = addNode(builder, root, "stream.ivf_header", "ivf_header", "group", { source: source(0, 32) });
  if (!container) return;
  field(builder, container, "signature", "DKIF", source(0, 4));
  field(builder, container, "version", view.getUint16(4, true), source(4, 2));
  field(builder, container, "header_size", view.getUint16(6, true), source(6, 2));
  field(builder, container, "fourcc", String.fromCharCode(...bytes.subarray(8, 12)), source(8, 4));
  field(builder, container, "width", view.getUint16(12, true), source(12, 2));
  field(builder, container, "height", view.getUint16(14, true), source(14, 2));
  field(builder, container, "timebase_denominator", view.getUint32(16, true), source(16, 4));
  field(builder, container, "timebase_numerator", view.getUint32(20, true), source(20, 4));
  field(builder, container, "declared_frame_count", view.getUint32(24, true), source(24, 4));
}

function addUnit(builder: NodeBuilder, units: SyntaxNode, analysis: Analysis, unit: NalUnit) {
  const unitPath = `stream.units[${unit.index}]`;
  const unitNode = addNode(builder, units, unitPath, `${analysis.unitName.toLowerCase()}[${unit.index}]`, "unit", {
    value: unit.typeName,
    unitIndex: unit.index,
    source: source(unit.offset, unit.size),
  });
  if (!unitNode) return;
  const headerLength = unit.headerSize ?? (analysis.codecKind === "av1" ? 1 : analysis.codecKind === "h264" ? 1 : 2);
  const header = addNode(builder, unitNode, `${unitPath}.header`, "header", "group", {
    unitIndex: unit.index,
    source: source(unit.offset + unit.startCodeSize, headerLength),
  });
  if (header) {
    for (const [name, value] of Object.entries(unit.fields ?? {})) {
      field(builder, header, name, value, headerFieldRange(analysis.codecKind, unit, name));
    }
  }
  const syntax = addNode(builder, unitNode, `${unitPath}.syntax`, "parsed_syntax", "group", { unitIndex: unit.index });
  if (syntax) {
    if (unit.sliceType !== undefined) field(builder, syntax, "slice_type", unit.sliceType);
    if (unit.firstMb !== undefined) field(builder, syntax, "first_block_in_slice", unit.firstMb);
    if (unit.keyFrame !== undefined) field(builder, syntax, "key_frame", unit.keyFrame);
    if (unit.frameStart !== undefined) field(builder, syntax, "frame_start", unit.frameStart);
    if (unit.layerId !== undefined) field(builder, syntax, "layer_id", unit.layerId);
    if (unit.temporalId !== undefined) field(builder, syntax, "temporal_id", unit.temporalId);
    if (unit.sampleOffset !== undefined) field(builder, syntax, "sample_offset", unit.sampleOffset);
    if (unit.sampleSize !== undefined) field(builder, syntax, "sample_size", unit.sampleSize);
    if (unit.timestamp !== undefined) field(builder, syntax, "timestamp_us", unit.timestamp);
  }
  const payloadOffset = unit.offset + unit.startCodeSize + headerLength;
  addNode(builder, unitNode, `${unitPath}.payload`, "payload", "payload", {
    value: Math.max(0, unit.size - unit.startCodeSize - headerLength),
    description: unit.hex,
    unitIndex: unit.index,
    source: source(payloadOffset, Math.max(0, unit.offset + unit.size - payloadOffset)),
  });
}

export function buildSyntaxReport(analysis: Analysis, bytes: Uint8Array): SyntaxReport {
  const builder: NodeBuilder = { count: 0, truncated: false, index: [] };
  const root = addNode(builder, null, "stream", "bitstream", "stream", {
    value: analysis.codecName,
    source: source(0, bytes.length),
  });
  if (!root) throw new Error("Unable to allocate syntax-tree root");
  addSummary(builder, root, analysis);
  if (analysis.containerName === "IVF") addIvfHeader(builder, root, bytes);
  const units = addNode(builder, root, "stream.units", `${analysis.unitName.toLowerCase()}_units`, "group");
  if (units) {
    for (const unit of analysis.units) {
      if (builder.truncated) break;
      addUnit(builder, units, analysis, unit);
    }
  }
  return {
    root,
    searchIndex: builder.index,
    nodeCount: builder.count,
    truncated: builder.truncated,
  };
}

export function searchSyntaxTree(report: SyntaxReport, queryValue: string) {
  const query = queryValue.trim().slice(0, MAX_SYNTAX_QUERY_LENGTH).toLocaleLowerCase();
  if (!query) return [];
  const terms = query.split(/\s+/u).filter(Boolean).slice(0, 8);
  const results: SyntaxNode[] = [];
  for (const entry of report.searchIndex) {
    if (terms.every(term => entry.searchText.includes(term))) results.push(entry.node);
    if (results.length >= MAX_SYNTAX_SEARCH_RESULTS) break;
  }
  return results;
}
