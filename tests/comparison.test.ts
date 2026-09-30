import assert from "node:assert/strict";
import test from "node:test";
import { analyzeDatasets, bh, oneWay } from "../src/statistics";
import { clampBounds } from "../src/chart";
import { fromCpgRows, tableRows, type Dataset } from "../src/data";
import { mergeAb1Batches } from "../src/ab1-workflow";
import { mapToReference, type Base, type BaseProportion } from "../src/legacy-alignment";
import type { Read } from "../src/ab1";

const make = (group: string, batch: number, values: Array<number | null>): Dataset => ({
  id: `${group}${batch}`, source: "table", file: `${group}${batch}.csv`, sheet: "", group, batch: `batch_${batch}`,
  rows: values.map((value, i) => ({ distance: i * 10, value })),
});

test("parses distance, ratios, percentages, and missing values", () => {
  const rows = tableRows([["DIstance_to_Target_center", "Average C"], [-10, "20%"], [0, "40%"], [10, "NA"]], "x.csv");
  assert.deepEqual(rows.map((r) => r.value), [.2, .4, null]);
  const percent = tableRows([["Distance_to_Target_Center", "Average_C_Ratio"], [0, 25], [10, 50]], "x.csv");
  assert.deepEqual(percent.map((r) => r.value), [.25, .5]);
  assert.throws(() => tableRows([["distance", "Average C"], [0, .1], [0, .2]], "x.csv"), /重复/);
});

test("original CpG table enters comparison without re-upload", () => {
  const created = fromCpgRows([{ targetNumber: 1, targetSequence: "ACG", targetStart: 0,
    position: 2, distance: 0, averageC: .42, measuredSamples: 1 }], "A", "batch_1", "read.ab1");
  const result = analyzeDatasets([created, make("B", 1, [.1])], ["A", "B"]);
  assert.ok(Math.abs(result.sites[0].differencePp! - 32) < 1e-9);
  assert.equal(result.sites[0].marked, true);
});

test("descriptive marker is strictly above 20 percentage points and has no P", () => {
  const a = make("A", 1, [.1, .2, null]);
  const b = make("B", 1, [.3, .401, .9]);
  const result = analyzeDatasets([a, b], ["A", "B"]);
  assert.deepEqual(result.sites.map((s) => s.marked), [false, true, false]);
  assert.ok(result.sites.every((s) => s.p === null));
});

test("Welch and ordinary ANOVA match SciPy, BH is global", () => {
  const groups = {
    A: [[.1, .2], [.15, .3], [.2, .4]],
    B: [[.7, .2], [.8, .3], [.9, .4]],
    C: [[.4, .2], [.45, .3], [.5, .4]],
  };
  const data = Object.entries(groups).flatMap(([group, rows]) => rows.map((values, i) => make(group, i + 1, values)));
  const welch = analyzeDatasets(data, ["A", "B", "C"]);
  const exact = oneWay([[.1, .15, .2], [.7, .8, .9], [.4, .45, .5]], "welch");
  assert.ok(exact);
  assert.ok(Math.abs(exact!.f - 51.3070866141732) < 1e-9);
  assert.ok(Math.abs(exact!.p - .001801795782889188) < 1e-10);
  assert.equal(welch.sites[0].marked, true);
  const ordinary = oneWay([[.1, .15, .2], [.7, .8, .9], [.4, .45, .5]], "anova");
  assert.ok(Math.abs(ordinary!.f - 63.5) < 1e-9);
  assert.ok(Math.abs(ordinary!.p - .00009181186897936254) < 1e-10);
  assert.deepEqual(bh([.001, .02, .03, .7, null]).map((x) => x === null ? null : Number(x.toFixed(3))), [.004, .04, .04, .7, null]);
});

test("duplicate batch names cannot inflate independent sample count", () => {
  assert.throws(() => analyzeDatasets([make("A", 1, [.1]), make("A", 1, [.2]), make("B", 1, [.4])], ["A", "B"]), /批次名称/);
});

test("main view never narrows below 50 bp", () => {
  assert.deepEqual(clampBounds(20, 30, [-100, 200]), [0, 50]);
  assert.deepEqual(clampBounds(180, 190, [-100, 200]), [150, 200]);
});

test("same-group AB1 reads form one batch table with higher-Q overlap", () => {
  const reference = "AACGTTCCGAA";
  const makeRead = (name: string, batch: string, c: number, quality: number): Read => {
    const proportions = [...reference].map((base) => ({ calledBase: base as Base,
      A: base === "A" ? 1 : 0, C: base === "C" ? 1 : 0,
      G: base === "G" ? 1 : 0, T: base === "T" ? 1 : 0 })) as BaseProportion[];
    proportions[2] = { calledBase: "C", A: 0, C: c, G: 0, T: 1 - c };
    const result = mapToReference(reference, { sequence: reference,
      quality: Array(reference.length).fill(quality), proportions });
    return { file: new File([], name), group: "DNMT3a", batch, result: { name, ...result } };
  };
  const low = makeRead("forward.ab1", "batch_1", .2, 20);
  const high = makeRead("reverse.ab1", "batch_1", .8, 40);
  const merged = mergeAb1Batches([low, high], new Set([low.file, high.file]), reference, "ACGTT");
  assert.deepEqual(merged.failures, []);
  assert.equal(merged.datasets.length, 1);
  assert.equal(merged.datasets[0].file, "DNMT3a_batch_1.csv");
  assert.equal(merged.datasets[0].rows.find((row) => row.position === 3)?.value, .8);
  const separate = mergeAb1Batches([low, { ...high, batch: "batch_2" }],
    new Set([low.file, high.file]), reference, "ACGTT");
  assert.equal(separate.datasets.length, 2);
});
