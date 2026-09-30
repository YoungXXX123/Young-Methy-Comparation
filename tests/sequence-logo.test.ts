import assert from "node:assert/strict";
import test from "node:test";
import { mergedRegionalLogo, type Read } from "../src/ab1";
import { mapToReference, type Base, type BaseProportion } from "../src/legacy-alignment";
import { logoPlacements } from "../src/sequence-logo";

const reference = "ACATCGTA";
const region = { name: "R01", start: 0, end: 7 };

function read(name: string, quality: number, changes: Record<number, Partial<BaseProportion>> = {}): Read {
  const proportions = [...reference].map((base, index) => ({
    calledBase: base as Base, A: base === "A" ? 1 : 0, C: base === "C" ? 1 : 0,
    G: base === "G" ? 1 : 0, T: base === "T" ? 1 : 0, ...changes[index],
  })) as BaseProportion[];
  return { file: new File([], name), group: "sample", batch: "batch-1",
    result: { name, ...mapToReference(reference, { sequence: reference, quality: Array(reference.length).fill(quality), proportions }) } };
}

test("regional AB1 logo keeps CpG focus separate from independent CpN analysis", () => {
  const sample = read("first.ab1", 30, {
    0: { A: .4, C: .2, G: .1, T: .3 },
    1: { A: .1, C: .6, G: .1, T: .2 },
    4: { A: .3, C: .35, G: .1, T: .25 },
  });
  const logo = mergedRegionalLogo([sample], reference, 0, region, false, 20);
  assert.equal(logo.columns.find((column) => column.index === 1)?.kind, "other");
  assert.equal(logo.columns.find((column) => column.index === 4)?.kind, "cpg");
  assert.ok(Math.abs(logo.columns[1].proportions.C - .6) < 1e-12);
  assert.ok(Math.abs(logo.columns[4].proportions.C - .35 / .6) < 1e-12);
  assert.deepEqual(logo.columns[0].proportions, { A: .4, C: .2, G: .1, T: .3 });
  assert.equal(logo.columns[1].proportions.A, .1);
  assert.equal(logo.columns[1].proportions.G, .1);

  assert.deepEqual(logoPlacements(logo.columns, region, true, 0, 420)
    .map(({ column }) => column.index), [4]);
  assert.equal(logoPlacements(logo.columns, region, false, 0, 420).length, reference.length);
});

test("logo follows higher-Q overlap and optional Phred filtering", () => {
  const first = read("low.ab1", 10, { 1: { A: .1, C: .7, G: .1, T: .1 } });
  const second = read("high.ab1", 35, { 1: { A: .6, C: .2, G: .1, T: .1 } });
  const merged = mergedRegionalLogo([first, second], reference, 0, region, false, 20);
  assert.equal(merged.columns.find((column) => column.index === 1)?.kind, "other");
  assert.equal(merged.columns.find((column) => column.index === 1)?.proportions.A, .6);
  assert.equal(mergedRegionalLogo([first], reference, 0, region, true, 20).columns.length, 0);
  assert.equal(mergedRegionalLogo([first, second], reference, 0, region, true, 20).columns.length, reference.length);
});
