import { useEffect, useMemo, useState } from "react";
import type { Dataset } from "./data";
import type { Comparison } from "./statistics";
import { focusPosition, mergedRegionalTrace, regionBatches, type Region, type RegionalTrace, type RegionBatch, type TraceCurves } from "./ab1";
import { colors, fullBounds, groupSeries } from "./chart";
import { regionCanvasWidth, regionColumns } from "./region-layout";
import type { RegionSource } from "./report";

const nucleotides = ["A", "C", "G", "T"] as const;
const signalColors = { A: "#258f64", C: "#397dd3", G: "#3e485b", T: "#d54d57" };
type TraceRow = { batch: RegionBatch; trace: RegionalTrace };

export function RegionAtlas({ datasets, comparison, regions, sources, trim, qualityThreshold, windowSize }: {
  datasets: Dataset[]; comparison: Comparison; regions: Region[]; sources: Record<string, RegionSource>;
  trim: boolean; qualityThreshold: number; windowSize: number;
}) {
  const [rows, setRows] = useState<Record<string, TraceRow[]>>({});
  const full = useMemo(() => fullBounds(datasets), [datasets]);
  const width = regionCanvasWidth(regions.length), left = 66, right = 24;
  const columns = regionColumns(regions, full, width, left, right);
  useEffect(() => {
    let current = true;
    void Promise.all(regions.map(async (region) => {
      const source = sources[region.name];
      if (!source?.reference || source.center === null) return [region.name, []] as const;
      const batches = regionBatches(source.reads);
      const traces = await Promise.all(batches.map(async (batch) => ({ batch,
        trace: await mergedRegionalTrace(batch.reads, source.reference, source.center!, region,
          trim, qualityThreshold, windowSize, source.filterQ, source.minimumQ, source.focus) })));
      return [region.name, traces] as const;
    })).then((entries) => { if (current) setRows(Object.fromEntries(entries)); })
      .catch(() => { if (current) setRows({}); });
    return () => { current = false; };
  }, [regions, sources, trim, qualityThreshold, windowSize]);

  const maxRows = Math.max(0, ...regions.map((region) => rows[region.name]?.length ?? 0));
  const zoomTop = 98, zoomHeight = 195, traceTop = zoomTop + zoomHeight + 12, traceHeight = 116;
  const height = traceTop + maxRows * traceHeight + 30;
  const overviewX = (value: number) => left + (value - full[0]) / (full[1] - full[0]) * (width - left - right);

  function tracePath(curves: TraceCurves, base: typeof nucleotides[number], region: Region,
    plotLeft: number, plotRight: number, baseline: number, max: number, site?: number) {
    let started = false, path = "";
    for (const point of curves[base]) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < region.start || point.x > region.end ||
        (site !== undefined && (point.x < site - 2.5 || point.x > site + 2.5))) { started = false; continue; }
      const rawX = plotLeft + (point.x - region.start) / (region.end - region.start) * (plotRight - plotLeft);
      const x = site === undefined ? rawX : focusPosition(point.x, site, region, width, plotLeft, width - plotRight);
      const y = baseline - point.y / max * 76;
      path += `${started ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
      started = true;
    }
    return path;
  }

  return <div className="chart-scroller"><svg className="atlas-chart" viewBox={`0 0 ${width} ${height}`}
    role="img" aria-label="所选区域与甲基化全景的位置关系、并排局部图和对齐的 AB1 峰图">
    <text x={left} y="17" className="chart-tick">已选区域在全长图谱中的位置</text>
    <line x1={left} x2={width - right} y1="40" y2="40" stroke="#9eb8b3" strokeWidth="2" />
    {columns.map(({ region, x, width: tileWidth }) => {
      const p0 = overviewX(region.start), p1 = overviewX(region.end);
      const plotLeft = x + 44, plotRight = x + tileWidth - 14;
      const scale = (value: number) => plotLeft + (value - region.start) / (region.end - region.start) * (plotRight - plotLeft);
      const source = sources[region.name];
      return <g key={region.name}>
        <defs><clipPath id={`trace-clip-${region.name}`}><rect x={plotLeft} y={traceTop}
          width={plotRight - plotLeft} height={Math.max(0, height - traceTop)} /></clipPath></defs>
        <rect x={p0} y="33" width={Math.max(2, p1 - p0)} height="14" rx="3" fill="#f1d6a4" />
        <line x1={p0} x2={p0} y1="28" y2="52" stroke="#bd9561" />
        <line x1={p1} x2={p1} y1="28" y2="52" stroke="#bd9561" />
        <line x1={p0} y1="51" x2={plotLeft} y2={zoomTop} stroke="#b3c7c0" strokeWidth="1.5" />
        <line x1={p1} y1="51" x2={plotRight} y2={zoomTop} stroke="#b3c7c0" strokeWidth="1.5" />
        <rect x={x + 2} y={zoomTop} width={tileWidth - 4} height={zoomHeight}
          rx="9" fill="#fbfdfc" stroke="#dfe9e6" />
        <text x={x + 12} y={zoomTop + 20} fontSize="16" fontWeight="700" fill="#294f50">{region.name}</text>
        {[0, .25, .5, .75, 1].map((value) => {
          const yy = zoomTop + 153 - value * 116;
          return <g key={value}><line x1={plotLeft} x2={plotRight} y1={yy} y2={yy} stroke="#edf2f0" />
            <text x={plotLeft - 6} y={yy + 4} textAnchor="end" fontSize="10" fill="#8a9a9a">{value * 100}%</text></g>;
        })}
        {comparison.groups.map((group, i) => {
          const points = groupSeries(datasets, group);
          let started = false, path = "";
          for (const point of points) {
            if (point.y === null || point.x < region.start || point.x > region.end) { started = false; continue; }
            path += `${started ? "L" : "M"}${scale(point.x).toFixed(1)},${(zoomTop + 153 - point.y * 116).toFixed(1)}`;
            started = true;
          }
          return <path key={group} d={path} stroke={colors[i % colors.length]} strokeWidth="1.8" fill="none" />;
        })}
        {comparison.sites.filter((site) => site.marked && site.distance >= region.start && site.distance <= region.end)
          .map((site) => <text key={site.distance} x={scale(site.distance)} y={zoomTop + 37} textAnchor="middle"
            fill="#c43d3d" fontSize="10">★</text>)}
        <text x={plotLeft} y={zoomTop + 179} fontSize="11" fill="#70898b">{Math.round(region.start)} bp</text>
        <text x={plotRight} y={zoomTop + 179} textAnchor="end" fontSize="11" fill="#70898b">{Math.round(region.end)} bp</text>
        {(rows[region.name] ?? []).map(({ batch, trace }, rowIndex) => {
          const focus = source?.focus ?? true;
          const rowTop = traceTop + rowIndex * traceHeight, baseline = rowTop + 99;
          let max = 1;
          for (const base of nucleotides) for (const point of trace.curves[base]) {
            if (Number.isFinite(point.y)) max = Math.max(max, point.y);
          }
          return <g key={`${batch.group}:${batch.batch}`} aria-label={`${region.name} ${batch.group} ${batch.batch}`}>
            <line x1={plotLeft} x2={plotRight} y1={baseline} y2={baseline} stroke="#e3ebe8" />
            <text x={plotLeft + 5} y={rowTop + 15} fontSize="11" fontWeight="700" fill="#294f50">{region.name}区</text>
            {!focus && <text x={plotRight} y={rowTop + 15} textAnchor="end" fontSize="11" fill="#76908e">
              Q {trace.meanQ === null ? "—" : trace.meanQ.toFixed(1)}</text>}
            {focus && trace.cpgSites.map((site) => <line key={site} x1={scale(site)} x2={scale(site)}
              y1={zoomTop + 38} y2={baseline} stroke="#a3c7be" strokeWidth=".7" strokeDasharray="2 4" />)}
            <g clipPath={`url(#trace-clip-${region.name})`}>
              {nucleotides.map((base) => focus ? trace.cpgSites.map((site) =>
                <path key={`${base}:${site}`} d={tracePath(trace.curves, base, region, plotLeft, plotRight, baseline, max, site)}
                  stroke={signalColors[base]} strokeWidth="1.2" fill="none" />) :
                <path key={base} d={tracePath(trace.curves, base, region, plotLeft, plotRight, baseline, max)}
                  stroke={signalColors[base]} strokeOpacity=".28" strokeWidth="1" fill="none" />)}
            </g>
          </g>;
        })}
      </g>;
    })}
  </svg></div>;
}
