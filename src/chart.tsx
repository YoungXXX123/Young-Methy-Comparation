import { useRef, useState } from "react";
import type { Dataset } from "./data";
import type { Comparison } from "./statistics";
import type { Region } from "./ab1";

export const colors = ["#526778", "#db7846", "#6579bd", "#9e6a99", "#5c9a83", "#bd9d49"];
export type Bounds = [number, number];

export function fullBounds(datasets: Dataset[]): Bounds {
  const all = datasets.flatMap((d) => d.rows.map((r) => r.distance));
  if (!all.length) return [-25, 25];
  return [Math.min(...all) - 10, Math.max(...all) + 10];
}

export function clampBounds(a: number, b: number, full: Bounds, minimum = 50): Bounds {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return full;
  let lo = Math.min(a, b), hi = Math.max(a, b);
  const width = Math.min(Math.max(minimum, hi - lo), full[1] - full[0]);
  const center = (lo + hi) / 2;
  lo = Math.max(full[0], Math.min(full[1] - width, center - width / 2));
  hi = lo + width;
  return [lo, hi];
}

export function groupSeries(datasets: Dataset[], group: string): Array<{ x: number; y: number | null }> {
  const rows = new Map<number, number[]>();
  for (const dataset of datasets.filter((d) => d.group === group)) {
    for (const row of dataset.rows) {
      if (!rows.has(row.distance)) rows.set(row.distance, []);
      if (row.value !== null) rows.get(row.distance)!.push(row.value);
    }
  }
  return [...rows].map(([x, values]) => ({ x, y: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null }))
    .sort((a, b) => a.x - b.x);
}

function pointsPath(points: Array<{ x: number; y: number | null }>, xScale: (x: number) => number, yScale: (y: number) => number,
  bounds: Bounds): string {
  let path = "", started = false;
  for (const p of points) {
    if (p.y === null || p.x < bounds[0] || p.x > bounds[1]) { started = false; continue; }
    path += `${started ? "L" : "M"}${xScale(p.x).toFixed(2)},${yScale(p.y).toFixed(2)}`;
    started = true;
  }
  return path;
}

export function SharedChart({ datasets, comparison, viewport, setViewport, regions }: {
  datasets: Dataset[]; comparison: Comparison; viewport: Bounds; setViewport: (value: Bounds) => void; regions: Region[];
}) {
  const width = 1000, left = 66, right = 24, panelHeight = 170, panelTop = 35;
  const height = comparison.groups.length * panelHeight + 50;
  const full = fullBounds(datasets);
  const xScale = (x: number) => left + (x - viewport[0]) / (viewport[1] - viewport[0]) * (width - left - right);
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const [dragEnd, setDragEnd] = useState<number | null>(null);
  const cursorX = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    return Math.max(left, Math.min(width - right, (clientX - rect.left) * width / rect.width));
  };
  const xValue = (pixel: number) => viewport[0] + (pixel - left) / (width - left - right) * (viewport[1] - viewport[0]);
  const ticks = Array.from({ length: 7 }, (_, i) => viewport[0] + (viewport[1] - viewport[0]) * i / 6);
  return <div className="chart-scroller"><svg ref={ref} className="main-chart" viewBox={`0 0 ${width} ${height}`}
    role="img" tabIndex={0} aria-label="各组共享横坐标的甲基化比例图；拖动选择区域，按加号或减号缩放，双击显示全长"
    onPointerDown={(event) => { event.currentTarget.focus(); drag.current = cursorX(event.clientX); setDragEnd(drag.current); event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={(event) => { if (drag.current !== null) setDragEnd(cursorX(event.clientX)); }}
    onPointerUp={(event) => { if (drag.current !== null) {
      const end = cursorX(event.clientX);
      if (Math.abs(end - drag.current) > 8) setViewport(clampBounds(xValue(drag.current), xValue(end), full));
      drag.current = null; setDragEnd(null);
    } }}
    onDoubleClick={() => setViewport(full)}
    onKeyDown={(event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const factor = ["+", "="].includes(event.key) || event.code === "NumpadAdd" ? 0.82 :
        ["-", "_"].includes(event.key) || event.code === "NumpadSubtract" ? 1.18 : null;
      if (factor === null) return;
      event.preventDefault();
      const center = (viewport[0] + viewport[1]) / 2;
      const half = (viewport[1] - viewport[0]) * factor / 2;
      setViewport(clampBounds(center - half, center + half, full));
    }}>
    {comparison.groups.map((group, index) => {
      const top = panelTop + index * panelHeight;
      const yScale = (y: number) => top + 115 - y * 100;
      const points = groupSeries(datasets, group);
      return <g key={group}>
        <text x={left} y={top - 10} className="chart-title">{group} · n={comparison.counts[group]}</text>
        {[0, .25, .5, .75, 1].map((value) => <g key={value}>
          <line x1={left} x2={width - right} y1={yScale(value)} y2={yScale(value)} stroke="#e8eef0" />
          <text x={left - 8} y={yScale(value) + 4} textAnchor="end" className="chart-tick">{Math.round(value * 100)}%</text>
        </g>)}
        {regions.map((r) => <rect key={r.name} x={xScale(r.start)} y={top + 9}
          width={xScale(r.end) - xScale(r.start)} height={110} fill="#f2d9a8" opacity=".45" />)}
        {viewport[0] <= 0 && viewport[1] >= 0 && <line x1={xScale(0)} x2={xScale(0)} y1={top + 10} y2={top + 118}
          stroke="#b7c4c8" strokeDasharray="3 4" />}
        <path d={pointsPath(points, xScale, yScale, viewport)} fill="none" stroke={colors[index % colors.length]} strokeWidth="2" />
        {points.filter((p) => p.y !== null && p.x >= viewport[0] && p.x <= viewport[1]).map((p) =>
          <circle key={p.x} cx={xScale(p.x)} cy={yScale(p.y!)} r="2.5" fill={colors[index % colors.length]}>
            <title>{`${p.x} bp · ${(p.y! * 100).toFixed(1)}%`}</title>
          </circle>)}
        {comparison.sites.filter((site) => site.marked && site.distance >= viewport[0] && site.distance <= viewport[1]).map((site) =>
          <text key={site.distance} x={xScale(site.distance)} y={top + 9} textAnchor="middle"
            fill="#c43d3d" fontSize="10">★<title>{`${site.distance} bp · 差值 ${site.differencePp?.toFixed(1)} pp${comparison.inferential ? ` · P=${site.p?.toPrecision(3)}` : " · 观察差异"}`}</title></text>)}
        {index === comparison.groups.length - 1 && ticks.map((tick, i) => <g key={i}>
          <line x1={xScale(tick)} x2={xScale(tick)} y1={top + 123} y2={top + 128} stroke="#688089" />
          <text x={xScale(tick)} y={top + 144} textAnchor="middle" className="chart-tick">{tick.toFixed(Math.abs(tick) < 100 ? 0 : 0)}</text>
        </g>)}
      </g>;
    })}
    <text x={width / 2} y={height - 10} textAnchor="middle" className="chart-axis">Distance to target center (bp)</text>
    {drag.current !== null && dragEnd !== null && <rect x={Math.min(drag.current, dragEnd)} y={20}
      width={Math.abs(dragEnd - drag.current)} height={height - 55} fill="#8bb5b4" opacity=".2" stroke="#278284" />}
  </svg></div>;
}
