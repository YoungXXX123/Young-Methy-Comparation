import { localAlign, mergeAnalysisResults, parseAbi, trimLowQuality, type AnalysisResult, type Base } from "./legacy-alignment";

export type Read = { file: File; group: string; batch: string; result: AnalysisResult };
export type Region = { name: string; start: number; end: number };
export type TracePoint = { x: number; y: number };
export type TraceCurves = Record<Base, TracePoint[]>;
export type ChosenRead = { read: Read; score: number; coverage: number; meanQ: number; curves?: TraceCurves };
export type RegionBatch = { group: string; batch: string; reads: Read[] };
export type RegionalTrace = { curves: TraceCurves; cpgSites: number[]; meanQ: number | null; coveredBases: number };
export const FOCUS_SCALE = 1.35;

const bases: Base[] = ["A", "C", "G", "T"];
const complement: Record<Base, Base> = { A: "T", T: "A", C: "G", G: "C" };
const blankCurves = (): TraceCurves => Object.fromEntries(bases.map((base) => [base, [] as TracePoint[]])) as TraceCurves;

export function regionBatches(reads: Read[]): RegionBatch[] {
  const batches = new Map<string, RegionBatch>();
  for (const read of reads) {
    const key = `${read.group}\u0000${read.batch}`;
    const existing = batches.get(key);
    if (existing) existing.reads.push(read);
    else batches.set(key, { group: read.group, batch: read.batch, reads: [read] });
  }
  return [...batches.values()];
}

export function mergedSiteOwners(reads: Read[]): { result: AnalysisResult; owners: Map<number, Read> } {
  if (!reads.length) throw new Error("没有可拼接的 AB1 读段");
  const result = reads.length === 1 ? reads[0].result : mergeAnalysisResults(reads[0].batch, reads.map((read) => read.result));
  const owners = new Map<number, Read>();
  const selectedQuality = new Map<number, number>();
  for (const read of reads) {
    for (const index of read.result.mappedIndices) {
      if (!Number.isFinite(read.result.matrix.A[index])) continue;
      const incomingQuality = read.result.mappedQuality.get(index);
      const priorQuality = selectedQuality.get(index);
      const replace = !owners.has(index) || (Number.isFinite(incomingQuality) &&
        (!Number.isFinite(priorQuality) || Number(incomingQuality) > Number(priorQuality)));
      if (!replace) continue;
      owners.set(index, read);
      if (Number.isFinite(incomingQuality)) selectedQuality.set(index, Number(incomingQuality));
      else selectedQuality.delete(index);
    }
  }
  return { result, owners };
}

export function cpgDistances(reference: string, region: Region, center: number): Array<{ index: number; distance: number }> {
  const out: Array<{ index: number; distance: number }> = [];
  for (let index = 0; index < reference.length - 1; index += 1) {
    const distance = index - center;
    if (reference[index] === "C" && reference[index + 1] === "G" && distance >= region.start && distance <= region.end) {
      out.push({ index, distance });
    }
  }
  return out;
}

export function focusPosition(value: number, site: number, region: Region, width: number, left: number, right: number) {
  const base = (distance: number) => left + (distance - region.start) / (region.end - region.start) * (width - left - right);
  return base(site) + FOCUS_SCALE * (base(value) - base(site));
}

