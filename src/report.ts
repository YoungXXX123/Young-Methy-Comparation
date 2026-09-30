import type { Dataset } from "./data";
import type { Comparison } from "./statistics";
import { chooseRead, chromatogram, type Read, type Region } from "./ab1";
import { colors, fullBounds, groupSeries, type Bounds } from "./chart";

export type ReportPart = "combined" | "main" | "traces";
export type RegionSource = { reads: Read[]; reference: string; center: number | null };
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
  const height = header + (showMain ? comparison.groups.length * mainHeight + regions.length * zoomHeight : 0) +
    (showTraces ? regions.length * comparison.groups.length * traceHeight : 0) + footer;
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
    for (const r of regions) {
      const source = regionSources[r.name] ?? { reads, reference, center };
      for (const group of comparison.groups) {
        const chosen = source.center !== null ? chooseRead(source.reads, group, r, source.center) : null;
        ctx.fillStyle = "#2b4752"; ctx.font = "17px sans-serif";
        ctx.fillText(`${r.name} · ${r.start}–${r.end} bp · ${group}${chosen ? ` · ${chosen.read.file.name} · Q ${chosen.meanQ.toFixed(1)} · 覆盖 ${(chosen.coverage * 100).toFixed(0)}%` : ""}`, left, top + 20);
        ctx.strokeStyle = "#e5ebed"; ctx.beginPath(); ctx.moveTo(left, top + traceHeight - 18);
        ctx.lineTo(width - right, top + traceHeight - 18); ctx.stroke();
        if (!chosen || !source.reference) {
          ctx.fillStyle = "#98a5aa"; ctx.font = "16px sans-serif";
          ctx.fillText("尚无覆盖此区域且通过质控的 AB1 原始峰图", left + 420, top + 80);
        } else {
          const curves = await chromatogram(chosen.read, source.reference, source.center!, r, trim, qualityThreshold, windowSize);
          let maximum = 1;
          for (const base of nucleotides) for (const point of curves[base]) {
            if (Number.isFinite(point.y)) maximum = Math.max(maximum, point.y);
          }
          const x = (value: number) => left + (value - r.start) / (r.end - r.start) * (width - left - right);
          const y = (value: number) => top + traceHeight - 20 - value / maximum * (traceHeight - 55);
          for (const base of nucleotides) {
            ctx.strokeStyle = signalColors[base]; ctx.lineWidth = 1.2; ctx.beginPath();
            let started = false;
            for (const point of curves[base]) {
              if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) { started = false; continue; }
              if (started) ctx.lineTo(x(point.x), y(point.y)); else ctx.moveTo(x(point.x), y(point.y));
              started = true;
            }
            ctx.stroke();
          }
        }
        top += traceHeight;
      }
    }
  }
  ctx.fillStyle = "#60747c"; ctx.font = "16px sans-serif";
  ctx.fillText("红色小星号：有独立重复时表示所选组的总体检验；否则仅表示观察差异。AB1 为所选代表性读段。", left, height - 37);
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
