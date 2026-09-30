import type { Dataset } from "./data";
import type { Comparison } from "./statistics";
import { mergedRegionalLogo, regionBatches,
  type Read, type Region, type RegionalLogo, type RegionBatch } from "./ab1";
import { colors, fullBounds, groupSeries, type Bounds } from "./chart";
import { regionCanvasWidth, regionColumns } from "./region-layout";
import { logoColors, logoLetters, logoPlacements } from "./sequence-logo";

export type ReportPart = "combined" | "main" | "logo";
export type RegionSource = { reads: Read[]; reference: string; center: number | null;
  filterQ: boolean; minimumQ: number; focus: boolean };

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function reportCanvas(datasets: Dataset[], comparison: Comparison, regions: Region[], reads: Read[],
  reference: string, center: number | null, part: ReportPart = "combined",
  _trim = false, _qualityThreshold = 20, _windowSize = 20,
  regionSources: Record<string, RegionSource> = {}): Promise<HTMLCanvasElement> {
  const width = regionCanvasWidth(regions.length), left = 108, right = 64, header = 112, footer = 90;
  const full = fullBounds(datasets);
  const showMain = part !== "logo", showLogo = part !== "main";
  const mainHeight = 210, zoomHeight = 220, connectorHeight = 72, logoHeight = 125;
  const columns = regionColumns(regions, full, width, left, right);
  const logoRows = new Map<string, Array<{ batch: RegionBatch; logo: RegionalLogo; focus: boolean }>>();
  if (showLogo) for (const region of regions) {
    const source = regionSources[region.name] ?? { reads, reference, center, filterQ: false, minimumQ: 20, focus: true };
    if (source.center === null || !source.reference) continue;
    const rows: Array<{ batch: RegionBatch; logo: RegionalLogo; focus: boolean }> = [];
    for (const batch of regionBatches(source.reads)) {
      const logo = mergedRegionalLogo(batch.reads, source.reference, source.center, region,
        source.filterQ, source.minimumQ);
      rows.push({ batch, logo, focus: source.focus });
    }
    logoRows.set(region.name, rows);
  }
  const maxLogoRows = Math.max(0, ...columns.map(({ region }) => logoRows.get(region.name)?.length ?? 0));
  const height = header + (showMain ? comparison.groups.length * mainHeight + (columns.length ? connectorHeight : 0) : 0) +
    (columns.length ? zoomHeight : 0) + (showLogo ? maxLogoRows * logoHeight : 0) + footer;
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

    if (showLogo) (logoRows.get(region.name) ?? []).forEach(({ logo, focus }, rowIndex) => {
      const rowTop = zoomTop + zoomHeight + rowIndex * logoHeight;
      const baseline = rowTop + logoHeight - 18;
      const placements = logoPlacements(logo.columns, region, focus, plotLeft, plotRight);
      ctx.fillStyle = "#2b4752"; ctx.font = "bold 13px sans-serif";
      ctx.fillText(`${region.name}区`, plotLeft + 5, rowTop + 20);
      if (!focus) {
        ctx.fillStyle = "#7d9292"; ctx.font = "13px sans-serif"; ctx.textAlign = "right";
        ctx.fillText(`Q ${logo.meanQ === null ? "—" : logo.meanQ.toFixed(1)}`, plotRight, rowTop + 20);
        ctx.textAlign = "left";
      }
      ctx.strokeStyle = "#e5ebed"; ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(plotLeft, baseline); ctx.lineTo(plotRight, baseline); ctx.stroke();
      ctx.lineWidth = .8; ctx.setLineDash([2, 5]);
      for (const { anchor, x: logoX, emphasized } of placements) {
        if (!emphasized) continue;
        ctx.strokeStyle = "#aaccc2";
        ctx.beginPath(); ctx.moveTo(anchor, zoomTop + 42); ctx.lineTo(logoX, baseline); ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.save(); ctx.beginPath(); ctx.rect(plotLeft, rowTop, plotRight - plotLeft, logoHeight); ctx.clip();
      ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.font = "900 100px Arial, sans-serif";
      for (const { column, x: logoX, width: letterWidth, emphasized } of placements) {
        let bottom = baseline;
        ctx.globalAlpha = emphasized ? 1 : .22;
        for (const { base, fraction } of logoLetters(column)) {
          const glyphHeight = fraction * 70;
          if (glyphHeight >= 1) {
            ctx.save(); ctx.translate(logoX, bottom); ctx.scale(letterWidth / 72, glyphHeight / 73);
            ctx.fillStyle = logoColors[base]; ctx.fillText(base, 0, 0); ctx.restore();
          }
          bottom -= glyphHeight;
        }
      }
      ctx.restore(); ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    });
  }
  ctx.fillStyle = "#60747c"; ctx.font = "16px sans-serif";
  ctx.fillText("红色小星号：有独立重复时表示所选组的总体检验；否则仅表示观察差异。AB1 logo 按位点拼接并择优。", left, height - 37);
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
