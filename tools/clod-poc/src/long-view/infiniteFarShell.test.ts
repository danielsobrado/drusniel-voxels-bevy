import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  FAR_SHELL_PRIORITY_HEIGHT_OFFSET_M,
  FAR_SHELL_RENDER_ORDER,
  FAR_SHELL_WATER_RENDER_ORDER,
  InfiniteFarShell,
} from "./infiniteFarShell.js";
import { createFarShellMetrics } from "./farShellMetrics.js";
import { sampleMacroTerrainHeight, sampleMacroTerrainNormal, sampleMacroTerrainMaterial } from "./macroTerrain.js";
import type { FarHeightProvider } from "../far-summary/clipmap-sampler.js";
import type { FarTerrainUniformData } from "../farTerrain/farTerrainUniforms.js";
import { FarSummaryGpuAtlas } from "../naadf/gpu/farSummaryAtlas.js";

const FAKE_LIGHTING = {
  sunDirection: new THREE.Vector3(0.3, 0.8, 0.5).normalize(),
  sunColor: new THREE.Color(1, 0.95, 0.85),
  skyLight: new THREE.Color(0.4, 0.5, 0.65),
  groundLight: new THREE.Color(0.2, 0.18, 0.14),
};

const FAKE_PARITY_CONFIG: FarTerrainUniformData = {
  materialQuality: "horizon_proxy",
  materialQualityIndex: 3,
  waterlineM: 18,
  sandMaxHeightM: 24,
  grassMaxSlope: 0.5,
  dirtMaxSlope: 0.7,
  rockMinSlope: 0.75,
  snowMinHeightM: 120,
  snowMinSlope: 0.4,
  macroEnabled: 1,
  macroScale1: 300,
  macroScale2: 900,
  macroStrength: 0.2,
  macroSlopeStrength: 0.2,
  macroHeightStrength: 0.2,
  farNormalStrength: 1,
  farNormalFiniteDiffM: 4,
  farNormalFlattenStartM: 8192,
  farNormalFlattenEndM: 16384,
  hemiStrength: 0.6,
  sunStrength: 0.8,
  wrapLighting: 0.2,
  roughness: 0.9,
  ambientFloor: 0.15,
  hazeEnabled: 0,
  hazeStartM: 8192,
  hazeEndM: 16384,
  hazeColor: [0.7, 0.8, 1.0],
  hazeStrength: 0.4,
  hazeHeightFalloff: 0.01,
  shellInnerDropM: 0,
  normalBlendM: 256,
  materialBlendM: 256,
  pageToShellBlendM: 128,
  debugShowMaterialBands: 0,
  debugShowSlope: 0,
  debugShowMacroNoise: 0,
  debugShowFarNormals: 0,
  debugShowHazeFactor: 0,
  freezeMaterialLod: 0,
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

  it("shell is centered at snapped world position after camera movement", () => {
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
    expect(meshPos.x).toBe(10000);
    expect(meshPos.z).toBe(0);
    shell.dispose();
  });

  it("draws under CLOD terrain in the priority spill band", () => {
    const shell = new InfiniteFarShell(makeDefaultOptions());
    const material = shell.mesh.material as THREE.Material;

    expect(shell.mesh.renderOrder).toBe(FAR_SHELL_RENDER_ORDER);
    expect(material.polygonOffset).toBe(true);
    expect(material.polygonOffsetFactor).toBe(1);
    expect(material.polygonOffsetUnits).toBe(1);
    shell.dispose();
  });

  it("renders shell relative to floating-origin offset while sampling world center", () => {
    const metrics = createFarShellMetrics();
    const shell = new InfiniteFarShell({ ...makeDefaultOptions(), metrics });

    shell.setRenderOriginOffset(8192, -2048);
    shell.update(10000, -2000, 0);

    expect(metrics.farShellCenterX).toBe(10000);
    expect(metrics.farShellCenterZ).toBe(-2000);
    expect(metrics.farShellSnappedX).toBe(10000);
    expect(metrics.farShellSnappedZ).toBe(-2000);
    expect(shell.mesh.position.x).toBe(1808);
    expect(shell.mesh.position.z).toBe(48);
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

  it("keeps shell centered around camera after large movement", () => {
    const shell = new InfiniteFarShell(makeDefaultOptions());
    shell.update(10000, 0, 0);
    const centerWorld = shell.mesh.position.x;
    expect(centerWorld).toBe(10000);
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

  it("keeps useful work when the snap changes during a sliced rebuild", () => {
    const metrics = createFarShellMetrics();
    const shell = new InfiniteFarShell({
      ...makeDefaultOptions(),
      metrics,
      radialSegments: 96,
      angularSegments: 192,
      rebaseSnapMeters: 100,
      cpuRebuildBudgetMs: 0,
    });

    shell.update(0, 0, 0);
    const firstCursor = metrics.farShellRebuildCursor ?? 0;
    expect(metrics.farShellRebuildPending).toBe(1);
    shell.update(250, 0, 1);

    expect(metrics.farShellRebuildRestarts).toBe(0);
    expect(metrics.farShellRebuildCursor ?? 0).toBeGreaterThan(firstCursor);
    shell.dispose();
  });

  it("continues an initial pending rebuild instead of restarting it every frame", () => {
    const metrics = createFarShellMetrics();
    const shell = new InfiniteFarShell({
      ...makeDefaultOptions(),
      metrics,
      radialSegments: 96,
      angularSegments: 192,
      rebaseSnapMeters: 100,
      cpuRebuildBudgetMs: 0,
    });

    shell.update(0, 0, 0);
    const firstCursor = metrics.farShellRebuildCursor ?? 0;
    for (let frame = 1; frame <= 5; frame++) {
      shell.update(0, 0, frame);
    }

    expect(metrics.farShellRebuildRestarts).toBe(0);
    expect(metrics.farShellRebuildCursor ?? 0).toBeGreaterThan(firstCursor);
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

describe("infinite far shell — GPU mode validation", () => {
  it("fails loudly when GPU mode lacks required atlas inputs", () => {
    expect(() => new InfiniteFarShell({
      ...makeDefaultOptions(),
      heightSamplingMode: "gpu",
      useParityMaterial: true,
    })).toThrow(/GPU mode requires parity material, parity config, and a GPU far-summary atlas/);
  });

  it("defaults to GPU sampling when GPU inputs are present", () => {
    const atlas = new FarSummaryGpuAtlas({ tileCells: 4, ringCount: 1, tilesX: 1, tilesZ: 1 });
    const shell = new InfiniteFarShell({
      ...makeDefaultOptions(),
      useParityMaterial: true,
      parityConfig: FAKE_PARITY_CONFIG,
      farSummaryGpuAtlas: atlas.view,
    });

    expect(shell.mesh.children.some((child) => child.name === "naadf-far-water-overlay")).toBe(true);
    const water = shell.mesh.children.find((child) => child.name === "naadf-far-water-overlay") as THREE.Mesh | undefined;
    expect(water?.renderOrder).toBe(FAR_SHELL_WATER_RENDER_ORDER);
    expect(water!.renderOrder).toBeGreaterThan(shell.mesh.renderOrder);
    expect(water!.renderOrder).toBeLessThan(0);
    shell.dispose();
    atlas.view.texture.dispose();
    atlas.view.materialTexture.dispose();
    atlas.view.normalTexture.dispose();
    atlas.view.coverageTexture.dispose();
  });

  it("keeps explicit CPU sampling as a fallback override", () => {
    const atlas = new FarSummaryGpuAtlas({ tileCells: 4, ringCount: 1, tilesX: 1, tilesZ: 1 });
    const shell = new InfiniteFarShell({
      ...makeDefaultOptions(),
      useParityMaterial: true,
      parityConfig: FAKE_PARITY_CONFIG,
      farSummaryGpuAtlas: atlas.view,
      heightSamplingMode: "cpu",
    });

    expect(shell.mesh.children.some((child) => child.name === "naadf-far-water-overlay")).toBe(false);
    shell.dispose();
    atlas.view.texture.dispose();
    atlas.view.materialTexture.dispose();
    atlas.view.normalTexture.dispose();
    atlas.view.coverageTexture.dispose();
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
      expect(y).toBeCloseTo(50 + FAR_SHELL_PRIORITY_HEIGHT_OFFSET_M, 0);
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
