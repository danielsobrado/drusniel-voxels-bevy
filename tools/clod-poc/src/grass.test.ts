import { describe, expect, it, afterEach } from "vitest";
import {
  DEFAULT_GRASS_SHADER_MODE,
  DEFAULT_GRASS_SETTINGS,
  GRASS_SHADER_MODES,
  acceptsGrassCandidate,
  buildGrassGpuCandidateBuffer,
  generateGrassRingInstances,
  generateGrassInstances,
  grassThin,
  sampleGrassTerrainSite,
  type GrassTerrainSite,
  type GrassSettings,
} from "./grass.js";
import { addDigEdit, clearDigEdits, surfaceHeight } from "./terrain.js";
import { buildGrassInstancedGeometry } from "./gpu/grass_node_material.js";
import type { PageFootprint } from "./types.js";

const footprint: PageFootprint = { minX: 0, minZ: 0, maxX: 16, maxZ: 16 };
const settings: GrassSettings = {
  ...DEFAULT_GRASS_SETTINGS,
  minHeight: 0,
  maxHeight: 128,
  slopeMinY: 0,
  bladeSpacing: 2,
  maxBlades: 1000,
};

function findSite(predicate: (site: GrassTerrainSite) => boolean): { x: number; z: number; site: GrassTerrainSite } | null {
  for (let z = 0; z <= 192; z += 4) {
    for (let x = 0; x <= 192; x += 4) {
      const site = sampleGrassTerrainSite(x, z, settings);
      if (predicate(site)) return { x, z, site };
    }
  }
  return null;
}

