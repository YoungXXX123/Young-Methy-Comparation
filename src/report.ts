import type { Dataset } from "./data";
import type { Comparison } from "./statistics";
import { FOCUS_SCALE, focusPosition, mergedRegionalTrace, regionBatches, type Read, type Region, type RegionalTrace, type RegionBatch, type TraceCurves } from "./ab1";
import { colors, fullBounds, groupSeries, type Bounds } from "./chart";

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
  const width = 1600, left = 108, right = 64, header = 112, footer = 90;
  const full = fullBounds(datasets);
  const showMain = part !== "traces", showTraces = part !== "main";
  const mainHeight = 210, zoomHeight = 230, traceHeight = 150;
  const traceRows: Array<{ region: Region; batch: RegionBatch; trace: RegionalTrace; focus: boolean; height: number }> = [];
  if (showTraces) for (const region of regions) {
    const source = regionSources[region.name] ?? { reads, reference, center, filterQ: false, minimumQ: 20, focus: false };
    if (source.center === null || !source.reference) continue;
    for (const batch of regionBatches(source.reads)) {
      const trace = await mergedRegionalTrace(batch.reads, source.reference, source.center, region,
        trim, qualityThreshold, windowSize, source.filterQ, source.minimumQ, source.focus);
      const height = source.focus ? 190 : traceHeight;
      traceRows.push({ region, batch, trace, focus: source.focus, height });
    }
  }
  const height = header + (showMain ? comparison.groups.length * mainHeight + regions.length * zoomHeight : 0) +
    traceRows.reduce((sum, row) => sum + row.height, 0) + footer;
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

  function drawTrace(curves: TraceCurves, bounds: Bounds, x0: number, y0: number, w: number, h: number) {
    let maximum = 1;
    for (const base of nucleotides) for (const point of curves[base]) {
      if (Number.isFinite(point.x) && point.x >= bounds[0] && point.x <= bounds[1] && Number.isFinite(point.y)) {
        maximum = Math.max(maximum, point.y);
      }
    }
    const x = (value: number) => x0 + (value - bounds[0]) / (bounds[1] - bounds[0]) * w;
    const y = (value: number) => y0 + h - 12 - value / maximum * (h - 25);
    ctx.strokeStyle = "#e5ebed"; ctx.lineWidth = 1; ctx.beginPath();
    ctx.moveTo(x0, y0 + h - 11); ctx.lineTo(x0 + w, y0 + h - 11); ctx.stroke();
    for (const base of nucleotides) {
      ctx.strokeStyle = signalColors[base]; ctx.lineWidth = 1.3; ctx.beginPath();
      let started = false;
      for (const point of curves[base]) {
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < bounds[0] || point.x > bounds[1]) {
          started = false; continue;
        }
        if (started) ctx.lineTo(x(point.x), y(point.y)); else ctx.moveTo(x(point.x), y(point.y));
        started = true;
      }
      ctx.stroke();
    }
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
    for (const r of regions) {
      const bounds: Bounds = [r.start, r.end];
      const { x, yy } = axes(bounds, top, zoomHeight, `${r.name} · ${r.start}–${r.end} bp · 放大甲基化比例`);
      comparison.groups.forEach((group, i) => line(groupSeries(datasets, group), bounds, x, yy, colors[i % colors.length]));
      stars(bounds, x, top + 37);
      comparison.groups.forEach((group, i) => {
        ctx.fillStyle = colors[i % colors.length]; ctx.font = "14px sans-serif";
        ctx.fillText(`● ${group}`, left + i * 270, top + zoomHeight - 46);
      });
      top += zoomHeight;
    }
  }

  if (showTraces) {
    for (const { region, batch, trace, focus, height: rowHeight } of traceRows) {
      ctx.fillStyle = "#2b4752"; ctx.font = "17px sans-serif";
      ctx.fillText(`${region.name} · ${batch.group} · ${batch.batch} · Q ${trace.meanQ === null ? "—" : trace.meanQ.toFixed(1)}`, left, top + 20);
      if (!trace.coveredBases || (focus && !trace.cpgSites.length)) {
        ctx.fillStyle = "#98a5aa"; ctx.font = "16px sans-serif";
        ctx.fillText("此区域没有可展示的测序信号", left + 420, top + 80);
      } else if (focus) {
        let maximum = 1;
        for (const base of nucleotides) for (const point of trace.curves[base]) {
          if (Number.isFinite(point.y)) maximum = Math.max(maximum, point.y);
        }
        const baseline = top + rowHeight - 20;
        ctx.strokeStyle = "#e5ebed"; ctx.beginPath(); ctx.moveTo(left, baseline); ctx.lineTo(width - right, baseline); ctx.stroke();
        trace.cpgSites.forEach((site) => {
          const anchor = left + (site - region.start) / (region.end - region.start) * (width - left - right);
          ctx.strokeStyle = "#e1e8e6"; ctx.lineWidth = 1; ctx.beginPath();
          ctx.moveTo(anchor, top + 28); ctx.lineTo(anchor, baseline); ctx.stroke();
          for (const base of nucleotides) {
            ctx.strokeStyle = signalColors[base]; ctx.lineWidth = 1.3; ctx.beginPath();
            let started = false;
            for (const point of trace.curves[base]) {
              if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < site - 2.5 || point.x > site + 2.5) {
                started = false; continue;
              }
              const x = focusPosition(point.x, site, region, width, left, right);
              const y = baseline - point.y / maximum * (traceHeight - 59) * FOCUS_SCALE;
              if (started) ctx.lineTo(x, y); else ctx.moveTo(x, y);
              started = true;
            }
            ctx.stroke();
          }
        });
      } else {
        drawTrace(trace.curves, [region.start, region.end], left, top + 27, width - left - right, traceHeight - 34);
      }
      top += rowHeight;
    }
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
