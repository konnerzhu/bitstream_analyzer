/* Dedicated, same-origin worker around the pinned libaom inspection build. */
/* global DecoderModule */
"use strict";

importScripts("/vendor/aom-inspector/inspect.js");

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_JSON_BYTES = 32 * 1024 * 1024;
const MAX_FRAME_INDEX = 10_000;
const INSPECTION_LAYERS = (1 << 1) | (1 << 2) | (1 << 4) | (1 << 5);

function fail(message) {
  self.postMessage({ ok: false, error: message });
}

self.onmessage = event => {
  const payload = event.data;
  if (!payload || !(payload.bytes instanceof ArrayBuffer)) {
    fail("AV1 inspection 输入无效");
    return;
  }
  if (payload.bytes.byteLength === 0 || payload.bytes.byteLength > MAX_FILE_BYTES) {
    fail("AV1 inspection 仅处理 1 byte–64 MB 的 IVF 文件");
    return;
  }
  if (!Number.isSafeInteger(payload.frameIndex) || payload.frameIndex < 0 || payload.frameIndex > MAX_FRAME_INDEX) {
    fail("AV1 inspection 帧序号超出安全范围");
    return;
  }

  const bytes = new Uint8Array(payload.bytes);
  if (bytes.length < 32 || bytes[0] !== 0x44 || bytes[1] !== 0x4b || bytes[2] !== 0x49 || bytes[3] !== 0x46) {
    fail("AV1 子块解析目前仅支持 IVF（DKIF）文件");
    return;
  }

  let nativeModule;
  let callbackIndex = 0;
  let completed = false;

  const complete = result => {
    if (completed) return;
    completed = true;
    self.postMessage(result);
  };

  try {
    nativeModule = DecoderModule({
      locateFile: name => `/vendor/aom-inspector/${name}`,
      noExitRuntime: true,
      noInitialRun: true,
      arguments: ["input.ivf", "output.raw"],
      print: () => {},
      printErr: () => {},
      onAbort: () => complete({ ok: false, error: "libaom inspection 已中止此码流" }),
      on_frame_decoded_json(pointer) {
        if (completed) return;
        const heap = nativeModule.HEAPU8;
        const limit = Math.min(heap.length, pointer + MAX_JSON_BYTES + 1);
        let end = pointer;
        while (end < limit && heap[end] !== 0) end += 1;
        if (end === limit) {
          complete({ ok: false, error: "AV1 子块结果超过 32 MB 安全上限" });
          return;
        }
        if (callbackIndex === payload.frameIndex) {
          try {
            let json = new TextDecoder("utf-8", { fatal: true }).decode(heap.subarray(pointer, end)).trim();
            if (json.endsWith(",")) json = json.slice(0, -1);
            complete({ ok: true, frame: JSON.parse(json) });
          } catch {
            complete({ ok: false, error: "libaom inspection 返回了无效数据" });
          }
        }
        callbackIndex += 1;
      },
      onRuntimeInitialized() {
        try {
          nativeModule.FS.writeFile("/tmp/input.ivf", bytes, { encoding: "binary" });
          nativeModule._set_compress(0);
          nativeModule._set_layers(INSPECTION_LAYERS);
          if (nativeModule._open_file() !== 0) {
            complete({ ok: false, error: "libaom 无法打开此 IVF 文件" });
            return;
          }
          for (let index = 0; index <= payload.frameIndex && !completed; index += 1) {
            if (nativeModule._read_frame() !== 0) {
              complete({ ok: false, error: `libaom 无法解码 IVF 帧 #${payload.frameIndex}` });
              break;
            }
          }
          if (!completed) complete({ ok: false, error: `IVF 中没有可检查的帧 #${payload.frameIndex}` });
        } catch {
          complete({ ok: false, error: "AV1 inspection 解码失败" });
        }
      },
    });
  } catch {
    complete({ ok: false, error: "无法启动 AV1 inspection 解码器" });
  }
};
