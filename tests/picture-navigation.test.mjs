import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

async function loadNavigation() {
  const output = await mkdtemp(join(tmpdir(), "bitscope-picture-navigation-test-"));
  execFileSync(resolve("node_modules/.bin/tsc"), ["app/picture-navigation.ts", "--outDir", output, "--module", "commonjs", "--target", "es2022", "--skipLibCheck"]);
  const require = createRequire(import.meta.url);
  return { navigation: require(join(output, "picture-navigation.js")), dispose: () => rm(output, { recursive: true, force: true }) };
}

test("clamps picture panning to the scaled image edges", async () => {
  const loaded = await loadNavigation();
  try {
    assert.deepEqual(loaded.navigation.clampPicturePan(800, 600, 800, 600, 2, { x: 900, y: -900 }), { x: 400, y: -300 });
    assert.deepEqual(loaded.navigation.clampPicturePan(800, 600, 400, 300, 1, { x: 20, y: 20 }), { x: 0, y: 0 });
  } finally {
    await loaded.dispose();
  }
});

test("keeps a click selectable until movement exceeds the pan threshold", async () => {
  const loaded = await loadNavigation();
  try {
    assert.equal(loaded.navigation.shouldStartPicturePan(2, 2), false);
    assert.equal(loaded.navigation.shouldStartPicturePan(3, 0), false);
    assert.equal(loaded.navigation.shouldStartPicturePan(4, 0), true);
  } finally {
    await loaded.dispose();
  }
});

test("keeps the anchored picture point fixed while zooming", async () => {
  const loaded = await loadNavigation();
  try {
    assert.deepEqual(loaded.navigation.zoomAroundPoint(1, 2, { x: 0, y: 0 }, { x: 100, y: -50 }), { zoom: 2, pan: { x: -100, y: 50 } });
  } finally {
    await loaded.dispose();
  }
});

test("maps pan and zoom to a bounded navigation viewport", async () => {
  const loaded = await loadNavigation();
  try {
    assert.deepEqual(loaded.navigation.navigationViewport(800, 600, 800, 600, 2, { x: 0, y: 0 }), { left: .25, top: .25, width: .5, height: .5 });
    assert.deepEqual(loaded.navigation.navigationViewport(800, 600, 800, 600, 2, { x: -400, y: -300 }), { left: .5, top: .5, width: .5, height: .5 });
  } finally {
    await loaded.dispose();
  }
});
