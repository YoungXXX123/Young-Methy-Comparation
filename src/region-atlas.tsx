import { useEffect, useMemo, useState } from "react";
import type { Dataset } from "./data";
import type { Comparison } from "./statistics";
import { mergedRegionalLogo, regionBatches, type Region, type RegionalLogo, type RegionBatch } from "./ab1";
import { colors, fullBounds, groupSeries } from "./chart";
import { regionCanvasWidth, regionColumns } from "./region-layout";
import type { RegionSource } from "./report";
import { logoColors, logoLetters, logoPlacements } from "./sequence-logo";

type LogoRow = { batch: RegionBatch; logo: RegionalLogo };

export function RegionAtlas({ datasets, comparison, regions, sources }: {
  datasets: Dataset[]; comparison: Comparison; regions: Region[]; sources: Record<string, RegionSource>;
}) {
  const [rows, setRows] = useState<Record<string, LogoRow[]>>({});
  const full = useMemo(() => fullBounds(datasets), [datasets]);
  const width = regionCanvasWidth(regions.length), left = 66, right = 24;
  const columns = regionColumns(regions, full, width, left, right);
  useEffect(() => {
    let current = true;
    void Promise.all(regions.map(async (region) => {
      const source = sources[region.name];
      if (!source?.reference || source.center === null) return [region.name, []] as const;
      const batches = regionBatches(source.reads);
      const logos = batches.map((batch) => ({ batch,
        logo: mergedRegionalLogo(batch.reads, source.reference, source.center!, region,
          source.filterQ, source.minimumQ) }));
      return [region.name, logos] as const;
    })).then((entries) => { if (current) setRows(Object.fromEntries(entries)); })
      .catch(() => { if (current) setRows({}); });
    return () => { current = false; };
  }, [regions, sources]);

  const maxRows = Math.max(0, ...regions.map((region) => rows[region.name]?.length ?? 0));
  const zoomTop = 98, zoomHeight = 195, logoTop = zoomTop + zoomHeight + 12, logoHeight = 110;
  const height = logoTop + maxRows * logoHeight + 30;
  const overviewX = (value: number) => left + (value - full[0]) / (full[1] - full[0]) * (width - left - right);

  return <div className="chart-scroller"><svg className="atlas-chart" viewBox={`0 0 ${width} ${height}`}
    role="img" aria-label="所选区域与甲基化全景的位置关系、并排局部图和对齐的 AB1 序列 logo">
    <text x={left} y="17" className="chart-tick">已选区域在全长图谱中的位置</text>
    <line x1={left} x2={width - right} y1="40" y2="40" stroke="#9eb8b3" strokeWidth="2" />
    {columns.map(({ region, x, width: tileWidth }) => {
      const p0 = overviewX(region.start), p1 = overviewX(region.end);
      const plotLeft = x + 44, plotRight = x + tileWidth - 14;
      const scale = (value: number) => plotLeft + (value - region.start) / (region.end - region.start) * (plotRight - plotLeft);
      const source = sources[region.name];
      return <g key={region.name}>
        <defs><clipPath id={`logo-clip-${region.name}`}><rect x={plotLeft} y={logoTop}
          width={plotRight - plotLeft} height={Math.max(0, height - logoTop)} /></clipPath></defs>
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
        {(rows[region.name] ?? []).map(({ batch, logo }, rowIndex) => {
          const focus = source?.focus ?? true;
          const placements = logoPlacements(logo.columns, region, focus, plotLeft, plotRight);
          const rowTop = logoTop + rowIndex * logoHeight, baseline = rowTop + 96;
          return <g key={`${batch.group}:${batch.batch}`} aria-label={`${region.name} ${batch.group} ${batch.batch}`}>
            <line x1={plotLeft} x2={plotRight} y1={baseline} y2={baseline} stroke="#e3ebe8" />
            <text x={plotLeft + 5} y={rowTop + 15} fontSize="11" fontWeight="700" fill="#294f50">{region.name}区</text>
            {!focus && <text x={plotRight} y={rowTop + 15} textAnchor="end" fontSize="11" fill="#76908e">
              Q {logo.meanQ === null ? "—" : logo.meanQ.toFixed(1)}</text>}
            {placements.filter(({ emphasized }) => emphasized).map(({ column, anchor, x }) =>
              <line key={`guide:${column.index}`} x1={anchor} x2={x} y1={zoomTop + 38} y2={baseline}
                stroke="#a3c7be" strokeWidth=".7" strokeDasharray="2 4" />)}
            <g clipPath={`url(#logo-clip-${region.name})`}>
              {placements.map(({ column, x, width: letterWidth, emphasized }) => {
                let bottom = baseline;
                return <g key={column.index} opacity={emphasized ? 1 : .22}>
                  {logoLetters(column).map(({ base, fraction }) => {
                    const glyphHeight = fraction * 66;
                    const y = bottom;
                    bottom -= glyphHeight;
                    return glyphHeight < 1 ? null : <text key={base} x="0" y="0" textAnchor="middle"
                      fontFamily="Arial, sans-serif" fontWeight="900" fontSize="100" fill={logoColors[base]}
                      transform={`translate(${x} ${y}) scale(${letterWidth / 72} ${glyphHeight / 73})`}>{base}</text>;
                  })}
                </g>;
              })}
            </g>
          </g>;
        })}
      </g>;
    })}
  </svg></div>;
}
