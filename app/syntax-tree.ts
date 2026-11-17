import type { Analysis, CodecKind, NalUnit } from "./h264";

export const MAX_SYNTAX_NODES = 250_000;
export const MAX_SYNTAX_SEARCH_RESULTS = 500;
export const MAX_SYNTAX_QUERY_LENGTH = 256;
export const MAX_COMPLIANCE_DIAGNOSTICS = 10_000;

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

export type ComplianceSeverity = "error" | "warning" | "info";

export type ComplianceDiagnostic = {
  id: string;
  ruleId: string;
  severity: ComplianceSeverity;
  message: string;
  messageZh: string;
  nodeId?: string;
  unitIndex?: number;
  source?: SyntaxSourceRange;
};

export type SyntaxSearchEntry = {
  node: SyntaxNode;
  searchText: string;
};

export type SyntaxReport = {
  root: SyntaxNode;
  diagnostics: ComplianceDiagnostic[];
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

function nodeForUnitField(reportRoot: SyntaxNode, unitIndex: number, fieldName: string) {
  return `syntax:${reportRoot.path}.units[${unitIndex}].header.${fieldName}`;
}

function diagnostic(
  diagnostics: ComplianceDiagnostic[],
  ruleId: string,
  severity: ComplianceSeverity,
  message: string,
  messageZh: string,
  options: Pick<ComplianceDiagnostic, "nodeId" | "unitIndex" | "source"> = {},
) {
  if (diagnostics.length >= MAX_COMPLIANCE_DIAGNOSTICS) return;
  diagnostics.push({ id: `diagnostic:${diagnostics.length}`, ruleId, severity, message, messageZh, ...options });
}

function parameterSetRules(codec: CodecKind) {
  if (codec === "h264") return [{ type: 7, name: "SPS" }, { type: 8, name: "PPS" }];
  if (codec === "h265") return [{ type: 32, name: "VPS" }, { type: 33, name: "SPS" }, { type: 34, name: "PPS" }];
  if (codec === "h266") return [{ type: 14, name: "VPS" }, { type: 15, name: "SPS" }, { type: 16, name: "PPS" }];
  return [{ type: 1, name: "Sequence Header" }];
}

function buildDiagnostics(analysis: Analysis, bytes: Uint8Array, root: SyntaxNode, truncated: boolean) {
  const diagnostics: ComplianceDiagnostic[] = [];
  const required = parameterSetRules(analysis.codecKind);
  for (const parameter of required) {
    if (!analysis.units.some(unit => unit.type === parameter.type)) {
      diagnostic(diagnostics, `${analysis.codecKind.toUpperCase()}-MISSING-${parameter.name.replaceAll(" ", "-").toUpperCase()}`, "error",
        `Required ${parameter.name} syntax is missing.`, `缺少必需的 ${parameter.name} 语法。`);
    }
  }
  if (!analysis.units.some(unit => unit.frameStart)) {
    diagnostic(diagnostics, `${analysis.codecKind.toUpperCase()}-NO-FRAME`, "warning",
      "No complete frame start was identified.", "未识别到完整的帧起始位置。");
  }
  if (analysis.sps && (analysis.sps.width <= 0 || analysis.sps.height <= 0)) {
    diagnostic(diagnostics, `${analysis.codecKind.toUpperCase()}-INVALID-DIMENSIONS`, "error",
      "The coded dimensions must both be positive.", "编码宽度和高度必须均为正数。");
  }
  if (analysis.declaredFrameCount !== undefined && analysis.declaredFrameCount !== analysis.frameCount) {
    diagnostic(diagnostics, "IVF-FRAME-COUNT-MISMATCH", "warning",
      `IVF declares ${analysis.declaredFrameCount} frames but ${analysis.frameCount} frame OBUs were found.`,
      `IVF 声明 ${analysis.declaredFrameCount} 帧，但实际找到 ${analysis.frameCount} 个帧 OBU。`, {
        nodeId: "syntax:stream.ivf_header.declared_frame_count",
        source: bytes.length >= 28 ? source(24, 4) : undefined,
      });
  }

  let previousEnd = 0;
  for (const unit of analysis.units) {
    const fields = unit.fields ?? {};
    const unitSource = source(unit.offset, unit.size);
    if (unit.offset < previousEnd || unit.offset < 0 || unit.size <= 0 || unit.offset + unit.size > bytes.length) {
      diagnostic(diagnostics, "STREAM-UNIT-RANGE", "error",
        `${analysis.unitName} #${unit.index} has an invalid or overlapping byte range.`,
        `${analysis.unitName} #${unit.index} 的字节范围无效或与前一单元重叠。`, { unitIndex: unit.index, source: unitSource });
    }
    previousEnd = Math.max(previousEnd, unit.offset + unit.size);

    const forbiddenName = analysis.codecKind === "av1" ? "obu_forbidden_bit" : "forbidden_zero_bit";
    if (fields[forbiddenName] !== undefined && Number(fields[forbiddenName]) !== 0) {
      diagnostic(diagnostics, `${analysis.codecKind.toUpperCase()}-FORBIDDEN-ZERO-BIT`, "error",
        `${forbiddenName} must be zero.`, `${forbiddenName} 必须为零。`, {
          nodeId: nodeForUnitField(root, unit.index, forbiddenName), unitIndex: unit.index,
          source: headerFieldRange(analysis.codecKind, unit, forbiddenName),
        });
    }
    if (analysis.codecKind === "h266" && Number(fields.nuh_reserved_zero_bit ?? 0) !== 0) {
      diagnostic(diagnostics, "VVC-RESERVED-ZERO-BIT", "error",
        "nuh_reserved_zero_bit must be zero.", "nuh_reserved_zero_bit 必须为零。", {
          nodeId: nodeForUnitField(root, unit.index, "nuh_reserved_zero_bit"), unitIndex: unit.index,
          source: headerFieldRange("h266", unit, "nuh_reserved_zero_bit"),
        });
    }
    if ((analysis.codecKind === "h265" || analysis.codecKind === "h266") && Number(fields.nuh_temporal_id_plus1 ?? 1) === 0) {
      diagnostic(diagnostics, `${analysis.codecKind.toUpperCase()}-TEMPORAL-ID-ZERO`, "error",
        "nuh_temporal_id_plus1 must not be zero.", "nuh_temporal_id_plus1 不得为零。", {
          nodeId: nodeForUnitField(root, unit.index, "nuh_temporal_id_plus1"), unitIndex: unit.index,
          source: headerFieldRange(analysis.codecKind, unit, "nuh_temporal_id_plus1"),
        });
    }
    if (analysis.codecKind === "av1") {
      for (const reservedName of ["obu_reserved_1bit", "extension_header_reserved_3bits"]) {
        if (Number(fields[reservedName] ?? 0) !== 0) {
          diagnostic(diagnostics, `AV1-${reservedName.toUpperCase()}`, "error",
            `${reservedName} must be zero.`, `${reservedName} 必须为零。`, {
              nodeId: nodeForUnitField(root, unit.index, reservedName), unitIndex: unit.index,
              source: headerFieldRange("av1", unit, reservedName),
            });
        }
      }
    }
    if (analysis.codecKind === "h264") {
      const refIdc = Number(fields.nal_ref_idc ?? unit.refIdc);
      if ([6, 9, 10, 11, 12].includes(unit.type) && refIdc !== 0) {
        diagnostic(diagnostics, "H264-NON-VCL-NAL-REF-IDC", "warning",
          `nal_ref_idc should be zero for NAL unit type ${unit.type}.`,
          `NAL 单元类型 ${unit.type} 的 nal_ref_idc 应为零。`, {
            nodeId: nodeForUnitField(root, unit.index, "nal_ref_idc"), unitIndex: unit.index,
            source: headerFieldRange("h264", unit, "nal_ref_idc"),
          });
      }
      if (unit.type === 5 && refIdc === 0) {
        diagnostic(diagnostics, "H264-IDR-NAL-REF-IDC", "error",
          "An IDR slice must have a non-zero nal_ref_idc.", "IDR 切片的 nal_ref_idc 必须非零。", {
            nodeId: nodeForUnitField(root, unit.index, "nal_ref_idc"), unitIndex: unit.index,
            source: headerFieldRange("h264", unit, "nal_ref_idc"),
          });
      }
    }
    const reserved = /reserved|保留/i.test(unit.typeName);
    if (reserved) {
      diagnostic(diagnostics, `${analysis.codecKind.toUpperCase()}-RESERVED-UNIT-TYPE`, "warning",
        `${analysis.unitName} #${unit.index} uses reserved type ${unit.type}.`,
        `${analysis.unitName} #${unit.index} 使用了保留类型 ${unit.type}。`, { unitIndex: unit.index, source: unitSource });
    }
  }
  if (truncated) {
    diagnostic(diagnostics, "ANALYZER-SYNTAX-NODE-LIMIT", "warning",
      `The syntax tree reached its ${MAX_SYNTAX_NODES.toLocaleString("en-US")} node safety limit; search results are incomplete.`,
      `语法树达到 ${MAX_SYNTAX_NODES.toLocaleString("zh-CN")} 个节点的安全上限，搜索结果不完整。`);
  }
  if (!diagnostics.some(item => item.severity === "error" || item.severity === "warning")) {
    diagnostic(diagnostics, `${analysis.codecKind.toUpperCase()}-BASIC-COMPLIANCE`, "info",
      "No violations were found by the implemented structural and header checks.",
      "当前已实现的结构与头部检查未发现违规项。");
  }
  return diagnostics;
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
    diagnostics: buildDiagnostics(analysis, bytes, root, builder.truncated),
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
