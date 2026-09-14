import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { decodeNativeFrame } = require("../desktop/native-runner.cjs");

function commandAvailable(command, args) {
  const result = spawnSync(command, args, { stdio: "ignore" });
  return result.status === 0;
}

const nativeToolchainAvailable =
  commandAvailable("cmake", ["--version"]) &&
  commandAvailable("pkg-config", ["--exists", "libavcodec", "libavutil"]);

async function loadPFrameFixture() {
  const source = await readFile(resolve("tests/h264-subblocks.test.mjs"), "utf8");
  const match = source.match(/const P_FIXTURE = "([A-Za-z0-9+/=]+)";/);
  assert.ok(match, "the shared two-frame H.264 fixture must exist");
  return Buffer.from(match[1], "base64");
}

test(
  "native H.264 adapter decodes frames and exports decoder motion vectors",
  { skip: nativeToolchainAvailable ? false : "CMake and FFmpeg development libraries are required" },
  async () => {
    const output = await mkdtemp(join(tmpdir(), "bitscope-h264-native-test-"));
    try {
      const build = join(output, "build");
      const fixture = join(output, "two-frames.h264");
      const invalid = join(output, "invalid.h264");
      await writeFile(fixture, await loadPFrameFixture(), { flag: "wx" });
      await writeFile(invalid, Buffer.from("not an Annex-B stream"), { flag: "wx" });

      const configureArguments = [
        "-S", resolve("native/h264-inspector"),
        "-B", build,
        "-DCMAKE_BUILD_TYPE=Release",
      ];
      if (process.env.BITSCOPE_NATIVE_SANITIZERS === "1") {
        configureArguments.push("-DBITSCOPE_ENABLE_SANITIZERS=ON");
      }
      execFileSync("cmake", configureArguments, { stdio: "pipe" });
      execFileSync("cmake", ["--build", build, "--parallel"], { stdio: "pipe" });

      const executable = join(build, "bitscope-h264-inspect");
      const outputLines = execFileSync(executable, [fixture], {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      }).trim().split("\n").map(line => JSON.parse(line));
      const frames = outputLines.filter(item => item.type === "frame");
      const summary = outputLines.find(item => item.type === "summary");

      assert.equal(frames.length, 2);
      assert.deepEqual(frames.map(frame => [frame.width, frame.height]), [[32, 32], [32, 32]]);
      assert.equal(frames[0].keyFrame, true);
      assert.equal(frames[1].keyFrame, false);
      assert.ok(frames[1].motionVectors > 0);
      assert.equal(summary.frames, 2);
      assert.ok(summary.motionVectors > 0);
      assert.equal(summary.abiVersion, 2);
      assert.equal(summary.availableStages, 3);

      const packedPath = join(output, "selected.planes");
      const selectedRecords = execFileSync(executable, ["--frame", "1", "--output", packedPath, fixture], {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      }).trim().split("\n").map(line => JSON.parse(line));
      const selected = selectedRecords.find(item => item.type === "selectedFrame");
      const packed = await readFile(packedPath);
      assert.equal(selected.index, 1);
      assert.equal(selected.bitDepth, 8);
      assert.equal(selected.byteLength, packed.byteLength);
      assert.equal(selected.planes.length, 3);

      process.env.BITSCOPE_H264_DECODER = executable;
      try {
        const bridged = await decodeNativeFrame({ codec: "h264", frameIndex: 1, bytes: await loadPFrameFixture() }, {
          isPackaged: false, projectRoot: resolve("."), resourcesPath: "",
        });
        assert.equal(bridged.backend, "FFmpeg");
        assert.equal(bridged.index, 1);
        assert.equal(bridged.data.byteLength, selected.byteLength);
      } finally {
        delete process.env.BITSCOPE_H264_DECODER;
      }

      assert.throws(
        () => execFileSync(executable, [invalid], { encoding: "utf8", stdio: "pipe" }),
        error => error.status === 4 && /not an H\.264 Annex-B stream/.test(error.stderr),
      );
    } finally {
      await rm(output, { recursive: true, force: true });
    }
  },
);
