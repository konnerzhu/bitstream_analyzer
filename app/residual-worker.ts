import { buildResidualImage, MAX_RESIDUAL_PIXELS, MAX_RESIDUAL_REGIONS, type ResidualRegion } from "./residual";

type ResidualWorkerRequest = {
  current: ImageBitmap;
  previous: ImageBitmap | null;
  width: number;
  height: number;
  regions: ResidualRegion[];
  gain: number;
};

function validRequest(value: unknown): value is ResidualWorkerRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<ResidualWorkerRequest>;
  const pixels = Number(request.width) * Number(request.height);
  return request.current instanceof ImageBitmap &&
    (request.previous === null || request.previous instanceof ImageBitmap) &&
    Number.isSafeInteger(request.width) && Number(request.width) > 0 &&
    Number.isSafeInteger(request.height) && Number(request.height) > 0 &&
    Number.isSafeInteger(pixels) && pixels <= MAX_RESIDUAL_PIXELS &&
    Array.isArray(request.regions) && request.regions.length <= MAX_RESIDUAL_REGIONS &&
    Number.isFinite(request.gain);
}

self.onmessage = (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (!validRequest(request)) {
    self.postMessage({ ok: false, error: "Invalid residual worker request" });
    return;
  }
  try {
    const currentCanvas = new OffscreenCanvas(request.width, request.height);
    const currentContext = currentCanvas.getContext("2d", { willReadFrequently: true });
    if (!currentContext) throw new Error("Residual canvas is unavailable");
    currentContext.drawImage(request.current, 0, 0, request.width, request.height);
    const current = currentContext.getImageData(0, 0, request.width, request.height).data;

    let previous: Uint8ClampedArray | null = null;
    if (request.previous) {
      const previousCanvas = new OffscreenCanvas(request.width, request.height);
      const previousContext = previousCanvas.getContext("2d", { willReadFrequently: true });
      if (!previousContext) throw new Error("Residual reference canvas is unavailable");
      previousContext.drawImage(request.previous, 0, 0, request.width, request.height);
      previous = previousContext.getImageData(0, 0, request.width, request.height).data;
    }

    const result = buildResidualImage(current, previous, request.width, request.height, request.regions, request.gain);
    self.postMessage({ ok: true, ...result }, { transfer: [result.pixels.buffer] });
  } catch {
    self.postMessage({ ok: false, error: "Residual processing failed" });
  } finally {
    request.current.close();
    request.previous?.close();
  }
};
