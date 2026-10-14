import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { drawTargetMark, locateTarget, TargetMark, visibleTarget } from "../src/target-marker";

test("named targets preserve half-base centers and clip correctly when a region excludes the center", () => {
  const target = locateTarget("TTACGTG", "ACGT", " 位点 α ");
  assert.deepEqual(target, { name: "位点 α", start: -1.5, end: 1.5, referenceStart: 3, referenceEnd: 6 });
  assert.deepEqual(visibleTarget(target, [1, 50]), { start: 1, end: 2, showCenter: false });
  assert.equal(visibleTarget(target, [3, 50]), null);
  assert.equal(locateTarget("ACGTACGT", "ACGT", "重复靶点"), null);
  assert.equal(locateTarget("TTACGTG", "ACGT", " ")?.name, "靶点");
});

test("SVG and canvas annotations use the same visible target interval and name", () => {
  const target = locateTarget("TTACGTG", "ACGT", "位点 α");
  const options = { target, bounds: [-50, 50] as const, left: 50, right: 1050, top: 40, bottom: 140, labelY: 25 };
  const svg = renderToStaticMarkup(createElement(TargetMark, options));
  assert.match(svg, /位点 α/);
  assert.match(svg, /3–6 bp/);
  assert.match(svg, /x="530".*width="40"/);
  const rects: number[][] = [], labels: string[] = [];
  const context = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, setLineDash() {},
    fillRect(...values: number[]) { rects.push(values); }, fillText(value: string) { labels.push(value); } };
  drawTargetMark(context as unknown as CanvasRenderingContext2D, options);
  assert.deepEqual(rects, [[530, 40, 40, 100]]);
  assert.deepEqual(labels, ["位点 α · 3–6 bp"]);
  assert.equal(renderToStaticMarkup(createElement(TargetMark, { ...options, bounds: [20, 70] })), "");
});
