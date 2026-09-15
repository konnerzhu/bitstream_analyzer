import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

async function loadCodecs() {
  const output = await mkdtemp(join(tmpdir(), "bitscope-codec-detection-test-"));
  execFileSync(resolve("node_modules/.bin/tsc"), ["app/h264.ts", "app/codecs.ts", "--outDir", output, "--module", "commonjs", "--target", "es2022", "--noCheck"]);
  const require = createRequire(import.meta.url);
  return { codecs: require(join(output, "codecs.js")), dispose: () => rm(output, { recursive: true, force: true }) };
}

test("detects an Annex-B H.264 decoder dump with a generic .data extension", async () => {
  const loaded = await loadCodecs();
  try {
    // SPS/PPS/IDR prefix from a decoder-facing Annex-B dump. The generic extension
    // is accepted, but codec selection still comes from validated stream structure.
    const bytes = new Uint8Array(Buffer.from(
      "000000016742c01e8c8d405017bcb8080f08846a" +
      "0000000168ce3c80" +
      "0000000165b8000400001393120002167c985ca9",
      "hex",
    ));
    const analysis = loaded.codecs.analyzeBitstream(bytes, "NALToDecoder_dump.data");

    assert.equal(analysis.codecKind, "h264");
    assert.equal(analysis.codecName, "H.264 / AVC");
    assert.equal(analysis.units.length, 3);
    assert.equal(analysis.frameCount, 1);
    assert.equal(analysis.idrCount, 1);
    assert.equal(analysis.sps?.width, 640);
    assert.equal(analysis.sps?.height, 360);
  } finally {
    await loaded.dispose();
  }
});
