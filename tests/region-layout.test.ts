import assert from "node:assert/strict";
import test from "node:test";
import { regionCanvasWidth, regionColumns } from "../src/region-layout";

test("widely separated regions remain fully inside the atlas without overlap", () => {
  const regions = [
    { name: "R03", start: -2900, end: -2800 },
    { name: "R01", start: 1000, end: 1100 },
    { name: "R02", start: 2500, end: 2600 },
  ];
  const width = regionCanvasWidth(regions.length);
  const columns = regionColumns(regions, [-3200, 3200], width, 66, 24);
  for (const column of columns) {
    assert.ok(column.x >= 66);
    assert.ok(column.x + column.width <= width - 24);
  }
  for (let index = 1; index < columns.length; index += 1) {
    assert.ok(columns[index - 1].x + columns[index - 1].width + 28 <= columns[index].x + 1e-9);
  }
});
