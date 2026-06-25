import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { InfiniteFarShell } from "./infiniteFarShell.js";
import { createFarShellMetrics } from "./farShellMetrics.js";
import { sampleMacroTerrainHeight, sampleMacroTerrainNormal, sampleMacroTerrainMaterial } from "./macroTerrain.js";
import type { FarHeightProvider } from "../far-summary/clipmap-sampler.js";

const FAKE_LIGHTING = {
  sunDirection: new THREE.Vector3(0.3, 0.8, 0.5).normalize(),
  sunColor: new THREE.Color(1, 0.95, 0.85),
  skyLight: new THREE.Color(0.4, 0.5, 0.65),
  groundLight: new THREE.Color(0.2, 0.18, 0.14),
};

function makeDefaultOptions() {
  return {
    innerMeters: 100,
    outerMeters: 1000,
    radialSegments: 8,
    angularSegments: 16,
    heightBiasMeters: 0,
    nearBlendMeters: 50,
    farFadeMeters: 100,
    macroBlendStartMeters: 500,
    macroBlendEndMeters: 1000,
    rebaseSnapMeters: 100,
    lighting: FAKE_LIGHTING,
  };
}

describe("infinite far shell — camera-relative annular geometry", () => {
  it("far shell radius is config-driven", () => {
    const shell1 = new InfiniteFarShell({ ...makeDefaultOptions(), outerMeters: 4096 });
    const pos = shell1.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    let maxR = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z);
      if (r > maxR) maxR = r;
    }
    expect(maxR).toBeGreaterThan(4000);
    expect(maxR).toBeLessThan(4200);
    shell1.dispose();

    const shell2 = new InfiniteFarShell({ ...makeDefaultOptions(), outerMeters: 16384 });
    const pos2 = shell2.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    let maxR2 = 0;
    for (let i = 0; i < pos2.count; i++) {
      const x = pos2.getX(i);
      const z = pos2.getZ(i);
      const r = Math.hypot(x, z);
      if (r > maxR2) maxR2 = r;
    }
    expect(maxR2).toBeGreaterThan(16000);
    expect(maxR2).toBeLessThan(16500);
    shell2.dispose();
  });

  it("shell is camera-relative — move camera 10000m, render coords stay local", () => {
    const shell = new InfiniteFarShell(makeDefaultOptions());
    shell.update(10000, 0, 0);

    const pos = shell.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    let hasLargeCoord = false;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getX(i)) > 2000 || Math.abs(pos.getZ(i)) > 2000) {
        hasLargeCoord = true;
      }
    }
    expect(hasLargeCoord).toBe(false);

    const meshPos = shell.mesh.position;
    expect(meshPos.x).toBeLessThan(100);
    expect(meshPos.z).toBeLessThan(100);
    shell.dispose();
  });

  it("shell does not rebuild every frame within snap threshold", () => {
    const metrics = createFarShellMetrics();
    const shell = new InfiniteFarShell({ ...makeDefaultOptions(), metrics, rebaseSnapMeters: 100 });

    shell.update(0, 0, 0);
    const rebuildsAfterFirst = metrics.farShellRebuilds;

    for (let i = 0; i < 50; i++) {
      shell.update(10, 5, i);
    }

    expect(metrics.farShellRebuilds).toBe(rebuildsAfterFirst);
    shell.dispose();
  });

  it("shell rebuilds after snap threshold is crossed", () => {
    const metrics = createFarShellMetrics();
    const shell = new InfiniteFarShell({ ...makeDefaultOptions(), metrics, rebaseSnapMeters: 100 });

    shell.update(0, 0, 0);
    const rebuildsBefore = metrics.farShellRebuilds;

    shell.update(250, 0, 0);

    expect(metrics.farShellRebuilds).toBeGreaterThan(rebuildsBefore);
    shell.dispose();
  });

  it("no finite-world border assumption — small CLOD world, shell still config radius", () => {
    const shell = new InfiniteFarShell({ ...makeDefaultOptions(), outerMeters: 8000 });
    const pos = shell.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    let maxR = 0;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getZ(i));
      if (r > maxR) maxR = r;
    }
    expect(maxR).toBeGreaterThan(7900);
    shell.dispose();
  });
});

