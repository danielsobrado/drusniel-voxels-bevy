// Pins the GPU-shaped field core to the canonical f64 CPU field (terrain.ts). If this passes,
// the WGSL transliteration (shaders/terrain_field.wgsl) has a verified logic spec, so any GPU
// mismatch is precision/pipeline, not a port bug. Same f64 ops => exact equality expected.

import { describe, it, expect, afterEach } from "vitest";
import {
  surfaceHeight,
  density,
  surfaceNormal,
  replaceDigEdits,
  clearDigEdits,
  DigEdit,
} from "../terrain.js";
import {
  surfaceHeightCore,
  densityCore,
  densityGradientCore,
  resolveDigEdits,
} from "./terrain_field_core.js";

// A spread of coords: negatives, fractionals, and large values that exercise the massif cell
// offsets (x+4096, z-2048) and valley/region terms.
const XS = [-733.5, -64, 0, 0.25, 37.5, 128, 285.71, 1024.75, 4096, -4096.5];
const ZS = [-2048, -129.25, 0, 1.5, 96, 256.5, 911, 2047, -2049.75, 5000.25];

afterEach(() => clearDigEdits());

describe("terrain_field_core surfaceHeight parity", () => {
  it("matches canonical surfaceHeight exactly across the grid", () => {
    for (const x of XS) {
      for (const z of ZS) {
        expect(surfaceHeightCore(x, z)).toBe(surfaceHeight(x, z));
      }
    }
  });
});

describe("terrain_field_core density parity (no edits)", () => {
  it("matches canonical density exactly above and below the surface", () => {
    for (const x of XS) {
      for (const z of ZS) {
        const h = surfaceHeight(x, z);
        for (const dy of [-12, -2, -0.5, 0, 0.5, 4, 20]) {
          const y = h + dy;
          expect(densityCore(x, y, z, [])).toBe(density(x, y, z));
        }
      }
    }
  });
});

describe("terrain_field_core density parity (with edits)", () => {
  const edits: DigEdit[] = [
    { x: 0, y: 30, z: 0, r: 6 }, // sphere remove (defaults)
    { x: 37.5, y: 25, z: 96, r: 8, shape: "cube", op: "remove", height: 5 },
    { x: 128, y: 40, z: 256.5, r: 5, shape: "cylinder", op: "add", material: 2, strength: 0.6 },
    { x: -64, y: 20, z: 0, r: 7, op: "add", falloff: 0.4, strength: 0.8 },
  ];

  it("matches canonical density exactly with a mixed edit history", () => {
    replaceDigEdits(edits);
    const resolved = resolveDigEdits(edits);
    for (const x of XS) {
      for (const z of ZS) {
        const h = surfaceHeight(x, z);
        for (const dy of [-8, -1, 0, 1, 10, 30]) {
          const y = h + dy;
          expect(densityCore(x, y, z, resolved)).toBe(density(x, y, z));
        }
      }
    }
  });

  it("matches near each edit center where the brush dominates", () => {
    replaceDigEdits(edits);
    const resolved = resolveDigEdits(edits);
    for (const e of edits) {
      for (const off of [-3, -0.5, 0, 0.5, 3]) {
        const y = e.y + off;
        expect(densityCore(e.x, y, e.z, resolved)).toBe(density(e.x, y, e.z));
      }
    }
  });
});

describe("terrain_field_core gradient parity", () => {
  it("matches canonical surface normal at the surface across the grid", () => {
    for (const x of XS) {
      for (const z of ZS) {
        const h = surfaceHeightCore(x, z);
        const got = densityGradientCore(x, h, z, []);
        const want = surfaceNormal(x, z);
        expect(got[0]).toBe(want[0]);
        expect(got[1]).toBe(want[1]);
        expect(got[2]).toBe(want[2]);
      }
    }
  });
});
