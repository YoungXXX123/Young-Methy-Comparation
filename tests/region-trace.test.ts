import assert from "node:assert/strict";
import test from "node:test";
import { cpgDistances, focusPosition, focusSegmentPosition, focusSegments, mergedSiteOwners, regionBatches, type Read } from "../src/ab1";
import { mapToReference, type Base, type BaseProportion } from "../src/legacy-alignment";

function sample(reference: string, name: string, batch: string, sequence: string, qualities: number[]): Read {
  const proportions = [...sequence].map((base) => ({ calledBase: base as Base,
    A: base === "A" ? 1 : 0, C: base === "C" ? 1 : 0,
    G: base === "G" ? 1 : 0, T: base === "T" ? 1 : 0 })) as BaseProportion[];
  return { file: new File([], name), group: "DNMT1", batch,
    result: { name, ...mapToReference(reference, { sequence, quality: qualities, proportions }) } };
}

test("region reads merge by group and batch; each overlapped base keeps the original algorithm's higher-Q read", () => {
  const reference = "TTTACGTCGATGGGCCGTAACGTTAAA";
  const first = sample(reference, "5p.ab1", "batch-1", "ACGTCGAT", [10, 40, 10, 30, 30, 30, 30, 30]);
  const overlap = sample(reference, "3p.ab1", "batch-1", "ACGTCGAT", [40, 10, 40, 30, 30, 30, 30, 30]);
  const next = sample(reference, "next.ab1", "batch-1", "CCGTAACG", Array(8).fill(35));
  const separate = sample(reference, "other-batch.ab1", "batch-2", "ACGTCGAT", Array(8).fill(35));
  const batches = regionBatches([first, overlap, next, separate]);
  assert.equal(batches.length, 2);
  assert.equal(batches[0].reads.length, 3);
  const { result, owners } = mergedSiteOwners(batches[0].reads);
  assert.equal(owners.get(3), overlap);
  assert.equal(owners.get(4), first);
  assert.equal(owners.get(5), overlap);
  assert.equal(owners.get(14), next);
  assert.equal(result.mappedQuality.get(3), 40);
  assert.equal(result.mappedQuality.get(4), 40);
  assert.equal(result.mappedIndices.length, 16);
  assert.ok(!owners.has(11));
});

test("focus identifies CpG C positions inside the selected region", () => {
  const sites = cpgDistances("AACGTTCCGAA", { name: "R02", start: -3, end: 3 }, 5);
  assert.deepEqual(sites.map((site) => site.distance), [-3, 2]);
});

test("horizontal-only focus stretch keeps each CpG anchored to the zoom plot", () => {
  const region = { name: "R02", start: -50, end: 50 };
  assert.equal(focusPosition(0, 0, region, 1000, 66, 24), 521);
  assert.equal(focusPosition(1, 0, region, 1000, 66, 24).toFixed(3), "537.380");
  assert.equal(focusPosition(-1, 0, region, 1000, 66, 24).toFixed(3), "504.620");
});

test("overlapping CpG windows become one continuous trace with 1.8x spacing and aligned guides", () => {
  const region = { name: "R02", start: -30, end: 40 };
  const segments = focusSegments([24, 6, 0], region);
  assert.deepEqual(segments.map((segment) => segment.sites), [[0, 6], [24]]);
  const first = segments[0], second = segments[1];
  const x0 = focusSegmentPosition(0, first, region, 1000, 66, 24);
  const x6 = focusSegmentPosition(6, first, region, 1000, 66, 24);
  assert.ok(Math.abs((x6 - x0) / (6 * 910 / 70) - 1.8) < 1e-12);
  assert.ok(focusSegmentPosition(first.end, first, region, 1000, 66, 24) <
    focusSegmentPosition(second.start, second, region, 1000, 66, 24));
});

test("dense focus stays inside the region instead of cropping edge peaks", () => {
  const region = { name: "R03", start: 0, end: 20 };
  const segment = focusSegments([1, 5, 9, 13, 17], region)[0];
  assert.deepEqual(segment.sites, [1, 5, 9, 13, 17]);
  assert.ok(focusSegmentPosition(segment.start, segment, region, 1000, 66, 24) >= 66);
  assert.ok(focusSegmentPosition(segment.end, segment, region, 1000, 66, 24) <= 976);
});
