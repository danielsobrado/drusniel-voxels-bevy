import { describe, expect, it } from "vitest";
import { buildRock, ROCK_PRESETS, type RockPreset } from "./rock_builder.js";
import { Rng } from "./seed.js";

function positions(preset: RockPreset, seed: number, detail: number): number[] {
  return Array.from(buildRock(preset, new Rng(seed), detail).geometry.getAttribute("position").array);
}

describe("rock_builder", () => {
  it("is deterministic: same seed + preset + detail yields identical geometry", () => {
    const a = buildRock("boulder", new Rng(42), 2);
    const b = buildRock("boulder", new Rng(42), 2);
    expect(Array.from(a.geometry.getAttribute("position").array)).toEqual(
      Array.from(b.geometry.getAttribute("position").array),
    );
    expect(Array.from(a.geometry.getAttribute("vdata").array)).toEqual(
      Array.from(b.geometry.getAttribute("vdata").array),
    );
    expect(a.stats.tris).toBe(b.stats.tris);
  });

  it("differs for different seeds", () => {
    expect(positions("boulder", 1, 2)).not.toEqual(positions("boulder", 2, 2));
  });

  it("emits 20 * 4^detail triangles", () => {
    expect(buildRock("cobble", new Rng(7), 1).stats.tris).toBe(80);
    expect(buildRock("cobble", new Rng(7), 2).stats.tris).toBe(320);
    expect(buildRock("talus", new Rng(7), 3).stats.tris).toBe(1280);
  });

  it("carries a vec4 vdata attribute and a bounding sphere", () => {
    const built = buildRock("talus", new Rng(99), 2);
    const position = built.geometry.getAttribute("position");
    const vdata = built.geometry.getAttribute("vdata");
    expect(vdata.itemSize).toBe(4);
    expect(vdata.count).toBe(position.count);
    expect(built.geometry.boundingSphere).not.toBeNull();
    expect(built.geometry.boundingSphere!.radius).toBeGreaterThan(0);
  });

  it("exposes the full preset table including talus", () => {
    expect(Object.keys(ROCK_PRESETS)).toContain("talus");
    expect(Object.keys(ROCK_PRESETS)).toContain("cobble");
  });
});
