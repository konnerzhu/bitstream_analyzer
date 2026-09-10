import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

async function loadConverter() {
  const output = await mkdtemp(join(tmpdir(), "bitscope-av1-block-test-"));
  execFileSync(resolve("node_modules/.bin/tsc"), ["app/av1-subblocks.ts", "--outDir", output, "--module", "commonjs", "--target", "es2022", "--noCheck"]);
  const require = createRequire(import.meta.url);
  return { converter: require(join(output, "av1-subblocks.js")), dispose: () => rm(output, { recursive: true, force: true }) };
}

const analysis = {
  codecKind: "av1",
  blockSize: 64,
  sps: { width: 32, height: 16 },
};

function frameFixture() {
  return {
    blockSizeMap: { BLOCK_16X16: 6, BLOCK_8X16: 4 },
    blockSize: [
      [6, 6, 6, 6, 4, 4, 4, 4],
      [6, 6, 6, 6, 4, 4, 4, 4],
      [6, 6, 6, 6, 4, 4, 4, 4],
      [6, 6, 6, 6, 4, 4, 4, 4],
    ],
    transformSizeMap: { TX_8X8: 1, TX_16X16: 2 },
    transformSize: Array.from({ length: 4 }, () => [2, 2, 2, 2, 1, 1, 1, 1]),
    modeMap: { DC_PRED: 0, D45_PRED: 3, PAETH_PRED: 12 },
    mode: Array.from({ length: 4 }, () => [0, 0, 0, 0, 12, 12, 3, 3]),
    skipMap: { NO_SKIP: 0, SKIP: 1 },
    skip: Array.from({ length: 4 }, () => [0, 0, 0, 0, 1, 1, 1, 1]),
    tileCols: [0, 4, 8],
    tileRows: [0, 4],
    frameType: 0,
    baseQIndex: 217,
  };
}

test("deduplicates AV1 MI maps into entropy-decoded leaf blocks", async () => {
  const parser = await loadConverter();
  try {
    const result = parser.converter.convertAv1InspectionFrame(frameFixture(), analysis);
    assert.equal(result.status, "ready");
    assert.equal(result.blocks.length, 3);
    assert.deepEqual(result.blocks.map(block => [block.x, block.y, block.width, block.height]), [
      [0, 0, 16, 16],
      [16, 0, 8, 16],
      [24, 0, 8, 16],
    ]);
    assert.equal(result.blocks[0].mode, "DC_PRED");
    assert.equal(result.blocks[1].mode, "PAETH_PRED");
    assert.equal(result.blocks[2].mode, "D45_PRED");
    assert.deepEqual(result.blocks[0].intraMode, { name: "DC", directional: false });
    assert.deepEqual(result.blocks[2].intraMode, { name: "Diagonal 45°", directional: true, nominalAngle: 45 });
    assert.equal(result.blocks[1].transformSize, "8X8");
    assert.equal(result.blocks[1].skipped, true);
    assert.equal(result.blocks[1].tileColumn, 1);
    assert.equal(result.baseQIndex, 217);
  } finally {
    await parser.dispose();
  }
});

test("classifies AV1 intra modes and preserves inter modes", async () => {
  const parser = await loadConverter();
  try {
    for (const [mode, angle] of [["D45_PRED", 45], ["D67_PRED", 67], ["V_PRED", 90], ["D113_PRED", 113], ["D135_PRED", 135], ["D157_PRED", 157], ["H_PRED", 180], ["D203_PRED", 203]]) {
      const info = parser.converter.getAv1IntraModeInfo(mode);
      assert.equal(info.directional, true);
      assert.equal(info.nominalAngle, angle);
    }
    for (const mode of ["DC_PRED", "SMOOTH_PRED", "SMOOTH_V_PRED", "SMOOTH_H_PRED", "PAETH_PRED", "CFL_PRED"]) {
      const info = parser.converter.getAv1IntraModeInfo(mode);
      assert.equal(info.directional, false);
      assert.equal(info.nominalAngle, undefined);
    }
    assert.equal(parser.converter.getAv1IntraModeInfo("NEARESTMV"), undefined);
  } finally {
    await parser.dispose();
  }
});

test("rejects inconsistent inspection matrix dimensions", async () => {
  const parser = await loadConverter();
  try {
    const frame = frameFixture();
    frame.skip = [[0]];
    assert.throws(() => parser.converter.convertAv1InspectionFrame(frame, analysis), /矩阵尺寸不一致/);
  } finally {
    await parser.dispose();
  }
});
