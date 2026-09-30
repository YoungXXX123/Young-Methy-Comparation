import { focusSegmentPosition, focusSegments, type LogoColumn, type Region } from "./ab1";
import type { Base } from "./legacy-alignment";

export const logoBases: Base[] = ["A", "C", "G", "T"];
export const logoColors: Record<Base, string> = { A: "#258f64", C: "#397dd3", G: "#3e485b", T: "#d54d57" };
export type LogoPlacement = { column: LogoColumn; x: number; anchor: number; width: number; emphasized: boolean };

export function logoLetters(column: LogoColumn): Array<{ base: Base; fraction: number }> {
  return logoBases.map((base) => ({ base, fraction: column.proportions[base] }))
    .filter(({ fraction }) => fraction > 0)
    .sort((a, b) => a.fraction - b.fraction);
}

export function logoPlacements(columns: LogoColumn[], region: Region, focus: boolean, showCpn: boolean,
  plotLeft: number, plotRight: number): LogoPlacement[] {
  const span = region.end - region.start;
  if (span <= 0) return [];
  const scale = (distance: number) => plotLeft + (distance - region.start) / span * (plotRight - plotLeft);
  const selected = columns.filter((column) => !focus || column.kind === "cpg" || (showCpn && column.kind === "cpn"));
  const targets = selected.filter((column) => column.kind === "cpg" || (showCpn && column.kind === "cpn"));
  const segments = focus ? focusSegments(targets.map((column) => column.distance), region) : [];
  const placed = selected.map((column) => {
    const segment = segments.find((item) => item.sites.includes(column.distance));
    return { column, anchor: scale(column.distance),
      x: segment ? focusSegmentPosition(column.distance, segment, region, plotRight, plotLeft, 0) : scale(column.distance),
      emphasized: column.kind === "cpg" || (showCpn && column.kind === "cpn") };
  });
  const sorted = [...placed].sort((a, b) => a.x - b.x);
  const closest = sorted.length > 1 ? Math.min(...sorted.slice(1).map((item, index) => item.x - sorted[index].x)) : 24;
  const targetWidth = Math.max(5, Math.min(20, closest * .78));
  const otherWidth = Math.max(2, Math.min(9, (plotRight - plotLeft) / span * .78));
  return placed.map((item) => ({ ...item, width: item.emphasized ? targetWidth : otherWidth }));
}
