import type { Dataset } from "./data";
import type { Comparison } from "./statistics";
import { focusPosition, mergedRegionalTrace, regionBatches, type Read, type Region, type RegionalTrace, type RegionBatch, type TraceCurves } from "./ab1";
import { colors, fullBounds, groupSeries, type Bounds } from "./chart";
import { regionCanvasWidth, regionColumns } from "./region-layout";

export type ReportPart = "combined" | "main" | "traces";
export type RegionSource = { reads: Read[]; reference: string; center: number | null;
  filterQ: boolean; minimumQ: number; focus: boolean };
const nucleotides = ["A", "C", "G", "T"] as const;
const signalColors = { A: "#258f64", C: "#397dd3", G: "#3e485b", T: "#d54d57" };

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function reportCanvas(datasets: Dataset[], comparison: Comparison, regions: Region[], reads: Read[],
  reference: string, center: number | null, part: ReportPart = "combined",
  trim = false, qualityThreshold = 20, windowSize = 20,
  regionSources: Record<string, RegionSource> = {}): Promise<HTMLCanvasElement> {
  const width = regionCanvasWidth(regions.length), left = 108, right = 64, header = 112, footer = 90;
  const full = fullBounds(datasets);
  const showMain = part !== "traces", showTraces = part !== "main";
  const mainHeight = 210, zoomHeight = 220, connectorHeight = 72, traceHeight = 130;
  const columns = regionColumns(regions, full, width, left, right);
  const traceRows = new Map<string, Array<{ batch: RegionBatch; trace: RegionalTrace; focus: boolean }>>();
  if (showTraces) for (const region of regions) {
    const source = regionSources[region.name] ?? { reads, reference, center, filterQ: false, minimumQ: 20, focus: true };
    if (source.center === null || !source.reference) continue;
    const rows: Array<{ batch: RegionBatch; trace: RegionalTrace; focus: boolean }> = [];
    for (const batch of regionBatches(source.reads)) {
      const trace = await mergedRegionalTrace(batch.reads, source.reference, source.center, region,
        trim, qualityThreshold, windowSize, source.filterQ, source.minimumQ, source.focus);
      rows.push({ batch, trace, focus: source.focus });
    }
    traceRows.set(region.name, rows);
  }
  const maxTraceRows = Math.max(0, ...columns.map(({ region }) => traceRows.get(region.name)?.length ?? 0));
  const height = header + (showMain ? comparison.groups.length * mainHeight + (columns.length ? connectorHeight : 0) : 0) +
    (columns.length ? zoomHeight : 0) + (showTraces ? maxTraceRows * traceHeight : 0) + footer;
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  if (!ctx) throw new Error("浏览器不能生成报告画布");
  ctx.fillStyle = "white"; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#223d48"; ctx.font = "bold 30px sans-serif";
  ctx.fillText("Young Methy Comparation · 甲基化比较报告", left, 42);
  ctx.font = "20px sans-serif";
  const rule = comparison.inferential ? `${comparison.method === "welch" ? "Welch" : "单因素"} ANOVA · ${comparison.marking.toUpperCase()} < 0.05`
    : `组间观察差值 > ${comparison.threshold} 个百分点（无显著性检验）`;
  ctx.fillText(`比较：${comparison.compared.join(" / ")}   ·   ${rule}`, left, 75);
  let top = header;

  function axes(bounds: Bounds, y: number, h: number, label: string) {
    const x = (v: number) => left + (v - bounds[0]) / (bounds[1] - bounds[0]) * (width - left - right);
    const yy = (v: number) => y + h - 34 - v * (h - 70);
    ctx.fillStyle = "#2b4752"; ctx.font = "18px sans-serif"; ctx.fillText(label, left, y + 18);
    ctx.font = "15px sans-serif";
    for (const tick of [0, .25, .5, .75, 1]) {
      const yTick = yy(tick);
      ctx.strokeStyle = "#e9eef0"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(left, yTick); ctx.lineTo(width - right, yTick); ctx.stroke();
      ctx.fillStyle = "#6a7d86"; ctx.textAlign = "right"; ctx.fillText(`${tick * 100}%`, left - 12, yTick + 5); ctx.textAlign = "left";
    }
    for (let i = 0; i <= 5; i += 1) {
      const value = bounds[0] + (bounds[1] - bounds[0]) * i / 5;
      ctx.fillStyle = "#6a7d86"; ctx.textAlign = "center";
      ctx.fillText(value.toFixed(0), x(value), y + h - 5); ctx.textAlign = "left";
    }
    return { x, yy };
  }

  function line(points: Array<{ x: number; y: number | null }>, bounds: Bounds, x: (v: number) => number,
    yy: (v: number) => number, color: string) {
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
    let started = false;
    for (const p of points) {
      if (p.y === null || p.x < bounds[0] || p.x > bounds[1]) { started = false; continue; }
      if (started) ctx.lineTo(x(p.x), yy(p.y)); else ctx.moveTo(x(p.x), yy(p.y));
      started = true;
    }
    ctx.stroke();
    ctx.fillStyle = color;
    for (const p of points) {
      if (p.y === null || p.x < bounds[0] || p.x > bounds[1]) continue;
      ctx.beginPath(); ctx.arc(x(p.x), yy(p.y), 2.5, 0, Math.PI * 2); ctx.fill();
    }
  }

  function stars(bounds: Bounds, x: (v: number) => number, y: number) {
    ctx.fillStyle = "#c43d3d"; ctx.font = "15px sans-serif"; ctx.textAlign = "center";
    for (const site of comparison.sites) {
      if (site.marked && site.distance >= bounds[0] && site.distance <= bounds[1]) ctx.fillText("★", x(site.distance), y);
    }
    ctx.textAlign = "left";
  }

  function drawRegionalTrace(curves: TraceCurves, region: Region, x0: number, x1: number,
    y0: number, h: number, focus: boolean, cpgSites: number[]) {
    let maximum = 1;
    for (const base of nucleotides) for (const point of curves[base]) {
      if (Number.isFinite(point.x) && point.x >= region.start && point.x <= region.end && Number.isFinite(point.y)) {
        maximum = Math.max(maximum, point.y);
      }
    }
    const x = (value: number) => x0 + (value - region.start) / (region.end - region.start) * (x1 - x0);
    const baseline = y0 + h - 16;
    const y = (value: number) => baseline - value / maximum * (h - 38);
    ctx.strokeStyle = "#e5ebed"; ctx.lineWidth = 1; ctx.beginPath();
    ctx.moveTo(x0, baseline); ctx.lineTo(x1, baseline); ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, h); ctx.clip();
    ctx.globalAlpha = focus ? 1 : .28;
    for (const base of nucleotides) for (const site of focus ? cpgSites : [undefined]) {
      ctx.strokeStyle = signalColors[base]; ctx.lineWidth = focus ? 1.3 : 1; ctx.beginPath();
      let started = false;
      for (const point of curves[base]) {
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < region.start || point.x > region.end ||
          (site !== undefined && (point.x < site - 2.5 || point.x > site + 2.5))) {
          started = false; continue;
        }
        const xx = site === undefined ? x(point.x) : focusPosition(point.x, site, region, width, x0, width - x1);
        if (started) ctx.lineTo(xx, y(point.y)); else ctx.moveTo(xx, y(point.y));
        started = true;
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  if (showMain) {
    comparison.groups.forEach((group, i) => {
      const { x, yy } = axes(full, top, mainHeight, `${group} · n=${comparison.counts[group]}`);
      for (const r of regions) {
        ctx.fillStyle = "rgba(235, 198, 134, .23)";
        ctx.fillRect(x(r.start), top + 28, x(r.end) - x(r.start), mainHeight - 65);
      }
      line(groupSeries(datasets, group), full, x, yy, colors[i % colors.length]);
      stars(full, x, top + 37);
      top += mainHeight;
    });
  }

  const zoomTop = top + (showMain && columns.length ? connectorHeight : 0);
  for (const { region, x: tileX, width: tileWidth } of columns) {
    const plotLeft = tileX + 50, plotRight = tileX + tileWidth - 18;
    const plotWidth = plotRight - plotLeft;
    const x = (value: number) => plotLeft + (value - region.start) / (region.end - region.start) * plotWidth;
    const yy = (value: number) => zoomTop + 167 - value * 126;
    if (showMain) {
      const sourceX = (value: number) => left + (value - full[0]) / (full[1] - full[0]) * (width - left - right);
      ctx.strokeStyle = "#acc5bc"; ctx.lineWidth = 1.5; ctx.beginPath();
      ctx.moveTo(sourceX(region.start), top - 23); ctx.lineTo(plotLeft, zoomTop + 8);
      ctx.moveTo(sourceX(region.end), top - 23); ctx.lineTo(plotRight, zoomTop + 8); ctx.stroke();
    }
    ctx.fillStyle = "#fbfdfc"; ctx.strokeStyle = "#dce9e5"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(tileX + 2, zoomTop + 5, tileWidth - 4, zoomHeight - 10, 9); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#2b4752"; ctx.font = "bold 17px sans-serif";
    ctx.fillText(region.name, tileX + 14, zoomTop + 27);
    ctx.font = "12px sans-serif";
    for (const tick of [0, .25, .5, .75, 1]) {
      const y = yy(tick);
      ctx.strokeStyle = "#ebf1ef"; ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(plotLeft, y); ctx.lineTo(plotRight, y); ctx.stroke();
      ctx.fillStyle = "#798e8f"; ctx.textAlign = "right";
      ctx.fillText(`${tick * 100}%`, plotLeft - 7, y + 4); ctx.textAlign = "left";
    }
    const bounds: Bounds = [region.start, region.end];
    comparison.groups.forEach((group, i) => line(groupSeries(datasets, group), bounds, x, yy, colors[i % colors.length]));
    stars(bounds, x, zoomTop + 40);
    ctx.fillStyle = "#6a7d86"; ctx.font = "13px sans-serif";
    ctx.fillText(`${Math.round(region.start)} bp`, plotLeft, zoomTop + zoomHeight - 19);
    ctx.textAlign = "right"; ctx.fillText(`${Math.round(region.end)} bp`, plotRight, zoomTop + zoomHeight - 19);
    ctx.textAlign = "left";

    if (showTraces) (traceRows.get(region.name) ?? []).forEach(({ trace, focus }, rowIndex) => {
      const rowTop = zoomTop + zoomHeight + rowIndex * traceHeight;
      ctx.fillStyle = "#2b4752"; ctx.font = "bold 13px sans-serif";
      ctx.fillText(`${region.name}区`, plotLeft + 5, rowTop + 20);
      if (!focus) {
        ctx.fillStyle = "#7d9292"; ctx.font = "13px sans-serif"; ctx.textAlign = "right";
        ctx.fillText(`Q ${trace.meanQ === null ? "—" : trace.meanQ.toFixed(1)}`, plotRight, rowTop + 20);
        ctx.textAlign = "left";
      } else {
        ctx.strokeStyle = "#aaccc2"; ctx.lineWidth = .8; ctx.setLineDash([2, 5]);
        trace.cpgSites.forEach((site) => { ctx.beginPath(); ctx.moveTo(x(site), zoomTop + 42);
          ctx.lineTo(x(site), rowTop + traceHeight - 16); ctx.stroke(); });
        ctx.setLineDash([]);
      }
      drawRegionalTrace(trace.curves, region, plotLeft, plotRight, rowTop, traceHeight, focus, trace.cpgSites);
    });
  }
  ctx.fillStyle = "#60747c"; ctx.font = "16px sans-serif";
  ctx.fillText("红色小星号：有独立重复时表示所选组的总体检验；否则仅表示观察差异。AB1 峰图按位点拼接并择优。", left, height - 37);
  return canvas;
}

export async function downloadReport(canvas: HTMLCanvasElement, format: "png" | "pdf", filename: string) {
  if (format === "png") {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("图片编码失败，请减少保存的区域数量后重试");
    saveBlob(blob, filename);
    return;
  }
  const { jsPDF } = await import("jspdf");
  const width = canvas.width * .75, height = canvas.height * .75;
  const pdf = new jsPDF({ orientation: height >= width ? "portrait" : "landscape", unit: "pt", format: [width, height], compress: true });
  pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, width, height);
  saveBlob(pdf.output("blob"), filename);
}
