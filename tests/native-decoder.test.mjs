import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);

async function loadNativeDecoder() {
  const output = await mkdtemp(join(tmpdir(), "bitscope-native-decoder-test-"));
  execFileSync(resolve("node_modules/.bin/tsc"), [
    "app/native-decoder.ts", "--outDir", output, "--module", "commonjs", "--target", "es2022", "--skipLibCheck",
  ]);
  return { decoder: require(join(output, "native-decoder.js")), dispose: () => rm(output, { recursive: true, force: true }) };
}

function twoByTwoFrame() {
  return {
    backend: "dav1d",
    index: 0,
    width: 2,
    height: 2,
    renderWidth: 2,
    renderHeight: 2,
    pixelLayout: 1,
    bitDepth: 8,
    fullRange: false,
    matrixCoefficients: 1,
    littleEndian: true,
    planes: [
      { offset: 0, length: 4, rowBytes: 2, width: 2, height: 2 },
      { offset: 4, length: 1, rowBytes: 1, width: 1, height: 1 },
      { offset: 5, length: 1, rowBytes: 1, width: 1, height: 1 },
    ],
    data: new Uint8Array([16, 235, 16, 235, 128, 128]),
  };
}

test("validates packed native frames and converts planar YUV to opaque RGBA", async () => {
  const loaded = await loadNativeDecoder();
  try {
    const frame = loaded.decoder.validateNativeFrame(twoByTwoFrame());
    const rgba = loaded.decoder.nativeFrameToRgba(frame);
    assert.deepEqual([...rgba], [0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
    assert.throws(
      () => loaded.decoder.validateNativeFrame({ ...twoByTwoFrame(), planes: [{ offset: 0, length: 4, rowBytes: 4, width: 2, height: 2 }] }),
      /unexpected plane count|bounds/,
    );
  } finally {
    await loaded.dispose();
  }
});
