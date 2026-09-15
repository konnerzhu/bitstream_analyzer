export const MAX_QP_REGIONS = 600_000;

export type QpRegion = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
  value: number;
}>;

export type QpHeatmapSummary = Readonly<{
  count: number;
  minimum: number;
  maximum: number;
}>;

const COLOR_STOPS = [
  [44, 123, 182],
  [0, 166, 202],
  [255, 255, 191],
  [253, 174, 97],
  [215, 25, 28],
] as const;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Uses a fixed codec-wide range so the same color means the same QP across frames. */
export function qpHeatmapColor(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value) || !Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum <= minimum) throw new Error("Invalid QP heatmap range");
  const position = clamp((value - minimum) / (maximum - minimum), 0, 1) * (COLOR_STOPS.length - 1);
  const lower = Math.min(COLOR_STOPS.length - 2, Math.floor(position));
  const mix = position - lower;
  const start = COLOR_STOPS[lower];
  const end = COLOR_STOPS[lower + 1];
  const channel = (index: 0 | 1 | 2) => Math.round(start[index] + (end[index] - start[index]) * mix);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

export function summarizeQpRegions(regions: readonly QpRegion[], minimum: number, maximum: number): QpHeatmapSummary | null {
  if (regions.length > MAX_QP_REGIONS || !Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum <= minimum) return null;
  let observedMinimum = Number.POSITIVE_INFINITY;
  let observedMaximum = Number.NEGATIVE_INFINITY;
  let count = 0;
  for (const region of regions) {
    if (![region.x, region.y, region.width, region.height, region.value].every(Number.isFinite) || region.width <= 0 || region.height <= 0 || region.value < minimum || region.value > maximum) continue;
    observedMinimum = Math.min(observedMinimum, region.value);
    observedMaximum = Math.max(observedMaximum, region.value);
    count += 1;
  }
  return count ? { count, minimum: observedMinimum, maximum: observedMaximum } : null;
}
