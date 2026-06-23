import { describe, expect, it, afterEach } from "vitest";
import * as THREE from "three";
import {
  DEFAULT_GRASS_SHADER_MODE,
  DEFAULT_GRASS_SETTINGS,
  GRASS_SHADER_MODES,
  acceptsGrassCandidate,
  computeGrassDensityScale,
  createGrassClumpGeometry,
  createGrassTuftGeometry,
  generateGrassRingInstances,
  generateGrassInstances,
  GrassSystem,
  grassFadeDistance,
  grassMaskForHeightNormal,
  grassGpuRingKey,
  grassRingBands,
  grassThin,
  grassThinnedInstanceCount,
  grassWorldCell,
  parseGrassConfig,
  populateGrassGeometry,
  pcg2d,
  sampleGrassTerrainSite,
  type GrassTerrainSite,
  type GrassSettings,
} from "./grass.js";
import grassYamlText from "../config/grass.yaml?raw";
import {
  GRASS_GPU_RING_CELL,
  GRASS_GPU_RING_GRID,
  GRASS_GPU_RING_SLOT_COUNT,
  grassGpuRingCell,
  grassGpuRingGrid,
  grassGpuRingSlotCount,
} from "./gpu/grass_ring_compute.js";
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
  it("defaults to the WebGPU ring shader while retaining fallback shader options", () => {
    expect(DEFAULT_GRASS_SETTINGS.enabled).toBe(true);
    expect(DEFAULT_GRASS_SHADER_MODE).toBe("webgpu-ring-v1");
    expect(DEFAULT_GRASS_SETTINGS.shaderMode).toBe("webgpu-ring-v1");
    expect(DEFAULT_GRASS_SETTINGS.maxHeight).toBe(28);
    expect(DEFAULT_GRASS_SETTINGS.ring.grid).toBe(700);
    expect(DEFAULT_GRASS_SETTINGS.ring.cell).toBe(0.7);
    expect(DEFAULT_GRASS_SETTINGS.patchFallback.maxNewPatchesPerRefresh).toBe(2);
    expect(GRASS_SHADER_MODES).toContain("terrain-patch-v2");
    expect(GRASS_SHADER_MODES).toContain("webgpu-ring-v1");
    expect(GRASS_SHADER_MODES).toContain("classic");
  });

  it("parses config/grass.yaml to the typed defaults", () => {
    expect(parseGrassConfig(grassYamlText, null)).toEqual(DEFAULT_GRASS_SETTINGS);
  });

  it("falls back to default grass settings when config text is missing", () => {
    expect(parseGrassConfig(undefined, null)).toEqual(DEFAULT_GRASS_SETTINGS);
    expect(parseGrassConfig("", null)).toEqual(DEFAULT_GRASS_SETTINGS);
  });

  it("falls back clearly for an invalid grass shader mode", () => {
    const warnings: string[] = [];
    const parsed = parseGrassConfig("grass:\n  shader_mode: unknown-mode\n", (message) => warnings.push(message));

    expect(parsed.shaderMode).toBe(DEFAULT_GRASS_SHADER_MODE);
    expect(warnings[0]).toContain("invalid shader_mode");
    expect(warnings[0]).toContain("unknown-mode");
  });

  it("applies configured WebGPU ring sizing to derived helpers and keys", () => {
    const parsed = parseGrassConfig(`
grass:
  distance: 140
  ring:
    grid: 128
    cell: 1.25
    max_radius: 112
    near_meters: 24
    mid_meters: 72
    far_meters: 96
    far_distance_fraction: 0.75
    band_meters: 5
    scruff_meters: 10
`, null);

    expect(grassGpuRingGrid(parsed.ring)).toBe(128);
    expect(grassGpuRingCell(parsed.ring)).toBe(1.25);
    expect(grassGpuRingSlotCount(parsed.ring)).toBe(128 * 128);
    expect(grassRingBands(parsed)).toEqual({ radius: 112, near: 24, mid: 72, far: 96 });
    expect(grassFadeDistance(parsed)).toBe(112);
    expect(grassGpuRingKey(parsed, 256)).toContain("128|1.25|112|24|72|96|0.75|5|10");
  });

  it("clamps unsafe grass config sizes before they reach GPU dispatch", () => {
    const parsed = parseGrassConfig(`
grass:
  max_blades: -10
  ring:
    grid: 0
    cell: -3
    max_radius: -1
    band_meters: -2
    scruff_meters: -4
  patch_fallback:
    max_new_patches_per_refresh: 0
    refresh_distance: -1
`, null);

    expect(parsed.maxBlades).toBe(1);
    expect(parsed.ring.grid).toBe(1);
    expect(parsed.ring.cell).toBe(0.1);
    expect(parsed.ring.maxRadius).toBe(0);
    expect(parsed.ring.bandMeters).toBe(0);
    expect(parsed.ring.scruffMeters).toBe(0);
    expect(parsed.patchFallback.maxNewPatchesPerRefresh).toBe(1);
    expect(parsed.patchFallback.refreshDistance).toBe(0.1);
  });

  it("clamps invalid nested grass YAML values", () => {
    const parsed = parseGrassConfig(`
grass:
  distance_m: -1
  max_instances: -99
  placement:
    spacing_m: 0
    jitter: 4
    slope_min_y: -0.5
    min_height_m: 40
    max_height_m: 12
    min_grass_weight: 3
  lod:
    near_fraction: 0.9
    mid_fraction: 0.2
    far_density_ratio: -1
    mid_instance_fraction: 2
    far_instance_fraction: -2
  blade:
    near_blades_per_instance: 0
    mid_blades_per_instance: -2
    near_segments: 0
    mid_segments: -1
    max_width_compensation: 0.2
  wind:
    direction: [0, 0]
`, null);

    expect(parsed.distance).toBeGreaterThan(0);
    expect(parsed.maxBlades).toBe(1);
    expect(parsed.placement.spacingM).toBe(0.05);
    expect(parsed.placement.jitter).toBe(1);
    expect(parsed.placement.slopeMinY).toBe(0);
    expect(parsed.placement.maxHeightM).toBe(parsed.placement.minHeightM);
    expect(parsed.placement.minGrassWeight).toBe(1);
    expect(parsed.lod.midFraction).toBeGreaterThan(parsed.lod.nearFraction);
    expect(parsed.lod.farDensityRatio).toBe(0);
    expect(parsed.lod.midInstanceFraction).toBe(1);
    expect(parsed.lod.farInstanceFraction).toBe(0);
    expect(parsed.blade.nearBladesPerInstance).toBe(1);
    expect(parsed.blade.midBladesPerInstance).toBe(1);
    expect(parsed.blade.nearSegments).toBe(1);
    expect(parsed.blade.midSegments).toBe(1);
    expect(parsed.blade.maxWidthCompensation).toBe(1);
    expect(parsed.wind.direction).toEqual(DEFAULT_GRASS_SETTINGS.wind.direction);
  });

  it("keeps the ./grass.js compatibility exports available", () => {
    expect(DEFAULT_GRASS_SETTINGS).toBeDefined();
    expect(DEFAULT_GRASS_SHADER_MODE).toBe("webgpu-ring-v1");
    expect(GRASS_SHADER_MODES).toContain("webgpu-ring-v1");
    expect(typeof grassThin).toBe("function");
    expect(typeof grassWorldCell).toBe("function");
    expect(typeof sampleGrassTerrainSite).toBe("function");
    expect(typeof generateGrassInstances).toBe("function");
    expect(typeof generateGrassRingInstances).toBe("function");
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

  it("uses a fixed GPU slot grid instead of a CPU candidate buffer", () => {
    expect(GRASS_GPU_RING_GRID).toBe(700);
    expect(GRASS_GPU_RING_CELL).toBe(0.7);
    expect(GRASS_GPU_RING_SLOT_COUNT).toBe(GRASS_GPU_RING_GRID * GRASS_GPU_RING_GRID);
    expect(GRASS_GPU_RING_GRID * GRASS_GPU_RING_CELL * 0.5).toBeGreaterThan(220);
  });

  it("mirrors GPU pcg2d deterministically", () => {
    expect(pcg2d(12, -7, 1337)).toEqual(pcg2d(12, -7, 1337));
    expect(pcg2d(12, -7, 1337)).not.toEqual(pcg2d(13, -7, 1337));
    for (const value of pcg2d(-2048, 4096, 0x9e3779b9)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("maps toroidal slots to the nearest congruent world cell", () => {
    const grid = 8;
    const cell = 2;
    expect(grassWorldCell(3, 5, grid, cell, 18, 22)).toEqual([11, 13]);
    expect(grassWorldCell(3, 5, grid, cell, -5, -9)).toEqual([-5, -3]);
  });

  it("mirrors the grass mask math used by sampleGrassTerrainSite", () => {
    const viable = findSite((site) =>
      site.waterDepth === 0 &&
      site.rockWeight < 0.4 &&
      site.snowWeight < 0.08 &&
      site.normalY >= settings.slopeMinY);
    expect(viable).not.toBeNull();
    if (!viable) return;
    const site = sampleGrassTerrainSite(viable.x, viable.z, settings, 32);
    expect(grassMaskForHeightNormal(site.height, site.normalY, settings, 32)).toBeCloseTo(site.grassMask, 12);
  });

  it("widens ring survivors as thinning reduces accepted density", () => {
    expect(grassThin(16)).toBeGreaterThan(grassThin(120));
    expect(grassThin(120)).toBeGreaterThan(grassThin(155));
    expect(computeGrassDensityScale(1, settings)).toBe(1);
    expect(computeGrassDensityScale(settings.distance * 0.8, settings)).toBeLessThan(1);
    const ring = generateGrassRingInstances(
      { x: 32, z: 32 },
      { ...settings, shaderMode: "webgpu-ring-v1", distance: 96, bladeSpacing: 1.4, maxBlades: 250 },
      96,
    );
    const survivors = [...ring.near, ...ring.mid, ...ring.far, ...ring.super];
    expect(survivors.some((blade) => (blade.widthScale ?? 1) > 1)).toBe(true);
  });

  it("allows explicit zero thinning to disable generated tier instances", () => {
    expect(grassThinnedInstanceCount(100, 0)).toBe(0);
    expect(grassThinnedInstanceCount(100, -1)).toBe(0);
    expect(grassThinnedInstanceCount(100, 0.001)).toBe(1);
    expect(grassThinnedInstanceCount(100, 0.35)).toBe(35);
  });

  it("does not generate far or super terrain patch instances when far thinning is zero", () => {
    const tierCounts = new Map<string, number>();
    const material = new THREE.MeshBasicMaterial();
    const lighting = {
      light: new THREE.Vector3(0, 1, 0),
      sunColor: new THREE.Color(1, 1, 1),
      skyLight: new THREE.Color(0.5, 0.6, 0.7),
      groundLight: new THREE.Color(0.2, 0.18, 0.16),
    };
    const system = new GrassSystem({
      scene: new THREE.Scene(),
      nodes: [{
        id: "L0:0,0",
        level: 0,
        children: [],
        mesh: {
          positions: new Float32Array(),
          normals: new Float32Array(),
          materials: new Float32Array(),
          indices: new Uint32Array(),
        },
        footprint,
        bounds: { center: [8, 0, 8], radius: 12, minY: 0, maxY: 0 },
        errorWorld: 0,
        lowBenefit: false,
      }],
      worldCells: 16,
      settings: {
        ...settings,
        enabled: false,
        shaderMode: "terrain-patch-v2",
        lod: {
          ...settings.lod,
          midInstanceFraction: 0.5,
          farDensityRatio: 0.5,
          farInstanceFraction: 0,
        },
      },
      lighting,
      material: { material },
      buildGeometry: (instances, options) => {
        tierCounts.set(options.tier, instances.length);
        return new THREE.InstancedBufferGeometry();
      },
    });
    const blades = generateGrassInstances(footprint, { ...settings, shaderMode: "terrain-patch-v2" }, 100);
    expect(blades.length).toBeGreaterThan(0);

    const patch = (system as unknown as {
      createTerrainPatch(nodeId: string, patchFootprint: PageFootprint, instances: typeof blades): {
        meshes: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>[];
      };
    }).createTerrainPatch("L0:0,0", footprint, blades);

    expect(tierCounts.get("near")).toBe(blades.length);
    expect(tierCounts.get("mid")).toBeGreaterThan(0);
    expect(tierCounts.get("far")).toBe(0);
    expect(tierCounts.get("super")).toBe(0);
    for (const mesh of patch.meshes) mesh.geometry.dispose();
    material.dispose();
  });

  it("builds real clump and far tuft source geometry without NaN attributes", () => {
    const clump = createGrassClumpGeometry(5, 4, settings);
    const tuft = createGrassTuftGeometry(settings);
    expect(clump.getAttribute("position").count).toBeGreaterThan(tuft.getAttribute("position").count);
    expect(clump.getIndex()?.count ?? 0).toBeGreaterThan(0);
    expect(tuft.getIndex()?.count ?? 0).toBeGreaterThan(0);
    for (const geometry of [clump, tuft]) {
      for (const name of ["position", "normal", "uv"]) {
        const attribute = geometry.getAttribute(name);
        expect(attribute).toBeDefined();
        for (const value of attribute.array as Float32Array) {
          expect(Number.isFinite(value)).toBe(true);
        }
      }
    }
    clump.dispose();
    tuft.dispose();
  });

  it("uploads full terrain normal attributes matching instance count", () => {
    const instances = generateGrassInstances(footprint, { ...settings, shaderMode: "terrain-patch-v2" }, 6);
    expect(instances.length).toBeGreaterThan(0);
    const source = createGrassClumpGeometry(3, 2, settings);
    const geometry = new THREE.InstancedBufferGeometry();
    populateGrassGeometry(geometry, source, footprint, instances, settings);
    const terrainNormal = geometry.getAttribute("aTerrainNormal");
    expect(terrainNormal.itemSize).toBe(3);
    expect(terrainNormal.count).toBe(instances.length);
    for (const value of terrainNormal.array as Float32Array) {
      expect(Number.isFinite(value)).toBe(true);
    }
    source.dispose();
    geometry.dispose();
  });

  it("expands grass bounds for actual source width and instance width scale", () => {
    const boundedSettings = { ...settings, bladeWidth: 0.08, windStrength: 0 };
    const source = createGrassTuftGeometry(boundedSettings);
    const geometry = new THREE.InstancedBufferGeometry();
    populateGrassGeometry(geometry, source, { minX: 8, minZ: 8, maxX: 8, maxZ: 8 }, [{
      offset: [8, 10, 8] as [number, number, number],
      height: 2,
      rotationY: 0,
      phase: 0,
      colorMix: 0,
      edgeFade: 1,
      normalY: 1,
      terrainNormal: [0, 1, 0] as [number, number, number],
      widthScale: 2.6,
    }], boundedSettings);

    expect(geometry.boundingBox).not.toBeNull();
    expect(geometry.boundingBox?.min.x).toBeLessThan(7.5);
    expect(geometry.boundingBox?.max.x).toBeGreaterThan(8.5);
    expect(geometry.boundingBox?.max.y).toBeCloseTo(12);
    source.dispose();
    geometry.dispose();
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
