"use strict";

const { execFile } = require("node:child_process");
const { constants } = require("node:fs");
const { access, mkdtemp, readFile, rm, stat, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { promisify } = require("node:util");

const executeFile = promisify(execFile);
const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_FRAME_INDEX = 10_000;
const DECODE_TIMEOUT_MS = 30_000;

function requestBytes(value) {
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new Error("Native decode request has no valid byte buffer");
}

function validateRequest(request) {
  if (!request || typeof request !== "object" || (request.codec !== "h264" && request.codec !== "av1")) {
    throw new Error("Native decode request has an unsupported codec");
  }
  if (!Number.isSafeInteger(request.frameIndex) || request.frameIndex < 0 || request.frameIndex > MAX_FRAME_INDEX) {
    throw new Error("Native decode request has an invalid frame index");
  }
  const bytes = requestBytes(request.bytes);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_INPUT_BYTES) {
    throw new Error("Native decode input must be between 1 byte and 64 MiB");
  }
  return { codec: request.codec, frameIndex: request.frameIndex, bytes };
}

function executableFor(codec, options) {
  const environmentPath = codec === "h264" ? process.env.BITSCOPE_H264_DECODER : process.env.BITSCOPE_AV1_DECODER;
  if (environmentPath) return environmentPath;
  if (options.isPackaged) {
    return join(options.resourcesPath, "native", codec === "h264" ? "bitscope-h264-inspect" : "bitscope-av1-decode");
  }
  return join(options.projectRoot, "build", codec === "h264" ? "h264-inspector" : "av1-decoder", codec === "h264" ? "bitscope-h264-inspect" : "bitscope-av1-decode");
}

function parseSelectedFrame(stdout) {
  const lines = stdout.split("\n").filter(Boolean);
  if (lines.length > MAX_FRAME_INDEX + 2) throw new Error("Native decoder returned too many records");
  for (const line of lines) {
    if (line.length > 64 * 1024) throw new Error("Native decoder returned an oversized record");
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      throw new Error("Native decoder returned malformed metadata");
    }
    if (record && record.type === "selectedFrame") return record;
  }
  throw new Error("Native decoder did not return the selected frame");
}

async function decodeNativeFrame(requestValue, options) {
  const request = validateRequest(requestValue);
  const executable = executableFor(request.codec, options);
  await access(executable, constants.X_OK).catch(() => {
    throw new Error(`Native ${request.codec.toUpperCase()} decoder is not built`);
  });

  const directory = await mkdtemp(join(tmpdir(), "bitscope-native-"));
  const inputPath = join(directory, request.codec === "h264" ? "input.h264" : "input.ivf");
  const outputPath = join(directory, "frame.planes");
  try {
    await writeFile(inputPath, request.bytes, { flag: "wx", mode: 0o600 });
    let stdout;
    try {
      ({ stdout } = await executeFile(executable, [
        "--frame", String(request.frameIndex), "--output", outputPath, inputPath,
      ], {
        encoding: "utf8",
        timeout: DECODE_TIMEOUT_MS,
        killSignal: "SIGKILL",
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      }));
    } catch (error) {
      const detail = typeof error?.stderr === "string" ? error.stderr.trim().slice(0, 512) : "";
      throw new Error(detail || "Native decoder process failed");
    }
    const metadata = parseSelectedFrame(stdout);
    const outputStat = await stat(outputPath);
    if (outputStat.size <= 0 || outputStat.size > MAX_OUTPUT_BYTES || outputStat.size !== metadata.byteLength) {
      throw new Error("Native decoder pixel output has an invalid size");
    }
    const output = await readFile(outputPath);
    return {
      ...metadata,
      backend: request.codec === "h264" ? "FFmpeg" : "dav1d",
      data: new Uint8Array(output.buffer, output.byteOffset, output.byteLength),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

module.exports = {
  DECODE_TIMEOUT_MS,
  MAX_FRAME_INDEX,
  MAX_INPUT_BYTES,
  MAX_OUTPUT_BYTES,
  decodeNativeFrame,
  parseSelectedFrame,
  validateRequest,
};
