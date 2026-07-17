import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DEFAULT_DIAGONAL_FLIP_CONFIG, type ClodPagesConfig } from "../config.js";
import {
  STONE_GPU_SCATTER_STORAGE_BINDINGS,
  stoneGpuClassRegion,
  stoneGpuOutputIndex,
  stoneGpuScatterGrid,
  stoneGpuScatterUnsupportedReason,
  stoneGpuSourceClassCap,
} from "../gpu/stone_scatter_compute.js";
import { composeStoneScatterShader } from "../gpu/wgsl_modules.js";
import terrainCommonSource from "../gpu/shaders/terrain_field_common.wgsl?raw";
import shaderSource from "../gpu/shaders/stone_scatter.compute.wgsl?raw";
import { buildWorld } from "../clod/quadtree.js";
import type { ClodPageNode } from "../types.js";
import { DEFAULT_STONE_SETTINGS, type StoneSettings } from "./stone_config.js";
import { StoneSystem, stoneGpuGroupLayout, stoneScatterCenterCoord } from "./stone_instances.js";
import {
  sampleStoneSite,
  selectStoneClass,
  stoneClassWeights,
} from "./stone_scatter.js";
import { assertPageMeshSignaturesUnchanged, pageMeshSignatures } from "./stone_validation.js";

function lighting() {
  return {
    light: new THREE.Vector3(0.4, 1, 0.2).normalize(),
    sunColor: new THREE.Color(1, 1, 1),
    skyLight: new THREE.Color(0.55, 0.6, 0.7),
    groundLight: new THREE.Color(0.25, 0.22, 0.18),
  };
}

function mixedClassSettings(overrides: Partial<StoneSettings> = {}): StoneSettings {
  return {
    ...DEFAULT_STONE_SETTINGS,
    enabled: true,
    density: 2,
    maxInstances: 2000,
    ...overrides,
  };
}

const pageCfg: ClodPagesConfig = {
  page: { chunks_per_page: 2, chunk_size: 16, halo_chunks: 1, quadtree_levels: 1 },
  simplify: {
    target_ratio_per_level: 0.5,
    abandon_ratio: 0.85,
    target_error: 0.01,
    weld_epsilon_cells: 0.001,
    attribute_weights: { normal: 0.5, material: 1 },
  },
  polish: { diagonal_flip: DEFAULT_DIAGONAL_FLIP_CONFIG },
  selection: {
    error_threshold_px: 1,
    hysteresis_merge_factor: 1.5,
    neighbor_level_delta_max: 1,
    transition_mode: "instant",
    crossfade_frames: 0,
    freeze_selection: false,
  },
  near_field: { enabled: true, radius_chunks: 6, show_mask: true },
  debug: {
    show_wireframe: true, show_page_boundaries: true, show_locked_border_vertices: false,
    show_error_labels: true, show_stats_panel: true,
    lod_colors: { lod0: "#3b82f6", lod1: "#22c55e", lod2: "#f59e0b", lod3: "#ef4444" },
  },
  stress: { active_scene: "ridge_border" },
  meshopt_package_version: "0.22.0",
  poc: { lod0_pages_x: 8, lod0_pages_z: 8, smoke_lod0_pages_x: 4, smoke_lod0_pages_z: 4, emit_debug_json: false, emit_debug_obj: false },
  validation: { position_epsilon: 0.000001, normal_dot_min: 0.9999, material_weight_epsilon: 0.0001, zero_area_epsilon: 0.00000001 },
};

