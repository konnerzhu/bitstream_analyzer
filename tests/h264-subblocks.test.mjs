import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

// 64x64, one IDR frame, Constrained Baseline/CAVLC. Generated with FFmpeg/libx264.
const FIXTURE = "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";

async function loadParser() {
  const output = await mkdtemp(join(tmpdir(), "bitscope-parser-test-"));
  execFileSync(resolve("node_modules/.bin/tsc"), ["app/h264.ts", "app/h264-subblocks.ts", "--outDir", output, "--module", "commonjs", "--target", "es2022", "--skipLibCheck"]);
  const require = createRequire(import.meta.url);
  return { h264: require(join(output, "h264.js")), subblocks: require(join(output, "h264-subblocks.js")), dispose: () => rm(output, { recursive: true, force: true }) };
}

test("parses every macroblock in a CAVLC IDR picture", async () => {
  const parser = await loadParser();
  try {
    const bytes = new Uint8Array(Buffer.from(FIXTURE, "base64"));
    const analysis = parser.h264.analyzeH264(bytes);
    const frame = analysis.units.find(unit => unit.frameStart);
    const result = parser.subblocks.analyzeH264Subblocks(bytes, analysis, frame.index);

    assert.equal(result.status, "parsed");
    assert.equal(result.entropyMode, "CAVLC");
    assert.equal(result.parsedCount, 16);
    assert.equal(result.macroblocks.length, 16);
    assert.ok(result.macroblocks.every(macroblock => macroblock?.typeName.startsWith("I_")));
    assert.ok(result.macroblocks.every(macroblock => macroblock.partitions.length >= 1));
  } finally {
    await parser.dispose();
  }
});

