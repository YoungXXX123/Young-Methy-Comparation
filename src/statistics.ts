import type { Dataset } from "./data";

export type Method = "welch" | "anova";
export type Marking = "p" | "q";
export type SiteStat = { distance: number; differencePp: number | null; p: number | null; q: number | null;
  f: number | null; status: string; marked: boolean };
export type Comparison = { groups: string[]; compared: string[]; counts: Record<string, number>;
  inferential: boolean; sites: SiteStat[]; method: Method; marking: Marking; threshold: number };

const lanczos = [0.9999999999998099, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.984369578019572e-6,
  1.5056327351493116e-7];

function logGamma(z: number): number {
  if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = lanczos[0];
  for (let i = 1; i < lanczos.length; i += 1) x += lanczos[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function betaFraction(a: number, b: number, x: number): number {
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - (a + b) * x / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 500; m += 1) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const change = d * c;
    h *= change;
    if (Math.abs(change - 1) < 3e-14) break;
  }
  return h;
}

function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const factor = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x));
  if (x < (a + 1) / (a + b + 2)) return factor * betaFraction(a, b, x) / a;
  return 1 - factor * betaFraction(b, a, 1 - x) / b;
}

export function fSurvival(f: number, df1: number, df2: number): number {
  if (f === Infinity) return 0;
  if (!(f >= 0 && df1 > 0 && df2 > 0)) return Number.NaN;
  return Math.max(0, Math.min(1, regularizedBeta(df2 / (df2 + df1 * f), df2 / 2, df1 / 2)));
}

export function bh(values: Array<number | null>): Array<number | null> {
  const valid = values.map((p, index) => ({ p, index })).filter((v): v is {p:number;index:number} => v.p !== null && Number.isFinite(v.p));
  valid.sort((a, b) => a.p - b.p);
  const result: Array<number | null> = Array(values.length).fill(null);
  let best = 1;
  for (let i = valid.length - 1; i >= 0; i -= 1) {
    best = Math.min(best, valid[i].p * valid.length / (i + 1));
    result[valid[i].index] = best;
  }
  return result;
}

function variance(values: number[], mean: number): number {
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
}

export function oneWay(values: number[][], method: Method): { f: number; p: number } | null {
  if (values.length < 2 || values.some((group) => group.length < 3)) return null;
  const k = values.length;
  const n = values.map((group) => group.length);
  const means = values.map((group) => group.reduce((a, b) => a + b, 0) / group.length);
  const variances = values.map((group, i) => variance(group, means[i]));
  if (method === "welch") {
    if (variances.some((v) => !(v > 0))) return null;
    const weights = variances.map((v, i) => n[i] / v);
    const sumWeights = weights.reduce((a, b) => a + b, 0);
    const center = weights.reduce((sum, w, i) => sum + w * means[i], 0) / sumWeights;
    const correction = weights.reduce((sum, w, i) => sum + (1 - w / sumWeights) ** 2 / (n[i] - 1), 0);
    const f = weights.reduce((sum, w, i) => sum + w * (means[i] - center) ** 2, 0) /
      ((k - 1) * (1 + 2 * (k - 2) * correction / (k * k - 1)));
    return { f, p: fSurvival(f, k - 1, (k * k - 1) / (3 * correction)) };
  }
  const total = n.reduce((a, b) => a + b, 0);
  const center = means.reduce((sum, mean, i) => sum + mean * n[i], 0) / total;
  const between = means.reduce((sum, mean, i) => sum + n[i] * (mean - center) ** 2, 0);
  const within = variances.reduce((sum, v, i) => sum + (n[i] - 1) * v, 0);
  if (!within && !between) return null;
  const f = within ? (between / (k - 1)) / (within / (total - k)) : Infinity;
  return { f, p: fSurvival(f, k - 1, total - k) };
}

export function analyzeDatasets(datasets: Dataset[], compared: string[], threshold = 20,
  method: Method = "welch", marking: Marking = "p"): Comparison {
  if (!(Number.isFinite(threshold) && threshold >= 0 && threshold <= 100)) throw new Error("观察差值阈值应位于 0–100 个百分点");
  const batchKeys = datasets.map((d) => `${d.group.trim()}\u0000${d.batch.trim()}`);
  if (datasets.some((d) => !d.group.trim() || !d.batch.trim()) || new Set(batchKeys).size !== batchKeys.length) {
    throw new Error("每个条件组的独立批次名称必须唯一；同批次的 AB1 请先合并生成一张表");
  }
  const groups = [...new Set(datasets.map((d) => d.group).filter(Boolean))];
  if (new Set(compared).size < 2 || compared.some((group) => !groups.includes(group))) {
    throw new Error("请至少选择两个已有条件组");
  }
  const counts = Object.fromEntries(groups.map((group) => [group, datasets.filter((d) => d.group === group).length]));
  const inferential = compared.every((group) => counts[group] >= 3);
  const positions = [...new Set(datasets.flatMap((dataset) => dataset.rows.map((row) => row.distance)))].sort((a, b) => a - b);
  const lookup = datasets.map((dataset) => new Map(dataset.rows.map((row) => [row.distance, row.value])));
  const sites = positions.map((distance): SiteStat => {
    const vectors = compared.map((group) => datasets.flatMap((dataset, index) => {
      const value = dataset.group === group ? lookup[index].get(distance) : null;
      return value === null || value === undefined || !Number.isFinite(value) ? [] : [value];
    }));
    if (vectors.some((v) => !v.length)) return { distance, differencePp: null, p: null, q: null, f: null, status: "missing", marked: false };
    const means = vectors.map((v) => v.reduce((a, b) => a + b, 0) / v.length);
    const differencePp = 100 * (Math.max(...means) - Math.min(...means));
    if (!inferential) return { distance, differencePp, p: null, q: null, f: null, status: "observed", marked: false };
    if (vectors.some((v) => v.length < 3)) return { distance, differencePp, p: null, q: null, f: null,
      status: "insufficient_valid_replicates", marked: false };
    const test = oneWay(vectors, method);
    return { distance, differencePp, p: test?.p ?? null, q: null, f: test?.f ?? null,
      status: test ? "tested" : "untestable_variance", marked: false };
  });
  const adjusted = bh(sites.map((site) => site.p));
  sites.forEach((site, index) => {
    site.q = adjusted[index];
    site.marked = inferential ? (site[marking] !== null && site[marking]! < 0.05)
      : (site.differencePp !== null && site.differencePp > threshold + 1e-9);
  });
  return { groups, compared, counts, inferential, sites, method, marking, threshold };
}
