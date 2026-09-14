export const MAX_NATIVE_INPUT_BYTES = 64 * 1024 * 1024;
export const MAX_NATIVE_FRAME_PIXELS = 4096 * 2160;
export const MAX_NATIVE_PLANE_BYTES = 64 * 1024 * 1024;

export type NativeCodec = "h264" | "av1";

export type NativePlane = {
  offset: number;
  length: number;
  rowBytes: number;
  width: number;
  height: number;
};

export type NativeDecodedFrame = {
  backend: "FFmpeg" | "dav1d";
  index: number;
  width: number;
  height: number;
  renderWidth: number;
  renderHeight: number;
  pixelLayout: 0 | 1 | 2 | 3;
  bitDepth: number;
  fullRange: boolean;
  matrixCoefficients: number;
  littleEndian: boolean;
  planes: NativePlane[];
  data: Uint8Array;
};

type NativeDecoderBridge = {
  decodeFrame(request: { codec: NativeCodec; frameIndex: number; bytes: ArrayBuffer }): Promise<unknown>;
};

declare global {
  interface Window {
    bitscopeNative?: NativeDecoderBridge;
  }
}

function integer(value: unknown, minimum: number, maximum: number, name: string) {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`Native decoder returned an invalid ${name}`);
  }
  return value as number;
}

function byteArray(value: unknown) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new Error("Native decoder returned an invalid pixel buffer");
}

function expectedPlaneSize(layout: number, plane: number, width: number, height: number) {
  if (plane === 0) return { width, height };
  if (layout === 1) return { width: Math.ceil(width / 2), height: Math.ceil(height / 2) };
  if (layout === 2) return { width: Math.ceil(width / 2), height };
  return { width, height };
}

export function validateNativeFrame(value: unknown): NativeDecodedFrame {
  if (!value || typeof value !== "object") throw new Error("Native decoder returned no frame");
  const raw = value as Record<string, unknown>;
  const backend = raw.backend === "FFmpeg" || raw.backend === "dav1d" ? raw.backend : null;
  if (!backend) throw new Error("Native decoder returned an unknown backend");
  const width = integer(raw.width, 1, 8192, "width");
  const height = integer(raw.height, 1, 8192, "height");
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > MAX_NATIVE_FRAME_PIXELS) throw new Error("Native frame exceeds the pixel limit");
  const renderWidth = integer(raw.renderWidth, 1, 8192, "render width");
  const renderHeight = integer(raw.renderHeight, 1, 8192, "render height");
  const pixelLayout = integer(raw.pixelLayout, 0, 3, "pixel layout") as 0 | 1 | 2 | 3;
  const bitDepth = integer(raw.bitDepth, 8, 16, "bit depth");
  const index = integer(raw.index, 0, 10_000, "frame index");
  const matrixCoefficients = integer(raw.matrixCoefficients, -1, 255, "matrix coefficients");
  const data = byteArray(raw.data);
  if (data.byteLength === 0 || data.byteLength > MAX_NATIVE_PLANE_BYTES) throw new Error("Native pixel buffer exceeds the transfer limit");
  if (!Array.isArray(raw.planes)) throw new Error("Native decoder returned invalid plane metadata");
  const expectedPlaneCount = pixelLayout === 0 ? 1 : 3;
  if (raw.planes.length !== expectedPlaneCount) throw new Error("Native decoder returned an unexpected plane count");
  const bytesPerSample = bitDepth > 8 ? 2 : 1;
  let expectedOffset = 0;
  const planes = raw.planes.map((candidate, planeIndex) => {
    if (!candidate || typeof candidate !== "object") throw new Error("Native decoder returned invalid plane metadata");
    const plane = candidate as Record<string, unknown>;
    const expected = expectedPlaneSize(pixelLayout, planeIndex, width, height);
    const planeWidth = integer(plane.width, 1, 8192, "plane width");
    const planeHeight = integer(plane.height, 1, 8192, "plane height");
    if (planeWidth !== expected.width || planeHeight !== expected.height) throw new Error("Native plane dimensions do not match the pixel layout");
    const rowBytes = integer(plane.rowBytes, 1, 16_384, "plane row size");
    const length = integer(plane.length, 1, MAX_NATIVE_PLANE_BYTES, "plane length");
    const offset = integer(plane.offset, 0, MAX_NATIVE_PLANE_BYTES, "plane offset");
    if (rowBytes !== planeWidth * bytesPerSample || length !== rowBytes * planeHeight || offset !== expectedOffset || offset + length > data.byteLength) {
      throw new Error("Native plane bounds do not match the pixel buffer");
    }
    expectedOffset += length;
    return { offset, length, rowBytes, width: planeWidth, height: planeHeight };
  });
  if (expectedOffset !== data.byteLength) throw new Error("Native pixel buffer has trailing data");
  return {
    backend,
    index,
    width,
    height,
    renderWidth,
    renderHeight,
    pixelLayout,
    bitDepth,
    fullRange: raw.fullRange === true,
    matrixCoefficients,
    littleEndian: raw.littleEndian === true,
    planes,
    data,
  };
}

