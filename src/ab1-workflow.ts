import { createCpgRows, mergeAnalysisResults, type AnalysisResult } from "./legacy-alignment";
import { fromCpgRows, type Dataset } from "./data";
import type { Read } from "./ab1";

export function mergeAb1Batches(reads: Read[], includedFiles: ReadonlySet<File>, reference: string, target: string):
  { datasets: Dataset[]; failures: string[] } {
  const batches = new Map<string, Read[]>();
  for (const read of reads.filter((item) => includedFiles.has(item.file))) {
    const key = `${read.group}\u0000${read.batch}`;
    batches.set(key, [...(batches.get(key) ?? []), read]);
  }
  const datasets: Dataset[] = [], failures: string[] = [];
  for (const [key, entries] of batches) {
    try {
      const [group, batch] = key.split("\u0000");
      const source: AnalysisResult = entries.length === 1 ? entries[0].result :
        mergeAnalysisResults(batch, entries.map((item) => item.result));
      const rows = createCpgRows(reference, [source], target);
      datasets.push(fromCpgRows(rows, group, batch, entries.map((item) => item.file.name).join(" + ")));
    } catch (e) { failures.push(`${key}：${e instanceof Error ? e.message : String(e)}`); }
  }
  return { datasets, failures };
}
