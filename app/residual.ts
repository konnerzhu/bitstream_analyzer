export const MAX_RESIDUAL_PIXELS = 8_388_608;
export const MAX_RESIDUAL_REGIONS = 100_000;

export type ResidualRegion = {
  kind: "intra" | "inter";
  x: number;
  y: number;
  width: number;
  height: number;
  mvX?: number;
  mvY?: number;
  unitsPerPixel?: number;
};

export type ResidualImage = {
  pixels: Uint8ClampedArray;
  coveredPixels: number;
  intraPixels: number;
  interPixels: number;
  regionCount: number;
};

function luma(pixels: Uint8ClampedArray, offset: number) {
  return (54 * pixels[offset] + 183 * pixels[offset + 1] + 19 * pixels[offset + 2] + 128) >> 8;
}

function checkedDimension(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} is invalid`);
  return value;
}

/**
 * Builds a display-space prediction residual. Intra regions use a boundary DC
 * predictor; inter regions sample the prior displayed frame with the parsed MV.
 * It intentionally does not claim transform-exact decoder residual pixels.
 */
export function buildResidualImage(
  current: Uint8ClampedArray,
  previous: Uint8ClampedArray | null,
  widthValue: number,
  heightValue: number,
  regions: readonly ResidualRegion[],
  gainValue = 2,
): ResidualImage {
  const width = checkedDimension(widthValue, "width");
  const height = checkedDimension(heightValue, "height");
  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > MAX_RESIDUAL_PIXELS) throw new Error("Residual image exceeds the safe pixel limit");
  const byteLength = pixelCount * 4;
  if (current.length !== byteLength || (previous && previous.length !== byteLength)) throw new Error("Residual pixel buffer size does not match the picture");
  if (regions.length > MAX_RESIDUAL_REGIONS) throw new Error("Residual region count exceeds the safe limit");
  const gain = Math.min(8, Math.max(1, Number.isFinite(gainValue) ? gainValue : 2));
  const pixels = new Uint8ClampedArray(byteLength);
  const covered = new Uint8Array(pixelCount);
  for (let offset = 0; offset < byteLength; offset += 4) {
    pixels[offset] = 128;
    pixels[offset + 1] = 128;
    pixels[offset + 2] = 128;
    pixels[offset + 3] = 255;
  }

  let coveredPixels = 0;
  let intraPixels = 0;
  let interPixels = 0;
  let regionCount = 0;
  for (const region of regions) {
    if (![region.x, region.y, region.width, region.height].every(Number.isFinite) || region.width <= 0 || region.height <= 0) continue;
    const startX = Math.max(0, Math.floor(region.x));
    const startY = Math.max(0, Math.floor(region.y));
    const endX = Math.min(width, Math.ceil(region.x + region.width));
    const endY = Math.min(height, Math.ceil(region.y + region.height));
    if (startX >= endX || startY >= endY) continue;

    let dcPrediction = 128;
    if (region.kind === "intra") {
      let sum = 0;
      let samples = 0;
      if (startY > 0) for (let x = startX; x < endX; x += 1) { sum += luma(current, ((startY - 1) * width + x) * 4); samples += 1; }
      if (startX > 0) for (let y = startY; y < endY; y += 1) { sum += luma(current, (y * width + startX - 1) * 4); samples += 1; }
      if (samples) dcPrediction = Math.round(sum / samples);
    } else if (!previous || !Number.isFinite(region.mvX) || !Number.isFinite(region.mvY) || !Number.isFinite(region.unitsPerPixel) || (region.unitsPerPixel ?? 0) <= 0) {
      continue;
    }

    const displacementX = region.kind === "inter" ? (region.mvX ?? 0) / (region.unitsPerPixel ?? 1) : 0;
    const displacementY = region.kind === "inter" ? (region.mvY ?? 0) / (region.unitsPerPixel ?? 1) : 0;
    let wroteRegion = false;
    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        const pixel = y * width + x;
        if (covered[pixel]) continue;
        let predicted = dcPrediction;
        if (region.kind === "inter") {
          const sourceX = Math.min(width - 1, Math.max(0, Math.round(x + displacementX)));
          const sourceY = Math.min(height - 1, Math.max(0, Math.round(y + displacementY)));
          predicted = luma(previous!, (sourceY * width + sourceX) * 4);
        }
        const value = Math.min(255, Math.max(0, Math.round(128 + (luma(current, pixel * 4) - predicted) * gain)));
        const output = pixel * 4;
        pixels[output] = value;
        pixels[output + 1] = value;
        pixels[output + 2] = value;
        covered[pixel] = 1;
        coveredPixels += 1;
        if (region.kind === "intra") intraPixels += 1; else interPixels += 1;
        wroteRegion = true;
      }
    }
    if (wroteRegion) regionCount += 1;
  }
  return { pixels, coveredPixels, intraPixels, interPixels, regionCount };
}

export function scaleResidualRegions(regions: readonly ResidualRegion[], scaleX: number, scaleY: number) {
  if (![scaleX, scaleY].every(value => Number.isFinite(value) && value > 0)) return [];
  return regions.slice(0, MAX_RESIDUAL_REGIONS).map(region => ({
    ...region,
    x: region.x * scaleX,
    y: region.y * scaleY,
    width: region.width * scaleX,
    height: region.height * scaleY,
    mvX: region.mvX === undefined ? undefined : region.mvX * scaleX,
    mvY: region.mvY === undefined ? undefined : region.mvY * scaleY,
  }));
}
