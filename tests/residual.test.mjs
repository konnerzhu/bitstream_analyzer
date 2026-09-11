import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

async function loadResidual() {
  const output = await mkdtemp(join(tmpdir(), "bitscope-residual-test-"));
  execFileSync(resolve("node_modules/.bin/tsc"), ["app/residual.ts", "--outDir", output, "--module", "commonjs", "--target", "es2022", "--skipLibCheck"]);
  const require = createRequire(import.meta.url);
  return { residual: require(join(output, "residual.js")), dispose: () => rm(output, { recursive: true, force: true }) };
}

function gray(values) {
  return new Uint8ClampedArray(values.flatMap(value => [value, value, value, 255]));
}

test("renders motion-compensated inter residual around neutral gray", async () => {
  const loaded = await loadResidual();
  try {
    const previous = gray([10, 20, 30, 40]);
    const current = gray([20, 30, 40, 50]);
    const result = loaded.residual.buildResidualImage(current, previous, 2, 2, [
      { kind: "inter", x: 0, y: 0, width: 2, height: 2, mvX: 0, mvY: 0, unitsPerPixel: 4 },
    ], 2);
    assert.deepEqual([...result.pixels], [...gray([148, 148, 148, 148])]);
    assert.equal(result.interPixels, 4);
    assert.equal(result.coveredPixels, 4);
  } finally {
    await loaded.dispose();
  }
});

test("uses neutral gray for uncovered pixels and DC prediction for intra regions", async () => {
  const loaded = await loadResidual();
  try {
    const current = gray([100, 100, 100, 110, 130, 140, 120, 150, 160]);
    const result = loaded.residual.buildResidualImage(current, null, 3, 3, [
      { kind: "intra", x: 1, y: 1, width: 2, height: 2 },
    ], 1);
    assert.equal(result.pixels[0], 128);
    assert.deepEqual([result.pixels[16], result.pixels[20], result.pixels[28], result.pixels[32]], [150, 160, 170, 180]);
    assert.equal(result.intraPixels, 4);
    assert.equal(result.coveredPixels, 4);
  } finally {
    await loaded.dispose();
  }
});

test("rejects oversized pictures before allocating the output", async () => {
  const loaded = await loadResidual();
  try {
    assert.throws(() => loaded.residual.buildResidualImage(new Uint8ClampedArray(), null, 4096, 4096, []), /safe pixel limit/);
  } finally {
    await loaded.dispose();
  }
});