describe("grass placement", () => {
  it("defaults to the terrain patch shader while retaining the classic shader option", () => {
    expect(DEFAULT_GRASS_SHADER_MODE).toBe("terrain-patch-v2");
    expect(DEFAULT_GRASS_SETTINGS.shaderMode).toBe("terrain-patch-v2");
    expect(GRASS_SHADER_MODES).toContain("webgpu-ring-v1");
    expect(GRASS_SHADER_MODES).toContain("classic");
  });

  it("is deterministic for the same seed and footprint", () => {
    expect(generateGrassInstances(footprint, settings)).toEqual(generateGrassInstances(footprint, settings));
  });

  it("changes blade attributes when the seed changes", () => {
    const first = generateGrassInstances(footprint, settings);
    const second = generateGrassInstances(footprint, { ...settings, seed: settings.seed + 1 });
    expect(second).not.toEqual(first);
  });

  it("rejects slopes below the configured threshold", () => {
    expect(acceptsGrassCandidate(settings, {
      height: 50,
      normalY: -0.01,
      grassWeight: 1,
      threshold: 0,
    })).toBe(false);
  });

  it("rejects heights outside the configured range", () => {
    const bounded = { ...settings, minHeight: 20, maxHeight: 80 };
    expect(acceptsGrassCandidate(bounded, {
      height: 19.99,
      normalY: 1,
      grassWeight: 1,
      threshold: 0,
    })).toBe(false);
    expect(acceptsGrassCandidate(bounded, {
      height: 80.01,
      normalY: 1,
      grassWeight: 1,
      threshold: 0,
    })).toBe(false);
  });

  it("respects the maximum blade count", () => {
    expect(generateGrassInstances(footprint, settings, 7)).toHaveLength(7);
  });

  it("rejects explicit terrain masks for water, rock, and snow", () => {
    expect(acceptsGrassCandidate(settings, {
      height: 24,
      normalY: 1,
      grassWeight: 1,
      threshold: 0,
      waterDepth: 0.1,
    })).toBe(false);
    expect(acceptsGrassCandidate(settings, {
      height: 70,
      normalY: 1,
      grassWeight: 1,
      threshold: 0,
      rockWeight: 0.9,
    })).toBe(false);
    expect(acceptsGrassCandidate(settings, {
      height: 95,
      normalY: 1,
      grassWeight: 1,
      threshold: 0,
      snowWeight: 0.7,
    })).toBe(false);
  });

  it("computes terrain-aware grass masks and near-field scruff", () => {
    const water = findSite((site) => site.waterDepth > 0);
    expect(water).not.toBeNull();
    expect(water?.site.grassMask).toBe(0);

    const viable = findSite((site) =>
      site.waterDepth === 0 &&
      site.rockWeight < 0.4 &&
      site.snowWeight < 0.08 &&
      site.normalY >= settings.slopeMinY);
    expect(viable).not.toBeNull();
    if (!viable) return;
    const far = sampleGrassTerrainSite(viable.x, viable.z, settings, 128);
    const near = sampleGrassTerrainSite(viable.x, viable.z, settings, 0);
    expect(near.grassMask).toBeGreaterThanOrEqual(far.grassMask);
  });

  it("terrain-patch-v2 records generation stats and respects the blade budget", () => {
    const stats = { generatedCandidates: 0, acceptedCandidates: 0, edgeSuppressedCandidates: 0 };
    const blades = generateGrassInstances(
      footprint,
      { ...settings, shaderMode: "terrain-patch-v2" },
      11,
      stats,
    );
    expect(blades.length).toBeLessThanOrEqual(11);
    expect(stats.generatedCandidates).toBeGreaterThan(0);
    expect(stats.acceptedCandidates).toBeGreaterThanOrEqual(blades.length);
    for (const blade of blades) {
      expect(blade.edgeFade).toBeGreaterThanOrEqual(0.18);
      expect(blade.normalY).toBeGreaterThanOrEqual(settings.slopeMinY);
    }
  });

  it("generates deterministic camera-ring tiers within the blade budget", () => {
    const ringSettings = {
      ...settings,
      shaderMode: "webgpu-ring-v1" as const,
      distance: 72,
      bladeSpacing: 1.4,
      maxBlades: 97,
    };
    const center = { x: 32, z: 32 };
    const first = generateGrassRingInstances(center, ringSettings, 96);
    const second = generateGrassRingInstances(center, ringSettings, 96);
    expect(second).toEqual(first);
    const total = first.near.length + first.mid.length + first.far.length + first.super.length;
    expect(total).toBeLessThanOrEqual(ringSettings.maxBlades);
    expect(total).toBeGreaterThan(0);
    expect(first.stats.generatedCandidates).toBeGreaterThan(0);
    expect(first.stats.acceptedCandidates).toBeGreaterThanOrEqual(total);
  });

  it("generates a super-far ring tier when the distance budget reaches meadow range", () => {
    const ring = generateGrassRingInstances(
      { x: 128, z: 128 },
      { ...settings, shaderMode: "webgpu-ring-v1", distance: 220, bladeSpacing: 2.4, maxBlades: 3500 },
      256,
    );
    expect(ring.super.length).toBeGreaterThan(0);
  });

  it("builds deterministic one-time GPU ring candidate buffers", () => {
    const gpuSettings = {
      ...settings,
      shaderMode: "webgpu-ring-v1" as const,
      distance: 96,
      bladeSpacing: 2.5,
      maxBlades: 128,
    };
    const first = buildGrassGpuCandidateBuffer(gpuSettings, 128);
    const second = buildGrassGpuCandidateBuffer(gpuSettings, 128);
    expect(second).toEqual(first);
    expect(first.count).toBeGreaterThan(0);
    expect(first.count).toBeLessThanOrEqual(gpuSettings.maxBlades * 4);
    expect(first.data.length).toBeGreaterThanOrEqual(first.count * 12);
    expect(first.generatedCandidates).toBeGreaterThan(first.acceptedCandidates);
  });

  it("widens ring survivors as thinning reduces accepted density", () => {
    expect(grassThin(16)).toBeGreaterThan(grassThin(120));
    expect(grassThin(120)).toBeGreaterThan(grassThin(155));
    const ring = generateGrassRingInstances(
      { x: 32, z: 32 },
      { ...settings, shaderMode: "webgpu-ring-v1", distance: 96, bladeSpacing: 1.4, maxBlades: 250 },
      96,
    );
    const survivors = [...ring.near, ...ring.mid, ...ring.far, ...ring.super];
    expect(survivors.some((blade) => (blade.widthScale ?? 1) > 1)).toBe(true);
  });

  it("builds packed multi-blade WebGPU ring geometry", () => {
    const ring = generateGrassRingInstances(
      { x: 32, z: 32 },
      { ...settings, shaderMode: "webgpu-ring-v1", distance: 72, bladeSpacing: 1.4, maxBlades: 25 },
      96,
    );
    const source = ring.near.length > 0 ? ring.near : [...ring.mid, ...ring.far];
    expect(source.length).toBeGreaterThan(0);
    const near = buildGrassInstancedGeometry(source.slice(0, 1), {
      mode: "webgpu-ring-v1",
      tier: "near",
    });
    const classic = buildGrassInstancedGeometry(source.slice(0, 1), {
      mode: "terrain-patch-v2",
      tier: "near",
    });
    expect(near.getAttribute("position").count).toBeGreaterThan(classic.getAttribute("position").count);
    expect(near.getAttribute("aPacked0").itemSize).toBe(4);
    expect(near.getAttribute("aPacked1").itemSize).toBe(4);
    expect(near.getAttribute("aOffset").itemSize).toBe(4);
    expect(near.getAttribute("aHeight")).toBeUndefined();
    near.dispose();
    classic.dispose();
  });

  it("builds far tuft geometry and terrain normals for the terrain patch path", () => {
    const blades = generateGrassInstances(footprint, { ...settings, shaderMode: "terrain-patch-v2" }, 4);
    expect(blades.length).toBeGreaterThan(0);
    expect(blades[0].terrainNormal).toHaveLength(3);
    const near = buildGrassInstancedGeometry(blades.slice(0, 1), {
      mode: "terrain-patch-v2",
      tier: "near",
    });
    const far = buildGrassInstancedGeometry(blades.slice(0, 1), {
      mode: "terrain-patch-v2",
      tier: "far",
    });
    const superFar = buildGrassInstancedGeometry(blades.slice(0, 1), {
      mode: "terrain-patch-v2",
      tier: "super",
    });
    expect(far.getAttribute("position").count).toBeGreaterThan(near.getAttribute("position").count);
    expect(superFar.getAttribute("position").count).toBe(far.getAttribute("position").count);
    expect(far.getAttribute("aTerrainNormal").itemSize).toBe(4);
    superFar.dispose();
    far.dispose();
    near.dispose();
  });

  afterEach(() => {
    clearDigEdits();
  });

  it("re-samples blade height after terrain is edited", () => {
    clearDigEdits();
    const before = generateGrassInstances(footprint, settings);
    expect(before.length).toBeGreaterThan(0);
    const target = before[0];
    addDigEdit({
      x: target.offset[0],
      y: target.offset[1],
      z: target.offset[2],
      r: 3,
      shape: "sphere",
      op: "remove",
    });
    expect(surfaceHeight(target.offset[0], target.offset[2])).toBeLessThan(target.offset[1] - 0.01);
    const after = generateGrassInstances(footprint, settings);
    for (const blade of after) {
      const groundY = surfaceHeight(blade.offset[0], blade.offset[2]);
      expect(blade.offset[1]).toBeCloseTo(groundY + 0.02, 1);
    }
  });
});
