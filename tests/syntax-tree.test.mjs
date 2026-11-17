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
    assert.equal(report.diagnostics.filter(item => item.severity === "error").length, 0);
    assert.ok(report.diagnostics.some(item => item.ruleId === "H264-BASIC-COMPLIANCE"));
  } finally {
    await loaded.dispose();
  }
});

test("reports forbidden bits and missing parameter sets without hiding the tree", async () => {
  const loaded = await loadSyntaxAnalyzer();
  try {
    const bytes = new Uint8Array(H264_FIXTURE);
    bytes[4] |= 0x80;
    const analysis = loaded.codecs.analyzeBitstream(bytes, "damaged.h264");
    analysis.units.splice(1, 1);
    const report = loaded.syntax.buildSyntaxReport(analysis, bytes);
    const forbidden = report.diagnostics.find(item => item.ruleId === "H264-FORBIDDEN-ZERO-BIT");

    assert.equal(forbidden?.severity, "error");
    assert.equal(forbidden?.source?.byteOffset, 4);
    assert.ok(report.diagnostics.some(item => item.ruleId === "H264-MISSING-PPS"));
    assert.ok(loaded.syntax.searchSyntaxTree(report, "forbidden_zero_bit 1").length > 0);
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