export async function mergedRegionalTrace(reads: Read[], reference: string, center: number, region: Region,
  trim: boolean, trimQ: number, windowSize: number, filterQ: boolean, minimumQ: number, focus: boolean): Promise<RegionalTrace> {
  const curves = blankCurves();
  if (!reads.length) return { curves, cpgSites: [], meanQ: null, coveredBases: 0 };
  const { result, owners } = mergedSiteOwners(reads);
  const cpg = cpgDistances(reference, region, center);
  const focusIndices = new Set(focus ? cpg.flatMap(({ index }) => [index - 2, index - 1, index, index + 1, index + 2]) : []);
  const selected = new Map<Read, Set<number>>();
  const qualities: number[] = [];
  const allowed = new Set<number>();
  for (const index of result.mappedIndices) {
    const distance = index - center;
    if (distance < region.start || distance > region.end || (focus && !focusIndices.has(index))) continue;
    const owner = owners.get(index);
    if (!owner) continue;
    const q = result.mappedQuality.get(index);
    if (filterQ && (!Number.isFinite(q) || Number(q) < minimumQ)) continue;
    if (Number.isFinite(q)) qualities.push(Number(q));
    allowed.add(index);
    if (!selected.has(owner)) selected.set(owner, new Set());
    selected.get(owner)!.add(index);
  }
  for (const read of reads) {
    const indices = selected.get(read);
    if (!indices?.size) continue;
    const piece = await chromatogram(read, reference, center, region, trim, trimQ, windowSize, indices);
    for (const base of bases) {
      if (curves[base].length) curves[base].push({ x: Number.NaN, y: Number.NaN });
      curves[base].push(...piece[base]);
    }
  }
  return { curves, cpgSites: cpg.filter(({ index }) => allowed.has(index)).map(({ distance }) => distance),
    meanQ: qualities.length ? qualities.reduce((sum, q) => sum + q, 0) / qualities.length : null,
    coveredBases: allowed.size };
}

function ascii(view: DataView, start: number, length: number): string {
  let result = "";
  for (let i = 0; i < length; i += 1) {
    const code = view.getUint8(start + i);
    if (code) result += String.fromCharCode(code);
  }
  return result;
}

type Entry = { number: number; offset: number; size: number; count: number; elementSize: number; tag: string };
function numbers(view: DataView, entry: Entry): number[] {
  const start = entry.size <= 4 ? entry.offset + 20 : view.getUint32(entry.offset + 20, false);
  const count = Math.min(entry.count, Math.floor(entry.size / entry.elementSize));
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const offset = start + i * entry.elementSize;
    if (offset + entry.elementSize > view.byteLength) throw new Error("AB1 信号数据不完整");
    out.push(entry.elementSize === 1 ? view.getUint8(offset) : entry.elementSize === 2 ? view.getUint16(offset, false) : view.getInt32(offset, false));
  }
  return out;
}

export function rawTrace(buffer: ArrayBuffer): { peaks: number[]; channels: Record<Base, number[]> } {
  const view = new DataView(buffer);
  if (view.byteLength < 34 || ascii(view, 0, 4) !== "ABIF") throw new Error("不是有效 AB1 文件");
  const rootOffset = view.getUint32(6 + 20, false);
  const entries = new Map<string, Entry>();
  const count = view.getUint32(6 + 12, false);
  if (rootOffset + count * 28 > view.byteLength) throw new Error("AB1 目录不完整");
  for (let i = 0; i < count; i += 1) {
    const offset = rootOffset + i * 28;
    const tag = ascii(view, offset, 4);
    const number = view.getUint32(offset + 4, false);
    entries.set(`${tag}${number}`, { tag, number, offset, size: view.getUint32(offset + 16, false),
      count: view.getUint32(offset + 12, false), elementSize: view.getUint16(offset + 10, false) });
  }
  const peakEntry = entries.get("PLOC2") ?? entries.get("PLOC1");
  const orderEntry = entries.get("FWO_1");
  if (!peakEntry || !orderEntry) throw new Error("AB1 缺少峰位置或通道信息");
  const orderStart = orderEntry.size <= 4 ? orderEntry.offset + 20 : view.getUint32(orderEntry.offset + 20, false);
  const order = ascii(view, orderStart, orderEntry.size).slice(0, 4);
  if (new Set(order).size !== 4 || !bases.every((base) => order.includes(base))) throw new Error("AB1 通道顺序无效");
  const channels = {} as Record<Base, number[]>;
  for (let i = 0; i < 4; i += 1) {
    const entry = entries.get(`DATA${9 + i}`);
    if (!entry) throw new Error(`AB1 缺少 DATA${9 + i}`);
    channels[order[i] as Base] = numbers(view, entry);
  }
  return { peaks: numbers(view, peakEntry), channels };
}