export function nativeDecoderAvailable(codec: string, byteLength: number) {
  return (codec === "h264" || codec === "av1") && byteLength > 0 && byteLength <= MAX_NATIVE_INPUT_BYTES &&
    typeof window !== "undefined" && typeof window.bitscopeNative?.decodeFrame === "function";
}

export async function decodeNativeFrame(codec: NativeCodec, bytes: Uint8Array, frameIndex: number, signal?: AbortSignal) {
  if (!nativeDecoderAvailable(codec, bytes.byteLength)) throw new Error("Native decoder bridge is unavailable");
  integer(frameIndex, 0, 10_000, "requested frame index");
  if (signal?.aborted) throw new DOMException("Native decode cancelled", "AbortError");
  const requestBytes = bytes.slice().buffer;
  const pending = window.bitscopeNative!.decodeFrame({ codec, frameIndex, bytes: requestBytes });
  const value = signal ? await new Promise<unknown>((resolve, reject) => {
    const abort = () => reject(new DOMException("Native decode cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    pending.then(
      result => { signal.removeEventListener("abort", abort); resolve(result); },
      error => { signal.removeEventListener("abort", abort); reject(error); },
    );
  }) : await pending;
  return validateNativeFrame(value);
}

function sample(frame: NativeDecodedFrame, planeIndex: number, x: number, y: number) {
  const plane = frame.planes[planeIndex];
  const bytesPerSample = frame.bitDepth > 8 ? 2 : 1;
  const offset = plane.offset + y * plane.rowBytes + x * bytesPerSample;
  if (bytesPerSample === 1) return frame.data[offset];
  return frame.littleEndian
    ? frame.data[offset] | (frame.data[offset + 1] << 8)
    : (frame.data[offset] << 8) | frame.data[offset + 1];
}

function matrix(frame: NativeDecodedFrame) {
  if (frame.matrixCoefficients === 1) return { kr: .2126, kb: .0722 };
  if (frame.matrixCoefficients === 9 || frame.matrixCoefficients === 10) return { kr: .2627, kb: .0593 };
  if (frame.matrixCoefficients === 5 || frame.matrixCoefficients === 6) return { kr: .299, kb: .114 };
  return frame.width >= 1280 || frame.height > 576 ? { kr: .2126, kb: .0722 } : { kr: .299, kb: .114 };
}

export function nativeFrameToRgba(frameValue: NativeDecodedFrame) {
  const frame = validateNativeFrame(frameValue);
  const output = new Uint8ClampedArray(frame.width * frame.height * 4);
  const maximum = 2 ** frame.bitDepth - 1;
  const scale = 2 ** Math.max(0, frame.bitDepth - 8);
  const { kr, kb } = matrix(frame);
  const kg = 1 - kr - kb;
  const chromaXShift = frame.pixelLayout === 1 || frame.pixelLayout === 2 ? 1 : 0;
  const chromaYShift = frame.pixelLayout === 1 ? 1 : 0;
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const luma = sample(frame, 0, x, y);
      const neutral = 128 * scale;
      const cbSample = frame.pixelLayout === 0 ? neutral : sample(frame, 1, x >> chromaXShift, y >> chromaYShift);
      const crSample = frame.pixelLayout === 0 ? neutral : sample(frame, 2, x >> chromaXShift, y >> chromaYShift);
      const normalizedY = frame.fullRange ? luma / maximum : (luma - 16 * scale) / (219 * scale);
      const normalizedCb = frame.fullRange ? (cbSample - neutral) / maximum : (cbSample - 128 * scale) / (224 * scale);
      const normalizedCr = frame.fullRange ? (crSample - neutral) / maximum : (crSample - 128 * scale) / (224 * scale);
      let red: number;
      let green: number;
      let blue: number;
      if (frame.matrixCoefficients === 0 && frame.pixelLayout === 3) {
        red = crSample / maximum;
        green = luma / maximum;
        blue = cbSample / maximum;
      } else if (frame.matrixCoefficients === 8) {
        red = normalizedY + normalizedCb - normalizedCr;
        green = normalizedY + normalizedCr;
        blue = normalizedY - normalizedCb - normalizedCr;
      } else {
        red = normalizedY + 2 * (1 - kr) * normalizedCr;
        blue = normalizedY + 2 * (1 - kb) * normalizedCb;
        green = (normalizedY - kr * red - kb * blue) / kg;
      }
      const outputOffset = (y * frame.width + x) * 4;
      output[outputOffset] = Math.round(red * 255);
      output[outputOffset + 1] = Math.round(green * 255);
      output[outputOffset + 2] = Math.round(blue * 255);
      output[outputOffset + 3] = 255;
    }
  }
  return output;
}

export function drawNativeFrame(canvas: HTMLCanvasElement, frame: NativeDecodedFrame) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas 2D is unavailable");
  canvas.width = frame.width;
  canvas.height = frame.height;
  context.putImageData(new ImageData(nativeFrameToRgba(frame), frame.width, frame.height), 0, 0);
}
