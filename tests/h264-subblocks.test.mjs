import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

// 64x64, one IDR frame, Constrained Baseline/CAVLC. Generated with FFmpeg/libx264.
const FIXTURE = "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";

// 32x32, one IDR plus one CAVLC P frame. Generated with FFmpeg/libx264.
const P_FIXTURE = "AAAAAWdCwArZCWwEQAAAAwBAAAADAQPEiZIAAAABaMuDyyAAAAEGBf//a9xF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjQgcjMxMDggMzFlMTlmOSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjMgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0wIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDE6MHgxMTEgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMiBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTAgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0xIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MCB3ZWlnaHRwPTAga2V5aW50PTMwIGtleWludF9taW49MTYgc2NlbmVjdXQ9MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTMwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAAWWIhF8QiKgDAhD8BCjZgAPWoMMAB4XpxeQyl4ak7/8BwQwUyDiAQDMvNSMSKbljrg3EvGXMSPh/I//Bag2SR9mPs5Bn/2Co2+p2wSyj/913DUMIhfn8er11OGPyPKSer0gA8hGTFAX39/7QOOz6uDdf98CAAEAYAMBxsIIDiBAADfG5pSEHw45bsYc16A7eLGSNuIA5W//0cAriG1iNIANxcKNNY6ZIZXVsPBpuCH0zdQJ1SM/vYwcpKosk3G/3YmAj7XanKkAAQNWQDRQyCurV4xaCuQlmtuUzIYYHEAgGZQAmLwzoxoVB/I//WoexwRTVjZHq8CmaYSkOQVB6vWBvkE6IN0+/75whiahK0IOoB9WeJCQr59aLLNB0MeRv9OCGLnJUpB1UGlxUw2lR/bBEAAQHBAADgoDh8jIBeRzGAaZvXCJregZjYCZTFJiASotv77A0xXL2BamXfvu6CJ7cojctPHjWDWq3wOlklgzQ0W1Q8xX/rgnUjNY5nliQAMcIfho9gEiD+eADxAAEABogABoAAQF5CBluPlgOgZbh5YIAAOGAANcEIBsBwADhgADXByAbEeA/+g0U8AAQHf/ngAE+IAAUAAEGqIBFkkrgsLBRK4eFggEw9wQAEAIwHBMPcHABACMQAAAAAUGaOE/jYuANFDIKRWon8OC6+8Aq2jSr81b9fCAAPgONVCCyGAAkhbOzHBXPHqyq9P6POhz4s1J4ySWfAAU0QPRAV1siBzb2peK8jf8kFQeJ";

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
    assert.ok(result.macroblocks.every(macroblock => macroblock.intraModes?.length >= 1));
    assert.ok(result.macroblocks.flatMap(macroblock => macroblock.intraModes).every(mode => mode.mode >= 0 && mode.mode <= 8));
  } finally {
    await parser.dispose();
  }
});

test("reconstructs final H.264 list-0 motion vectors for a CAVLC P picture", async () => {
  const parser = await loadParser();
  try {
    const bytes = new Uint8Array(Buffer.from(P_FIXTURE, "base64"));
    const analysis = parser.h264.analyzeH264(bytes);
    const frames = analysis.units.filter(unit => unit.frameStart);
    const result = parser.subblocks.analyzeH264Subblocks(bytes, analysis, frames[1].index);
    const vectors = result.macroblocks.flatMap(macroblock => macroblock?.motionVectors ?? []);

    assert.equal(result.status, "parsed");
    assert.equal(result.parsedCount, 4);
    assert.equal(vectors.length, 4);
    assert.ok(vectors.every(vector => vector.reference === 0));
    assert.ok(vectors.every(vector => Number.isSafeInteger(vector.mvX) && Number.isSafeInteger(vector.mvY)));
    assert.ok(vectors.every(vector => vector.width >= 4 && vector.height >= 4));
  } finally {
    await parser.dispose();
  }
});

test("maps H.264 intra modes to their nominal direction paths", async () => {
  const parser = await loadParser();
  try {
    const expected4x4 = [
      [0, "Vertical", 90],
      [1, "Horizontal", 0],
      [2, "DC", undefined],
      [3, "Diagonal down-left", 135],
      [4, "Diagonal down-right", 45],
      [5, "Vertical-right", 67.5],
      [6, "Horizontal-down", 22.5],
      [7, "Vertical-left", 112.5],
      [8, "Horizontal-up", 337.5],
    ];
    for (const [mode, name, angle] of expected4x4) {
      const info = parser.subblocks.getH264IntraModeInfo(mode, 4);
      assert.equal(info.name, name);
      assert.equal(info.directional, angle !== undefined);
      assert.equal(info.angle, angle);
    }

    assert.deepEqual(parser.subblocks.getH264IntraModeInfo(0, 16), { name: "Vertical", directional: true, angle: 90 });
    assert.deepEqual(parser.subblocks.getH264IntraModeInfo(1, 16), { name: "Horizontal", directional: true, angle: 0 });
    assert.deepEqual(parser.subblocks.getH264IntraModeInfo(2, 16), { name: "DC", directional: false });
    assert.deepEqual(parser.subblocks.getH264IntraModeInfo(3, 16), { name: "Plane", directional: false });
    assert.equal(parser.subblocks.getH264IntraModeInfo(9, 4), undefined);
  } finally {
    await parser.dispose();
  }
});

test("reconstructs H.264 rem_intra_pred_mode around the predicted mode", async () => {
  const parser = await loadParser();
  try {
    assert.equal(parser.subblocks.decodeH264IntraMode(5, true), 5);
    assert.equal(parser.subblocks.decodeH264IntraMode(5, false, 4), 4);
    assert.equal(parser.subblocks.decodeH264IntraMode(5, false, 5), 6);
    assert.equal(parser.subblocks.decodeH264IntraMode(0, false, 7), 8);
    assert.throws(() => parser.subblocks.decodeH264IntraMode(9, true), /无效预测帧内模式/);
    assert.throws(() => parser.subblocks.decodeH264IntraMode(2, false, 8), /无效 rem_intra_pred_mode/);
  } finally {
    await parser.dispose();
  }
});
