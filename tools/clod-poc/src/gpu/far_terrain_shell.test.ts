import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildFarTerrainShell, type FarShellLighting } from "./far_terrain_shell.js";
import { buildTerrainSummary } from "../clod/terrain_summary.js";

const lighting: FarShellLighting = {
  sunDirection: new THREE.Vector3(0.3, 0.8, 0.5).normalize(),
  sunColor: new THREE.Color(1, 0.95, 0.85),
  skyLight: new THREE.Color(0.4, 0.5, 0.65),
  groundLight: new THREE.Color(0.2, 0.18, 0.14),
};

describe("far terrain shell — horizon skirt around the world", () => {
  const worldSize = 100;
  // Empty page set → every summary cell falls back to the analytic field; the skirt is what we
  // are testing, not page coverage.
  const summary = buildTerrainSummary([], worldSize, 8);
  const inset = worldSize * 0.04; // matches the buildFarTerrainShell default
  const shell = buildFarTerrainShell(summary, lighting, { gridRes: 32 });

  const index = shell.mesh.geometry.getIndex();
  const position = shell.mesh.geometry.getAttribute("position");

  it("emits a non-empty skirt mesh", () => {
    expect(index).not.toBeNull();
    expect(shell.triangleCount).toBeGreaterThan(0);
    expect(index!.count).toBe(shell.triangleCount * 3);
  });

  it("excludes the page-owned world interior: no triangle lies fully inside [inset, worldSize-inset]²", () => {
    const idx = index!;
    const insideInterior = (vi: number): boolean => {
      const x = position.getX(vi);
      const z = position.getZ(vi);
      return x > inset && x < worldSize - inset && z > inset && z < worldSize - inset;
    };
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t);
      const b = idx.getX(t + 1);
      const c = idx.getX(t + 2);
      const allInside = insideInterior(a) && insideInterior(b) && insideInterior(c);
      expect(allInside).toBe(false);
    }
  });

  it("extends beyond the world edge (some vertices lie past worldSize)", () => {
    let beyond = 0;
    for (let vi = 0; vi < position.count; vi++) {
      const x = position.getX(vi);
      const z = position.getZ(vi);
      if (x > worldSize || z > worldSize || x < 0 || z < 0) beyond++;
    }
    expect(beyond).toBeGreaterThan(0);
  });
});
