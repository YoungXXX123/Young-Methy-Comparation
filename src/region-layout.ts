import type { Region } from "./ab1";
import type { Bounds } from "./chart";

export type RegionColumn = { region: Region; x: number; width: number };

export function regionCanvasWidth(count: number) {
  return Math.max(1600, 172 + count * 540);
}

export function regionColumns(regions: Region[], full: Bounds, canvasWidth: number, left: number, right: number): RegionColumn[] {
  if (!regions.length) return [];
  const ordered = [...regions].sort((a, b) => (a.start + a.end) - (b.start + b.end));
  const plotWidth = canvasWidth - left - right;
  const gap = 28;
  const tileWidth = Math.min(650, (plotWidth - gap * (ordered.length - 1)) / ordered.length);
  const fullWidth = full[1] - full[0];
  const positions = ordered.map((region) => {
    const center = (region.start + region.end) / 2;
    const desired = left + (center - full[0]) / fullWidth * plotWidth - tileWidth / 2;
    return Math.max(left, Math.min(left + plotWidth - tileWidth, desired));
  });
  for (let i = 1; i < positions.length; i += 1) {
    positions[i] = Math.max(positions[i], positions[i - 1] + tileWidth + gap);
  }
  positions[positions.length - 1] = Math.min(positions[positions.length - 1], left + plotWidth - tileWidth);
  for (let i = positions.length - 2; i >= 0; i -= 1) {
    positions[i] = Math.min(positions[i], positions[i + 1] - tileWidth - gap);
  }
  return ordered.map((region, i) => ({ region, x: positions[i], width: tileWidth }));
}
