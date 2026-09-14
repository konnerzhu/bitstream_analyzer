import { MAX_RESIDUAL_PIXELS, type ResidualImage, type ResidualRegion } from "./residual";

const RESIDUAL_WORKER_TIMEOUT_MS = 10_000;

type ResidualWorkerResponse = ({ ok: true } & ResidualImage) | { ok: false; error: string };

function abortError() {
  return new DOMException("Residual processing was cancelled", "AbortError");
}

function validateResponse(value: unknown, pixelCount: number): ResidualImage {
  if (!value || typeof value !== "object") throw new Error("Residual worker returned an invalid response");
  const response = value as Partial<ResidualWorkerResponse>;
  if (response.ok !== true || !(response.pixels instanceof Uint8ClampedArray)) {
    throw new Error(typeof response.error === "string" ? response.error : "Residual worker failed");
  }
  const counts = [response.coveredPixels, response.intraPixels, response.interPixels, response.regionCount];
  if (response.pixels.length !== pixelCount * 4 || counts.some(count => !Number.isSafeInteger(count) || Number(count) < 0) ||
      Number(response.coveredPixels) > pixelCount || Number(response.intraPixels) + Number(response.interPixels) !== Number(response.coveredPixels)) {
    throw new Error("Residual worker returned inconsistent output");
  }
  return response as ResidualImage;
}

export async function buildResidualImageInWorker(
  currentCanvas: HTMLCanvasElement,
  previousCanvas: HTMLCanvasElement | null,
  width: number,
  height: number,
  regions: ResidualRegion[],
  gain: number,
  signal: AbortSignal,
): Promise<ResidualImage> {
  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount <= 0 || pixelCount > MAX_RESIDUAL_PIXELS) {
    throw new Error("Residual image exceeds the safe pixel limit");
  }
  if (signal.aborted) throw abortError();

  const [current, previous] = await Promise.all([
    createImageBitmap(currentCanvas),
    previousCanvas ? createImageBitmap(previousCanvas) : Promise.resolve(null),
  ]);
  if (signal.aborted) {
    current.close();
    previous?.close();
    throw abortError();
  }

  const worker = new Worker(new URL("./residual-worker.ts", import.meta.url), { type: "module", name: "bitscope-residual" });
  return new Promise<ResidualImage>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      worker.terminate();
      callback();
    };
    const onAbort = () => finish(() => reject(abortError()));
    const timeout = window.setTimeout(() => finish(() => reject(new Error("Residual worker timed out"))), RESIDUAL_WORKER_TIMEOUT_MS);
    signal.addEventListener("abort", onAbort, { once: true });
    worker.onerror = () => finish(() => reject(new Error("Residual worker failed")));
    worker.onmessage = (event: MessageEvent<unknown>) => {
      try {
        const result = validateResponse(event.data, pixelCount);
        finish(() => resolve(result));
      } catch (error) {
        finish(() => reject(error));
      }
    };
    try {
      worker.postMessage({ current, previous, width, height, regions, gain }, previous ? [current, previous] : [current]);
    } catch (error) {
      current.close();
      previous?.close();
      finish(() => reject(error));
    }
  });
}
