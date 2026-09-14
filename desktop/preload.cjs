"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bitscopeNative", Object.freeze({
  decodeFrame(request) {
    if (!request || (request.codec !== "h264" && request.codec !== "av1") ||
        !Number.isSafeInteger(request.frameIndex) || !(request.bytes instanceof ArrayBuffer)) {
      return Promise.reject(new Error("Invalid native decode request"));
    }
    return ipcRenderer.invoke("bitscope:decode-frame", {
      codec: request.codec,
      frameIndex: request.frameIndex,
      bytes: request.bytes,
    });
  },
}));
