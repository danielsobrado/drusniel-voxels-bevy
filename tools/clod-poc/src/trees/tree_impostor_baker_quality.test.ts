import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  cloneTreeSettings,
  createTreeImpostorAgeGeometry,
  octFrames,
  selectTreeImpostorBakeGeometry,
  treeImpostorFramesForVariant,
  TREE_IMPOSTOR_MAX_ATLAS_VARIANTS,
  TREE_IMPOSTOR_NORMAL_DEPTH_FRAGMENT_SHADER,
  TREE_IMPOSTOR_NORMAL_DEPTH_VERTEX_SHADER,
  TREE_STRUCTURAL_VARIANTS,
  type TreeGeometryMap,
  type TreeImpostorAtlas,
} from "./index.js";
import { parseTreeImpostorBakeConfig } from "./tree_impostor_bake_config.js";
import { TreeImpostorFrameBudget } from "./tree_impostor_bake_scheduler.js";
import { estimateTreeImpostorAtlasMemoryMiB } from "./tree_impostor_memory.js";

describe("tree impostor baker quality", () => {
  it("selects every structural variant instead of the merged selector geometry", () => {
    const merged = new THREE.BufferGeometry();
    const variants = Array.from({ length: TREE_STRUCTURAL_VARIANTS }, () => new THREE.BufferGeometry());
    const map = {
      oak: {
        near: merged,
        mid: merged,
        far: merged,
        impostor: merged,
        variants: Object.fromEntries(variants.map((geometry, variant) => [variant, {
          near: geometry,
          mid: geometry,
          far: geometry,
          impostor: geometry,
        }])),
      },
    } as unknown as TreeGeometryMap;

    expect(TREE_IMPOSTOR_MAX_ATLAS_VARIANTS).toBe(TREE_STRUCTURAL_VARIANTS);
    for (let variant = 0; variant < TREE_STRUCTURAL_VARIANTS; variant++) {
      expect(selectTreeImpostorBakeGeometry(map, "oak", "mid", variant)).toBe(variants[variant]);
    }
  });

  it("accounts for all twelve variant/age layers in the production memory estimate", () => {
    const settings = cloneTreeSettings();
    settings.impostors.enabled = true;
    settings.impostors.resolutionPx = 192;
    settings.impostors.octahedralGridSize = 8;

    expect(estimateTreeImpostorAtlasMemoryMiB(settings)).toBeCloseTo(1296, 5);
  });

  it("bakes distinct monotonic young, mature, and old silhouettes", () => {
    const source = new THREE.BufferGeometry();
    source.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 10, 0], 3));
    source.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0], 3));
    source.setAttribute("treeHeight01", new THREE.Float32BufferAttribute([0, 1], 1));
    source.setAttribute("treeRadial01", new THREE.Float32BufferAttribute([0, 0], 1));
    source.setAttribute("treeBranchLevel", new THREE.Float32BufferAttribute([0, 0], 1));
    source.setAttribute("treeBranchPhase", new THREE.Float32BufferAttribute([0, 0], 1));
    source.setAttribute("treeRootMask", new THREE.Float32BufferAttribute([1, 0], 1));
    const settings = cloneTreeSettings();
    const young = createTreeImpostorAgeGeometry(source, "oak", 0.20, settings);
    const mature = createTreeImpostorAgeGeometry(source, "oak", 0.60, settings);
    const old = createTreeImpostorAgeGeometry(source, "oak", 0.92, settings);
    try {
      expect(young.getAttribute("position").getY(0)).toBe(0);
      expect(young.getAttribute("position").getY(1)).toBeLessThan(mature.getAttribute("position").getY(1));
      expect(mature.getAttribute("position").getY(1)).toBeLessThan(old.getAttribute("position").getY(1));
    } finally {
      young.dispose();
      mature.dispose();
      old.dispose();
      source.dispose();
    }
  });

  it("parses and clamps the YAML frame budget", () => {
    expect(parseTreeImpostorBakeConfig(
      "tree_impostor_bake:\n  max_build_ms_per_frame: 1.5\n",
    ).maxBuildMsPerFrame).toBe(1.5);
    expect(parseTreeImpostorBakeConfig(
      "tree_impostor_bake:\n  max_build_ms_per_frame: 0\n",
    ).maxBuildMsPerFrame).toBe(0.25);
    expect(parseTreeImpostorBakeConfig(
      "tree_impostor_bake:\n  max_build_ms_per_frame: 999\n",
    ).maxBuildMsPerFrame).toBe(16);
  });

  it("yields only after the configured frame deadline", async () => {
    let now = 0;
    let yields = 0;
    const budget = new TreeImpostorFrameBudget(2, {
      now: () => now,
      nextFrame: async () => {
        yields++;
        now += 0.1;
      },
    });

    now = 1.9;
    expect(await budget.yieldIfExpired()).toBe(false);
    expect(yields).toBe(0);
    now = 2.1;
    expect(await budget.yieldIfExpired()).toBe(true);
    expect(yields).toBe(1);
    expect(budget.reportedFrameMs()).toBeCloseTo(2.1);
  });

  it("stores tree-local normals, not camera-view normals", () => {
    expect(TREE_IMPOSTOR_NORMAL_DEPTH_VERTEX_SHADER).toContain("vTreeImpostorLocalNormal = normalize(normal)");
    expect(TREE_IMPOSTOR_NORMAL_DEPTH_VERTEX_SHADER).not.toContain("normalMatrix * normal");
    expect(TREE_IMPOSTOR_NORMAL_DEPTH_FRAGMENT_SHADER).toContain("vTreeImpostorLocalNormal");
  });

  it("returns four distinct variant-specific atlas frame pages", () => {
    const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    const base = octFrames(2, 16, 1);
    const pages = Array.from({ length: TREE_STRUCTURAL_VARIANTS }, (_, variant) => base.map((frame) => ({
      ...frame,
      uvMin: [frame.uvMin[0], (frame.uvMin[1] + variant) / TREE_STRUCTURAL_VARIANTS] as [number, number],
      uvMax: [frame.uvMax[0], (frame.uvMax[1] + variant) / TREE_STRUCTURAL_VARIANTS] as [number, number],
    })));
    const atlas: TreeImpostorAtlas = {
      species: "oak",
      texture,
      albedo: texture,
      normalDepth: texture,
      gridSize: 2,
      resolutionPx: 16,
      atlasSizePx: 32,
      atlasWidthPx: 32,
      atlasHeightPx: 128,
      variantCount: TREE_STRUCTURAL_VARIANTS,
      frames: pages[0],
      variantFrames: { 0: pages[0], 1: pages[1], 2: pages[2], 3: pages[3] },
      ready: true,
      dispose() {
        texture.dispose();
      },
    };

    for (let variant = 0; variant < TREE_STRUCTURAL_VARIANTS; variant++) {
      expect(treeImpostorFramesForVariant(atlas, variant)).toBe(pages[variant]);
    }
  });
});
