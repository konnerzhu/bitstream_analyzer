import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { decodeNativeFrame } = require("../desktop/native-runner.cjs");

// 32x32, one AV1 key frame plus one inter frame in IVF. Generated with FFmpeg/libaom-av1.
const IVF_FIXTURE = "REtJRgAAIABBVjAxIAAgAAEAAAABAAAAAgAAAAAAAAAkAAAAAAAAAAAAAAASAAoKAAAAAif+bXyAIDIUEADBAAACgAAAAuXXNjbWvSQQXKgVAAAAAQAAAAAAAAASADIRMAPAgAAABtAAAAKAACAAjHA=";

function commandAvailable(command, args) {
  const result = spawnSync(command, args, { stdio: "ignore" });
  return result.status === 0;
}

function extractIvfPayloads(ivf) {
  const payloads = [];
  const headerSize = ivf.readUInt16LE(6);
  let cursor = headerSize;
  while (cursor < ivf.length) {
    assert.ok(cursor + 12 <= ivf.length);
    const packetSize = ivf.readUInt32LE(cursor);
    const start = cursor + 12;
    assert.ok(start + packetSize <= ivf.length);
    payloads.push(ivf.subarray(start, start + packetSize));
    cursor = start + packetSize;
  }
  return Buffer.concat(payloads);
}

function decodeJsonLines(executable, input) {
  return execFileSync(executable, [input], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  }).trim().split("\n").map(line => JSON.parse(line));
}

const nativeToolchainAvailable =
  commandAvailable("cmake", ["--version"]) &&
  commandAvailable("pkg-config", ["--atleast-version=1.5.1", "dav1d"]);

test(
  "native dav1d adapter decodes IVF and low-overhead AV1 OBU streams",
  { skip: nativeToolchainAvailable ? false : "CMake and dav1d 1.5.1 development libraries are required" },
  async () => {
    const output = await mkdtemp(join(tmpdir(), "bitscope-av1-native-test-"));
    try {
      const build = join(output, "build");
      const ivfPath = join(output, "two-frames.ivf");
      const obuPath = join(output, "two-frames.obu");
      const invalidPath = join(output, "invalid.obu");
      const corruptIvfPath = join(output, "corrupt.ivf");
      const ivf = Buffer.from(IVF_FIXTURE, "base64");
      const corruptIvf = Buffer.from(ivf);
      corruptIvf.writeUInt32LE(0xffffffff, 32);
      await writeFile(ivfPath, ivf, { flag: "wx" });
      await writeFile(obuPath, extractIvfPayloads(ivf), { flag: "wx" });
      await writeFile(invalidPath, Buffer.from([0x80]), { flag: "wx" });
      await writeFile(corruptIvfPath, corruptIvf, { flag: "wx" });

      execFileSync("cmake", [
        "-S", resolve("native/av1-decoder"),
        "-B", build,
        "-DCMAKE_BUILD_TYPE=Release",
      ], { stdio: "pipe" });
      execFileSync("cmake", ["--build", build, "--parallel"], { stdio: "pipe" });

      const executable = join(build, "bitscope-av1-decode");
      for (const input of [ivfPath, obuPath]) {
        const records = decodeJsonLines(executable, input);
        const frames = records.filter(record => record.type === "frame");
        const summary = records.find(record => record.type === "summary");
        assert.equal(frames.length, 2);
        assert.deepEqual(frames.map(frame => [frame.width, frame.height]), [[32, 32], [32, 32]]);
        assert.equal(frames[0].keyFrame, true);
        assert.equal(frames[1].keyFrame, false);
        assert.ok(frames.every(frame => frame.bitDepth === 8 && frame.planes === 3));
        assert.equal(summary.frames, 2);
        assert.equal(summary.keyFrames, 1);
        assert.equal(summary.abiVersion, 1);
        assert.equal(summary.availableStages, 1);
      }

      const packedPath = join(output, "selected.planes");
      const selectedRecords = execFileSync(executable, ["--frame", "1", "--output", packedPath, ivfPath], {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      }).trim().split("\n").map(line => JSON.parse(line));
      const selected = selectedRecords.find(item => item.type === "selectedFrame");
      const packed = await readFile(packedPath);
      assert.equal(selected.index, 1);
      assert.equal(selected.bitDepth, 8);
      assert.equal(selected.byteLength, packed.byteLength);
      assert.equal(selected.planes.length, 3);

      process.env.BITSCOPE_AV1_DECODER = executable;
      try {
        const bridged = await decodeNativeFrame({ codec: "av1", frameIndex: 1, bytes: ivf }, {
          isPackaged: false, projectRoot: resolve("."), resourcesPath: "",
        });
        assert.equal(bridged.backend, "dav1d");
        assert.equal(bridged.index, 1);
        assert.equal(bridged.data.byteLength, selected.byteLength);
      } finally {
        delete process.env.BITSCOPE_AV1_DECODER;
      }

      assert.throws(
        () => execFileSync(executable, [invalidPath], { encoding: "utf8", stdio: "pipe" }),
        error => error.status === 4 && /not a valid low-overhead AV1 OBU stream/.test(error.stderr),
      );
      assert.throws(
        () => execFileSync(executable, [corruptIvfPath], { encoding: "utf8", stdio: "pipe" }),
        error => error.status === 4 && /payload exceeds the input boundary/.test(error.stderr),
      );
    } finally {
      await rm(output, { recursive: true, force: true });
    }
  },
);
