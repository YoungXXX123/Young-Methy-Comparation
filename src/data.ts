import * as XLSX from "xlsx";
import type { CpgRow } from "./legacy-alignment";

export type SiteValue = { distance: number; value: number | null; position?: number };
export type Dataset = {
  id: string;
  source: "table" | "AB1";
  file: string;
  sheet: string;
  group: string;
  batch: string;
  rows: SiteValue[];
};

const headerKey = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
const averageHeaders = new Set(["averagec", "averagecratio", "avgc", "meancratio", "methylationratio", "甲基化比例"]);

function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || String(value).toUpperCase() === "NA") return null;
  const raw = String(value).trim();
  const number = Number(raw.endsWith("%") ? raw.slice(0, -1) : raw);
  if (!Number.isFinite(number)) return null;
  return number;
}

export function tableRows(grid: unknown[][], label: string): SiteValue[] {
  if (grid.length < 2) throw new Error(`${label}：表格没有数据行`);
  const header = grid[0].map(headerKey);
  const x = header.findIndex((key) => key.includes("distance") || key.includes("距离"));
  const y = header.findIndex((key) => averageHeaders.has(key));
  const position = header.findIndex((key) => key === "cpgposition");
  if (x < 0 || y < 0) throw new Error(`${label}：找不到 Distance 和 Average C 列`);
  const parsed = grid.slice(1).filter((row) => row.some((cell) => cell !== null && cell !== undefined && cell !== ""))
    .map((row) => {
      const distance = Number(row[x]);
      if (!Number.isFinite(distance)) throw new Error(`${label}：distance 必须是数字`);
      const value = parseNumber(row[y]);
      const point = position >= 0 && Number.isFinite(Number(row[position])) ? Number(row[position]) : undefined;
      return { distance, value, position: point, explicitPercent: String(row[y] ?? "").trim().endsWith("%") };
    });
  if (!parsed.length) throw new Error(`${label}：没有可用数据`);
  if (new Set(parsed.map((row) => row.distance)).size !== parsed.length) throw new Error(`${label}：存在重复 distance`);
  const isPercent = parsed.some((row) => row.value !== null && !row.explicitPercent && row.value > 1);
  for (const row of parsed) {
    if (row.value === null) continue;
    if (isPercent || row.explicitPercent) row.value /= 100;
    if (row.value < 0 || row.value > 1) throw new Error(`${label}：Average C 必须位于 0–1 或 0–100%`);
  }
  return parsed.map(({ distance, value, position }) => ({ distance, value, position })).sort((a, b) => a.distance - b.distance);
}

export async function readSpreadsheet(file: File): Promise<Dataset[]> {
  const lower = file.name.toLowerCase();
  if (!/\.(csv|tsv|xlsx|xls)$/.test(lower)) throw new Error(`${file.name}：仅支持 CSV、TSV、XLSX、XLS`);
  if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name}：单个文件超过 20 MB`);
  const workbook = /\.(csv|tsv)$/.test(lower)
    ? XLSX.read(await file.text(), { type: "string", FS: lower.endsWith(".tsv") ? "\t" : "," })
    : XLSX.read(await file.arrayBuffer(), { type: "array" });
  const stem = file.name.replace(/\.[^.]+$/, "");
  return workbook.SheetNames.flatMap((sheet, index) => {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheet], { header: 1, defval: null, raw: false });
    if (!grid.length) return [];
    const rows = tableRows(grid, `${file.name} / ${sheet}`);
    return [{ id: `${file.name}:${file.size}:${file.lastModified}:${index}`, source: "table" as const,
      file: file.name, sheet, group: stem, batch: `${stem}${workbook.SheetNames.length > 1 ? `_${sheet}` : ""}`, rows }];
  });
}

export function fromCpgRows(rows: CpgRow[], group: string, batch: string, file: string): Dataset {
  if (new Set(rows.map((r) => r.targetNumber)).size > 1) throw new Error("请一次选择一个靶序列，避免不同靶点使用相同 distance");
  return { id: `AB1:${group}:${batch}`, source: "AB1", file, sheet: "", group, batch,
    rows: rows.map((r) => ({ distance: r.distance, value: r.averageC, position: r.position })) };
}

export function datasetCsv(dataset: Dataset): string {
  const lines = ["CpG_Position,Distance_to_Target_Center,Average_C_Ratio,Measured_Samples"];
  for (const row of dataset.rows) lines.push(`${row.position ?? ""},${row.distance},${row.value === null ? "" : row.value.toFixed(6)},${row.value === null ? 0 : 1}`);
  return `\uFEFF${lines.join("\n")}`;
}
