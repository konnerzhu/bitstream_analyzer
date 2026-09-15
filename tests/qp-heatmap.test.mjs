import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

async function loadHeatmap() {
  const output = await mkdtemp(join(tmpdir(), "bitscope-qp-heatmap-test-"));
  execFileSync(resolve("node_modules/.bin/tsc"), ["app/qp-heatmap.ts", "--outDir", output, "--module", "commonjs", "--target", "es2022", "--noCheck"]);
  const require = createRequire(import.meta.url);
  return { heatmap: require(join(output, "qp-heatmap.js")), dispose: () => rm(output, { recursive: true, force: true }) };
}

test("maps the fixed QP range from cool to warm colors", async () => {
  const loaded = await loadHeatmap();
  try {
    assert.equal(loaded.heatmap.qpHeatmapColor(0, 0, 51), "rgb(44, 123, 182)");
    assert.equal(loaded.heatmap.qpHeatmapColor(51, 0, 51), "rgb(215, 25, 28)");
    assert.equal(loaded.heatmap.qpHeatmapColor(-1, 0, 51), "rgb(44, 123, 182)");
    assert.equal(loaded.heatmap.qpHeatmapColor(256, 0, 255), "rgb(215, 25, 28)");
    assert.throws(() => loaded.heatmap.qpHeatmapColor(1, 5, 5), /Invalid QP heatmap range/);
  } finally {
    await loaded.dispose();
  }
});

test("summarizes only finite, in-range QP regions", async () => {
  const loaded = await loadHeatmap();
  try {
    const regions = [
      { x: 0, y: 0, width: 16, height: 16, value: 18 },
      { x: 16, y: 0, width: 16, height: 16, value: 31 },
      { x: 32, y: 0, width: 0, height: 16, value: 20 },
      { x: 48, y: 0, width: 16, height: 16, value: 52 },
    ];
    assert.deepEqual(loaded.heatmap.summarizeQpRegions(regions, 0, 51), { count: 2, minimum: 18, maximum: 31 });
    assert.equal(loaded.heatmap.summarizeQpRegions([], 0, 51), null);
  } finally {
    await loaded.dispose();
  }
});
