import { describe, expect, it } from "vitest";
import configText from "../../../config/probe_gi.yaml?raw";
import { parseProbeGiConfig } from "./config.js";
import { probeGiExposedColumns, probeGiOriginForCamera } from "./clipmap_origin.js";

describe("probe GI clipmap origin", () => {
  const near = parseProbeGiConfig(configText).cascades[0];

  it("snaps only on whole cells", () => {
    const a = probeGiOriginForCamera(1, 1, near);
    const b = probeGiOriginForCamera(3.999, 3.999, near);
    const c = probeGiOriginForCamera(4.001, 1, near);
    expect(b).toEqual(a);
    expect(c.cellX).toBe(a.cellX + 1);
    expect(c.worldX % near.spacingM).toBeCloseTo(0);
  });

  it("returns only newly exposed columns after a one-cell move", () => {
    const a = probeGiOriginForCamera(1, 1, near);
    const b = probeGiOriginForCamera(4.001, 1, near);
    const exposed = probeGiExposedColumns(near, a, b);
    expect(exposed).toHaveLength(near.dimensions[2]);
    expect(new Set(exposed.map((column) => `${column.worldCellX},${column.worldCellZ}`)).size).toBe(exposed.length);
  });
});
