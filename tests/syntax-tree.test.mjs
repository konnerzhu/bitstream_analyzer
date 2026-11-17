import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const H264_FIXTURE = Buffer.from(
  "000000016742c01e8c8d405017bcb8080f08846a" +
  "0000000168ce3c80" +
  "0000000165b8000400001393120002167c985ca9",
  "hex",
);

const AV1_FRAME_OBU = Buffer.from([0x32, 0x01, 0x00]);

function makeIvf(samples, declaredFrameCount = samples.length) {
  const header = Buffer.alloc(32);
  header.write("DKIF", 0, "ascii");
  header.writeUInt16LE(32, 6);
  header.write("AV01", 8, "ascii");
  header.writeUInt16LE(16, 12);
  header.writeUInt16LE(16, 14);
  header.writeUInt32LE(30, 16);
  header.writeUInt32LE(1, 20);
  header.writeUInt32LE(declaredFrameCount, 24);
  const records = samples.map((sample, index) => {
    const record = Buffer.alloc(12 + sample.length);
    record.writeUInt32LE(sample.length, 0);
    record.writeBigUInt64LE(BigInt(index), 4);
    sample.copy(record, 12);
    return record;
  });
  return Buffer.concat([header, ...records]);
}

async function loadSyntaxAnalyzer() {
  const output = await mkdtemp(join(tmpdir(), "bitscope-syntax-tree-test-"));
  execFileSync(resolve("node_modules/.bin/tsc"), [
    "app/h264.ts", "app/codecs.ts", "app/syntax-tree.ts",
    "--outDir", output, "--module", "commonjs", "--target", "es2022", "--noCheck",
  ]);
  const require = createRequire(import.meta.url);
  return {
    codecs: require(join(output, "codecs.js")),
    syntax: require(join(output, "syntax-tree.js")),
    dispose: () => rm(output, { recursive: true, force: true }),
  };
}

test("builds and searches a source-linked H.264 syntax tree", async () => {
  const loaded = await loadSyntaxAnalyzer();
  try {
    const bytes = new Uint8Array(H264_FIXTURE);
    const analysis = loaded.codecs.analyzeBitstream(bytes, "sample.h264");
    const report = loaded.syntax.buildSyntaxReport(analysis, bytes);
    const typeMatches = loaded.syntax.searchSyntaxTree(report, "nal_unit_type 5");
    const ppsMatches = loaded.syntax.searchSyntaxTree(report, "pic_parameter_set_id");
    const offsetMatches = loaded.syntax.searchSyntaxTree(report, "0x0000001c");

    assert.equal(report.root.path, "stream");
    assert.ok(report.nodeCount > analysis.units.length);
    assert.equal(report.truncated, false);
    assert.ok(typeMatches.some(node => node.unitIndex === 2 && node.value === 5));
    assert.ok(ppsMatches.some(node => node.unitIndex === 2));
    assert.ok(offsetMatches.some(node => node.unitIndex === 2));
    assert.ok(typeMatches.every(node => node.source?.byteOffset >= 0));
  } finally {
    await loaded.dispose();
  }
});

test("keeps malformed header fields searchable without hiding the tree", async () => {
  const loaded = await loadSyntaxAnalyzer();
  try {
    const bytes = new Uint8Array(H264_FIXTURE);
    bytes[4] |= 0x80;
    const analysis = loaded.codecs.analyzeBitstream(bytes, "damaged.h264");
    analysis.units.splice(1, 1);
    const report = loaded.syntax.buildSyntaxReport(analysis, bytes);

    assert.ok(loaded.syntax.searchSyntaxTree(report, "forbidden_zero_bit 1").length > 0);
    assert.ok(loaded.syntax.searchSyntaxTree(report, "nal_unit_type 5").length > 0);
  } finally {
    await loaded.dispose();
  }
});

test("bounds syntax queries and returns a fixed maximum number of matches", async () => {
  const loaded = await loadSyntaxAnalyzer();
  try {
    const bytes = new Uint8Array(H264_FIXTURE);
    const analysis = loaded.codecs.analyzeBitstream(bytes, "sample.h264");
    const report = loaded.syntax.buildSyntaxReport(analysis, bytes);
    const oversizedQuery = "nal".padEnd(10_000, " ");
    const results = loaded.syntax.searchSyntaxTree(report, oversizedQuery);

    assert.ok(results.length <= loaded.syntax.MAX_SYNTAX_SEARCH_RESULTS);
  } finally {
    await loaded.dispose();
  }
});

test("keeps IVF declared and actual record counts as metadata, not conformance errors", async () => {
  const loaded = await loadSyntaxAnalyzer();
  try {
    const multiFrameSample = Buffer.concat([AV1_FRAME_OBU, AV1_FRAME_OBU]);
    const validBytes = new Uint8Array(makeIvf([multiFrameSample], 1));
    const validAnalysis = loaded.codecs.analyzeBitstream(validBytes, "layers.ivf");
    const validReport = loaded.syntax.buildSyntaxReport(validAnalysis, validBytes);

    assert.equal(validAnalysis.containerFrameCount, 1);
    assert.equal(validAnalysis.frameCount, 2);
    assert.ok(loaded.syntax.searchSyntaxTree(validReport, "frame_record_count 1").length > 0);

    const mismatchedBytes = new Uint8Array(makeIvf([AV1_FRAME_OBU, AV1_FRAME_OBU], 3));
    const mismatchedAnalysis = loaded.codecs.analyzeBitstream(mismatchedBytes, "stale-header.ivf");
    const mismatchedReport = loaded.syntax.buildSyntaxReport(mismatchedAnalysis, mismatchedBytes);

    assert.equal(mismatchedAnalysis.containerFrameCount, 2);
    assert.ok(loaded.syntax.searchSyntaxTree(mismatchedReport, "declared_frame_count 3").length > 0);
    assert.ok(loaded.syntax.searchSyntaxTree(mismatchedReport, "frame_record_count 2").length > 0);
  } finally {
    await loaded.dispose();
  }
});
