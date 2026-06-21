import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import type { ClodPageNode, PageFootprint, PageMesh } from "../types.js";
import {
  cloneUnderstorySettings,
  createUnderstoryGeometry,
  createUnderstoryMaterialHandle,
  emptyUnderstoryStats,
  formatUnderstoryInfoLine,
  UNDERSTORY_CLASSES,
  UnderstorySystem,
  understoryGeometrySummary,
  injectUnderstoryWindShader,
  type UnderstoryTerrainSampler,
} from "./index.js";

const systems: UnderstorySystem[] = [];

afterEach(() => {
  for (const system of systems.splice(0)) system.dispose();
});

describe("understory geometry and material", () => {
  it("creates required attributes under vertex budget", () => {
    const settings = cloneUnderstorySettings();
    const budgets = { shrub: 500, fern: 500, sapling: 800, flower: 300, dead_log: 300, stump: 300 };
    for (const cls of UNDERSTORY_CLASSES) {
      const geometry = createUnderstoryGeometry(cls, settings);
      const summary = understoryGeometrySummary(geometry);
      expect(geometry.getAttribute("position")).toBeTruthy();
      expect(geometry.getAttribute("normal")).toBeTruthy();
      expect(geometry.getAttribute("color")).toBeTruthy();
      expect(geometry.getAttribute("understoryWindWeight")).toBeTruthy();
      expect(summary.indexCount).toBeGreaterThan(0);
      expect(summary.vertexCount).toBeLessThan(budgets[cls]);
      if (cls === "dead_log" || cls === "stump") expect(summary.maxWindWeight).toBe(0);
      else expect(summary.maxWindWeight).toBeGreaterThan(0);
      geometry.dispose();
    }
  });

  it("uses cutout-safe material settings and injects wind shader code", () => {
    const settings = cloneUnderstorySettings();
    const handle = createUnderstoryMaterialHandle(settings);
    const material = handle.regularMaterial;
    expect(material.side).toBe(THREE.DoubleSide);
    expect(material.transparent).toBe(false);
    expect(material.depthWrite).toBe(true);
    expect(material.alphaTest).toBeGreaterThanOrEqual(0);
    expect(injectUnderstoryWindShader("#include <common>\n#include <begin_vertex>")).toContain("understoryWindWeight");
    handle.dispose();
  });
});

describe("understory system", () => {
  it("creates LOD0 patches, toggles visibility, and reports finite bounds", () => {
    const scene = new THREE.Scene();
    const system = new UnderstorySystem({
      scene,
      nodes: [node("L0:0,0", 0, { minX: 0, minZ: 0, maxX: 32, maxZ: 32 }), node("L1:0,0", 1, { minX: 0, minZ: 0, maxX: 64, maxZ: 64 })],
      worldCells: 64,
      settings: systemSettings(),
      sampler: flatSampler(),
    });
    systems.push(system);
    system.update(0, new THREE.Vector3(16, 0, 16));
    const stats = system.getStats();
    expect(stats.patches).toBe(1);
    expect(stats.totalInstances).toBeGreaterThan(0);
    expect(stats.shrub + stats.fern + stats.sapling + stats.flower + stats.deadLog + stats.stump).toBe(stats.totalInstances);
    const root = scene.children.find((child) => child.name === "understory") as THREE.Group;
    expect(root.visible).toBe(true);
    for (const patchGroup of root.children) {
      for (const mesh of (patchGroup as THREE.Group).children as THREE.InstancedMesh[]) {
        if (mesh.count === 0) continue;
        expect(mesh.boundingSphere?.radius ?? Number.NaN).toSatisfy(Number.isFinite);
        expect(mesh.boundingBox?.isEmpty()).toBe(false);
      }
    }
    system.setEnabled(false);
    expect(root.visible).toBe(false);
  });

  it("rebuilds affected pages only and keeps page meshes immutable", () => {
    const scene = new THREE.Scene();
    const nodes = [
      node("L0:0,0", 0, { minX: 0, minZ: 0, maxX: 32, maxZ: 32 }),
      node("L0:1,0", 0, { minX: 32, minZ: 0, maxX: 64, maxZ: 32 }),
    ];
    const before = nodes.map((n) => meshSignature(n.mesh));
    const system = new UnderstorySystem({ scene, nodes, worldCells: 64, settings: systemSettings(), sampler: flatSampler() });
    systems.push(system);
    system.update(0, new THREE.Vector3(32, 0, 16));
    const root = scene.children.find((child) => child.name === "understory") as THREE.Group;
    const namesBefore = root.children.map((child) => child.name).sort();
    system.rebuildNodePatches(["L0:0,0"]);
    system.update(0, new THREE.Vector3(32, 0, 16));
    const namesAfter = root.children.map((child) => child.name).sort();
    expect(namesAfter).toEqual(namesBefore);
    expect(nodes.map((n) => meshSignature(n.mesh))).toEqual(before);
  });

  it("formats compact info lines", () => {
    const stats = { ...emptyUnderstoryStats(), totalInstances: 3, patches: 1, visiblePatches: 1, shrub: 1, fern: 2 };
    expect(formatUnderstoryInfoLine(false, 0, null)).toContain("disabled");
    expect(formatUnderstoryInfoLine(true, 3, stats)).toContain("shrub/fern/sap/flower/log/stump=1/2/0/0/0/0");
  });
});

function systemSettings() {
  const settings = cloneUnderstorySettings();
  settings.distanceM = 80;
  settings.maxNewPatchesPerFrame = 8;
  settings.maxInstances = 10000;
  settings.placement.spacingM = 4;
  settings.placement.jitter = 0.1;
  settings.placement.slopeMinY = 0;
  settings.placement.minHeightM = 0;
  settings.placement.maxHeightM = 128;
  settings.placement.minGroundWeight = 0;
  return settings;
}

function flatSampler(): UnderstoryTerrainSampler {
  return {
    surfaceHeight: () => 20,
    surfaceNormal: () => [0, 1, 0],
    materialWeights: () => [1, 0, 0, 0],
  };
}

function node(id: string, level: number, footprint: PageFootprint): ClodPageNode {
  return {
    id,
    level,
    children: [],
    mesh: mesh(),
    footprint,
    bounds: { center: [0, 0, 0], radius: 1 },
    errorWorld: 0,
    lowBenefit: false,
  };
}

function mesh(): PageMesh {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    materials: new Float32Array([0, 0, 0]),
    indices: new Uint32Array([0, 1, 2]),
  };
}

function meshSignature(pageMesh: PageMesh): number[] {
  return [
    pageMesh.positions.length,
    pageMesh.normals.length,
    pageMesh.materials.length,
    pageMesh.indices.length,
    pageMesh.positions[0],
    pageMesh.indices[0],
  ];
}