describe("infinite far shell — height continuity and geometry", () => {
  it("emits non-empty mesh with indexed triangles", () => {
    const shell = new InfiniteFarShell(makeDefaultOptions());
    const geo = shell.mesh.geometry;
    const index = geo.getIndex();
    expect(index).not.toBeNull();
    expect(index!.count).toBeGreaterThan(0);
    const pos = geo.getAttribute("position");
    expect(pos.count).toBeGreaterThan(0);
    shell.dispose();
  });

  it("no NaN or absurd height jumps between adjacent vertices", () => {
    const shell = new InfiniteFarShell(makeDefaultOptions());
    shell.update(0, 0, 0);

    const pos = shell.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const maxJump = 200;
    for (let vi = 1; vi < pos.count; vi++) {
      const y = pos.getY(vi);
      expect(Number.isFinite(y)).toBe(true);
      expect(Math.abs(y)).toBeLessThan(200);
      const prevY = pos.getY(vi - 1);
      if (Number.isFinite(prevY)) {
        expect(Math.abs(y - prevY)).toBeLessThan(maxJump);
      }
    }
    shell.dispose();
  });

  it("bounding sphere is finite after update", () => {
    const shell = new InfiniteFarShell(makeDefaultOptions());
    shell.update(5000, 3000, 0);
    const sphere = shell.mesh.geometry.boundingSphere;
    expect(sphere).not.toBeNull();
    expect(sphere!.radius).toBeGreaterThan(0);
    expect(Number.isFinite(sphere!.center.x)).toBe(true);
    shell.dispose();
  });
});

describe("macro terrain fallback", () => {
  it("returns stable height for same coordinate", () => {
    const h1 = sampleMacroTerrainHeight(100, 200);
    const h2 = sampleMacroTerrainHeight(100, 200);
    expect(h1).toBe(h2);
  });

  it("returns finite height for any coordinate", () => {
    for (const [x, z] of [[0, 0], [-5000, 3000], [10000, -20000], [1e6, -1e6]]) {
      const h = sampleMacroTerrainHeight(x, z);
      expect(Number.isFinite(h)).toBe(true);
    }
  });

  it("returns smooth normal for any coordinate", () => {
    for (const [x, z] of [[0, 0], [5000, 5000], [-3000, 7000]]) {
      const n = sampleMacroTerrainNormal(x, z);
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
      expect(Number.isFinite(n.z)).toBe(true);
      const len = Math.hypot(n.x, n.y, n.z);
      expect(len).toBeGreaterThan(0.9);
      expect(len).toBeLessThan(1.1);
    }
  });

  it("returns plausible material index", () => {
    for (const [x, z] of [[0, 0], [5000, 5000], [-3000, 7000]]) {
      const m = sampleMacroTerrainMaterial(x, z);
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(3);
    }
  });
});

describe("infinite far shell — height provider integration", () => {
  it("works with a simple height provider", () => {
    const provider: FarHeightProvider = {
      sampleHeight: (_x: number, _z: number) => 50,
      sampleNormal: (_x: number, _z: number) => new THREE.Vector3(0, 1, 0),
      sampleMaterial: (_x: number, _z: number) => 0,
    };

    const shell = new InfiniteFarShell({
      ...makeDefaultOptions(),
      macroBlendStartMeters: 10000,
      macroBlendEndMeters: 20000,
    });
    shell.setHeightProvider(provider);

    const pos = shell.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      expect(Number.isFinite(y)).toBe(true);
      expect(y).toBeCloseTo(50, 0);
    }
    shell.dispose();
  });

  it("works without a height provider (macro terrain only)", () => {
    const shell = new InfiniteFarShell(makeDefaultOptions());
    shell.update(10000, 20000, 0);

    const pos = shell.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      expect(Number.isFinite(y)).toBe(true);
    }
    shell.dispose();
  });
});