function trimStart(quality: number[], threshold: number, windowSize: number): number {
  if (!quality.length || quality.length < windowSize) return 0;
  for (let i = 0; i < quality.length - windowSize; i += 1) {
    const average = quality.slice(i, i + windowSize).reduce((a, b) => a + b, 0) / windowSize;
    if (average >= threshold) return i;
  }
  return 0;
}

export function regionalQuality(read: Read, region: Region, center: number): Omit<ChosenRead, "read"> | null {
  const expected = Math.max(1, Math.floor(region.end + center) - Math.ceil(region.start + center) + 1);
  const positions = [...new Set(read.result.mappedIndices.filter((i) => region.start <= i - center && i - center <= region.end))];
  const qualities = positions.map((i) => read.result.mappedQuality.get(i)).filter((q): q is number => q !== undefined && Number.isFinite(q));
  const coverage = Math.min(1, positions.length / expected);
  if (coverage < 0.8 || qualities.length < positions.length || !qualities.length) return null;
  const meanQ = qualities.reduce((a, b) => a + b, 0) / qualities.length;
  if (meanQ < 15) return null;
  const q20 = qualities.filter((q) => q >= 20).length / qualities.length;
  return { coverage, meanQ, score: 100 * coverage + 20 * q20 + Math.min(meanQ, 60) / 3 };
}

export function chooseRead(reads: Read[], group: string, region: Region, center: number): ChosenRead | null {
  const candidates = reads.filter((read) => read.group === group).flatMap((read) => {
    const quality = regionalQuality(read, region, center);
    return quality ? [{ read, ...quality }] : [];
  });
  candidates.sort((a, b) => b.score - a.score || a.read.file.name.localeCompare(b.read.file.name));
  return candidates[0] ?? null;
}

export async function chromatogram(read: Read, reference: string, center: number, region: Region,
  trim: boolean, qualityThreshold: number, windowSize: number, selectedIndices?: ReadonlySet<number>): Promise<TraceCurves> {
  const buffer = await read.file.arrayBuffer();
  const record = parseAbi(buffer);
  const trimmed = trim ? trimLowQuality(record, qualityThreshold, windowSize) : record;
  const start = trim ? trimStart(record.quality, qualityThreshold, windowSize) : 0;
  const reverse = read.result.orientation === "reverse";
  const query = reverse ? [...trimmed.sequence].reverse().map((base) =>
    ({ A: "T", T: "A", C: "G", G: "C", N: "N" })[base as Base | "N"] ?? "N").join("") : trimmed.sequence;
  const pairs = localAlign(reference, query).pairs;
  const { peaks, channels } = rawTrace(buffer);
  const curves = blankCurves();
  let lastReference = -10, lastQuery = -10;
  for (const [refIndex, queryIndex] of pairs) {
    const distance = refIndex - center;
    if (distance < region.start - 1 || distance > region.end + 1) continue;
    if (selectedIndices && !selectedIndices.has(refIndex)) continue;
    const rawIndex = reverse ? start + trimmed.sequence.length - 1 - queryIndex : start + queryIndex;
    const peak = peaks[rawIndex];
    if (!Number.isFinite(peak)) continue;
    const previous = peaks[rawIndex - 1] ?? peak - 8;
    const next = peaks[rawIndex + 1] ?? peak + 8;
    const spacing = Math.max(2, (next - previous) / 2);
    const left = Math.max(0, Math.round((previous + peak) / 2));
    const right = Math.min(channels.A.length - 1, Math.round((peak + next) / 2));
    if (lastReference !== refIndex - 1 || lastQuery !== queryIndex - 1) {
      bases.forEach((base) => curves[base].push({ x: Number.NaN, y: Number.NaN }));
    }
    for (let scan = left; scan <= right; scan += Math.max(1, Math.floor(spacing / 5))) {
      const x = distance + (reverse ? -1 : 1) * (scan - peak) / spacing;
      if (x < region.start || x > region.end) continue;
      for (const base of bases) {
        const rawBase = reverse ? complement[base] : base;
        curves[base].push({ x, y: Math.max(0, channels[rawBase][scan] ?? 0) });
      }
    }
    lastReference = refIndex;
    lastQuery = queryIndex;
  }
  return curves;
}