describe("GPU stone instance layout", () => {
  function deviceWithStorageBufferLimit(limit: number): GPUDevice {
    return {
      limits: {
        maxStorageBuffersPerShaderStage: limit,
      },
    } as unknown as GPUDevice;
  }

  it("partitions direct storage regions by size class", () => {
    expect(stoneGpuClassRegion(0, 100)).toEqual({ start: 0, end: 100, firstInstance: 0 });
    expect(stoneGpuClassRegion(1, 100)).toEqual({ start: 100, end: 200, firstInstance: 100 });
    expect(stoneGpuClassRegion(2, 100)).toEqual({ start: 200, end: 300, firstInstance: 200 });
    expect(stoneGpuOutputIndex(2, 7, 100)).toBe(207);
  });

  it("preserves canonical infinite-world scatter centers", () => {
    expect(stoneScatterCenterCoord(2048, 0, 16, true)).toBe(2048);
    expect(stoneScatterCenterCoord(-512, 0, 16, true)).toBe(-512);
  });

  it("clamps finite-world scatter centers", () => {
    expect(stoneScatterCenterCoord(2048, 0, 16, false)).toBe(16);
    expect(stoneScatterCenterCoord(-512, 0, 16, false)).toBe(0);
  });

  it("keeps the CPU class-pick oracle biased toward large streambed/cliff stones", () => {
    const settings = mixedClassSettings();
    const flat = sampleStoneSite(64, 64, settings);
    const rocky = { ...flat, scree: 1, cliffAbove: 1, streambed: 1 };
    expect(stoneClassWeights(rocky, settings).large).toBeGreaterThan(stoneClassWeights(flat, settings).large);
    expect(selectStoneClass(rocky, settings, 0)).toBe("large");
    expect(selectStoneClass(rocky, settings, 0.99)).toBe("small");
  });

  it("keeps the WGSL storage-buffer declarations within the advertised safe limit", () => {
    const storageBindings = composeStoneScatterShader().match(/var<storage/g) ?? [];

    expect(storageBindings).toHaveLength(STONE_GPU_SCATTER_STORAGE_BINDINGS);
    expect(stoneGpuScatterUnsupportedReason(deviceWithStorageBufferLimit(6))).toContain("7 storage buffers");
    expect(stoneGpuScatterUnsupportedReason(deviceWithStorageBufferLimit(7))).toBeNull();
  });

  it("lays out (class x variant x lod) view groups honoring configured LODs and distances", () => {
    const settings = mixedClassSettings();
    const layout = stoneGpuGroupLayout(settings);
    // Defaults: large [3,2] x 4 variants, medium [2,1] x 4, small [1] x 4 = 20 groups.
    expect(layout.groupCount).toBe(20);
    expect(layout.classGroupCounts).toEqual([8, 8, 4]);
    expect(layout.classView[0]?.[0]).toBe(settings.classes.large.maxDistance);
    expect(layout.classView[1]?.[0]).toBe(settings.classes.medium.maxDistance);
    expect(layout.classView[2]?.[0]).toBe(settings.classes.small.maxDistance);
    // Group bases are cumulative and match group = base + variant * lods + lod.
    expect(layout.classView[0]?.[3]).toBe(0);
    expect(layout.classView[1]?.[3]).toBe(8);
    expect(layout.classView[2]?.[3]).toBe(16);
    // LOD switch stays inside the ring even when maxDistance exceeds it.
    expect(layout.classView[0]?.[1]).toBeLessThanOrEqual(settings.ringRadiusM);
    // Entries are group-ordered so the entry index is the draw group.
    layout.entries.forEach((entry, group) => {
      const view = layout.classView[entry.classIndex]!;
      expect(view[3] + entry.variant * view[2] + entry.lod).toBe(group);
    });
  });

  it("bounds the source class capacity by the candidate grid", () => {
    const settings = mixedClassSettings({ maxInstances: 120_000 });
    const grid = stoneGpuScatterGrid(settings);
    expect(stoneGpuSourceClassCap(settings)).toBe(Math.min(120_000, grid * grid));
    expect(stoneGpuSourceClassCap(mixedClassSettings({ maxInstances: 50 }))).toBe(50);
  });

  it("does not use WGSL reserved keywords as local identifiers", () => {
    expect(shaderSource).not.toMatch(/\blet\s+target\b/);
    expect(shaderSource).toContain("let class_pick =");
  });

  it("does not redeclare terrain-field WGSL helper functions", () => {
    const functionNames = (source: string): string[] =>
      Array.from(source.matchAll(/^fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm), (match) => match[1]!);
    const terrainFunctions = new Set(functionNames(terrainCommonSource));
    const collisions = functionNames(shaderSource).filter((name) => terrainFunctions.has(name));

    expect(collisions).toEqual([]);
  });
});

function buildStoneValidationNodes(): ClodPageNode[] {
  const built = buildWorld(8, 8, pageCfg);
  return built.roots;
}

describe("stone mesh validation", () => {
  it("keeps stone placement out of page mesh geometry", () => {
    const before = pageMeshSignatures(buildStoneValidationNodes());
    const scene = new THREE.Scene();
    const stones = new StoneSystem({
      scene,
      nodes: buildStoneValidationNodes(),
      worldCells: 128,
      settings: mixedClassSettings({ enabled: false }),
      lighting: lighting(),
      gpuDevice: null,
      gpuBackend: null,
    });
    stones.dispose();
    const after = pageMeshSignatures(buildStoneValidationNodes());
    assertPageMeshSignaturesUnchanged(before, after);
  });
});
