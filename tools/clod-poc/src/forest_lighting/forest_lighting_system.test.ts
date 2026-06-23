import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { ClodPageNode, PageFootprint, PageMesh } from "../types.js";
import { cloneTreeSettings, TreeSystem, type TreeTerrainSampler } from "../trees/index.js";
import { createTreeMaterialHandle } from "../trees/tree_material.js";
import { createUnderstoryMaterialHandle, cloneUnderstorySettings } from "../understory/index.js";
import {
  applyForestLightingMaterialStateIfChanged,
  cloneForestLightingSettings,
  createForestLightingField,
  createForestLightingTexture,
  ForestLightingSystem,
  type ForestLightingMaterialState,
  type ForestLightingMaterialUpdateSignature,
  type ForestLightingTreeProxy,
} from "./index.js";

const treeSystems: TreeSystem[] = [];

afterEach(() => {
  for (const system of treeSystems.splice(0)) system.dispose();
});

describe("forest lighting texture", () => {
  it("packs field bytes into matching DataTexture dimensions", () => {
    const settings = cloneForestLightingSettings();
    settings.field.resolution = 4;
    const field = createForestLightingField(16, settings);
    field.ambientOcclusion[0] = 0.5;
    field.shadowProxy[0] = 1;
    field.fogDensity[0] = 0.25;
    field.sunShaftMask[0] = 0.75;
    const handle = createForestLightingTexture(field);
    try {
      expect(handle.texture.image.width).toBe(4);
      expect(handle.texture.image.height).toBe(4);
      const data = handle.texture.image.data as Uint8Array;
      expect(data[0]).toBe(128);
      expect(data[1]).toBe(255);
      expect(data[2]).toBe(64);
      expect(data[3]).toBe(191);
      expect([...data].every((byte) => byte >= 0 && byte <= 255)).toBe(true);
      const version = handle.texture.version;
      handle.update(field);
      expect(handle.texture.version).toBeGreaterThan(version);
    } finally {
      handle.dispose();
    }
  });

  it("packs neutral fields as neutral primary bytes", () => {
    const settings = cloneForestLightingSettings();
    settings.field.resolution = 2;
    const field = createForestLightingField(8, settings);
    const handle = createForestLightingTexture(field);
    try {
      const data = handle.texture.image.data as Uint8Array;
      expect([...data].every((byte) => byte === 0)).toBe(true);
    } finally {
      handle.dispose();
    }
  });
});

describe("forest lighting material integration", () => {
  it("tree material exposes uniforms, samples treeWorldXZ, and keeps alpha discard code", () => {
    const handle = createTreeMaterialHandle(cloneTreeSettings());
    try {
      const shader = shaderStub();
      handle.regularMaterial.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
      expect(shader.uniforms.uForestLightingMap).toBeDefined();
      expect(shader.vertexShader).toContain("treeWorldXZ");
      expect(shader.fragmentShader).toContain("texture2D(uForestLightingMap");
      expect(shader.fragmentShader).toContain("discard");
    } finally {
      handle.dispose();
    }
  });

  it("understory material exposes uniforms and samples understoryWorldXZ", () => {
    const handle = createUnderstoryMaterialHandle(cloneUnderstorySettings());
    try {
      const shader = shaderStub();
      handle.regularMaterial.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
      expect(shader.uniforms.uForestLightingMap).toBeDefined();
      expect(shader.vertexShader).toContain("understoryWorldXZ");
      expect(shader.fragmentShader).toContain("texture2D(uForestLightingMap");
    } finally {
      handle.dispose();
    }
  });

  it("applies prop material state when texture updates change but not on unchanged frames", () => {
    const { state, signature, dispose } = materialStateFixture();
    const tree = { updateForestLighting: vi.fn() };
    const understory = { updateForestLighting: vi.fn() };
    let previous: ForestLightingMaterialUpdateSignature | null = null;

    try {
      previous = applyForestLightingMaterialStateIfChanged(previous, signature, state, [tree, understory]);
      previous = applyForestLightingMaterialStateIfChanged(previous, signature, state, [tree, understory]);
      expect(tree.updateForestLighting).toHaveBeenCalledTimes(1);
      expect(understory.updateForestLighting).toHaveBeenCalledTimes(1);

      previous = applyForestLightingMaterialStateIfChanged(
        previous,
        { ...signature, textureUpdates: signature.textureUpdates + 1 },
        state,
        [tree, understory],
      );
      expect(tree.updateForestLighting).toHaveBeenCalledTimes(2);
      expect(understory.updateForestLighting).toHaveBeenCalledTimes(2);
    } finally {
      dispose();
    }
  });

  it("applies prop material state immediately when settings or texture handles change", () => {
    const first = materialStateFixture();
    const second = materialStateFixture();
    const tree = { updateForestLighting: vi.fn() };
    const understory = { updateForestLighting: vi.fn() };
    let previous: ForestLightingMaterialUpdateSignature | null = null;

    try {
      previous = applyForestLightingMaterialStateIfChanged(previous, first.signature, first.state, [tree, understory]);
      previous = applyForestLightingMaterialStateIfChanged(
        previous,
        { ...first.signature, settingsVersion: first.signature.settingsVersion + 1 },
        first.state,
        [tree, understory],
      );
      previous = applyForestLightingMaterialStateIfChanged(
        previous,
        { ...first.signature, settingsVersion: first.signature.settingsVersion + 1 },
        first.state,
        [tree, understory],
      );
      previous = applyForestLightingMaterialStateIfChanged(
        previous,
        { ...first.signature, textureHandle: second.state.textureHandle },
        second.state,
        [tree, understory],
      );

      expect(tree.updateForestLighting).toHaveBeenCalledTimes(3);
      expect(understory.updateForestLighting).toHaveBeenCalledTimes(3);
    } finally {
      first.dispose();
      second.dispose();
    }
  });
});

describe("forest lighting system lifecycle", () => {
  it("updates without trees and disposes", () => {
    const settings = cloneForestLightingSettings();
    settings.field.resolution = 8;
    const system = new ForestLightingSystem({ worldCells: 32, settings });
    system.update(0, new THREE.Vector3(0, 0, 0), {
      treeProxies: [],
      sunDirection: new THREE.Vector3(1, 1, 0).normalize(),
      force: true,
    });
    expect(system.getStats().textureUpdates).toBe(1);
    expect(system.getStats().maxCanopy).toBe(0);
    system.dispose();
  });

  it("updates stats and texture with tree proxies", () => {
    const settings = cloneForestLightingSettings();
    settings.field.resolution = 16;
    const system = new ForestLightingSystem({ worldCells: 64, settings });
    system.update(0, new THREE.Vector3(32, 0, 32), {
      treeProxies: [tree()],
      sunDirection: new THREE.Vector3(1, 1, 0).normalize(),
      force: true,
    });
    const stats = system.getStats();
    expect(stats.treeProxies).toBe(1);
    expect(stats.maxCanopy).toBeGreaterThan(0);
    expect(stats.maxAo).toBeGreaterThan(0);
    system.dispose();
  });

  it("disabled system produces neutral texture stats", () => {
    const settings = cloneForestLightingSettings();
    settings.enabled = false;
    settings.field.resolution = 8;
    const system = new ForestLightingSystem({ worldCells: 32, settings });
    system.update(0, new THREE.Vector3(16, 0, 16), {
      treeProxies: [tree()],
      sunDirection: new THREE.Vector3(1, 1, 0).normalize(),
      force: true,
    });
    const stats = system.getStats();
    expect(stats.enabled).toBe(false);
    expect(stats.maxCanopy).toBe(0);
    system.dispose();
  });
});

describe("tree lighting proxies", () => {
  it("returns stable world-space proxy copies without mutating page meshes", () => {
    const settings = cloneTreeSettings();
    settings.distanceM = 80;
    settings.maxInstances = 40;
    settings.placement.spacingM = 8;
    settings.placement.slopeMinY = 0;
    settings.placement.minHeightM = 0;
    settings.placement.maxHeightM = 100;
    settings.placement.minGroundWeight = 0;
    const page = node("L0:0,0", 0, { minX: 0, minZ: 0, maxX: 32, maxZ: 32 });
    const before = meshSignature(page.mesh);
    const system = new TreeSystem({
      scene: new THREE.Scene(),
      nodes: [page],
      worldCells: 32,
      settings,
      sampler: flatSampler(),
    });
    treeSystems.push(system);
    system.update(0, new THREE.Vector3(16, 0, 16));
    const first = system.getLightingProxies();
    const second = system.getLightingProxies();
    expect(first.length).toBeGreaterThan(0);
    expect(first).toEqual(second);
    first[0]!.x = -999;
    expect(system.getLightingProxies()[0]!.x).not.toBe(-999);
    expect(first[0]!.x).not.toBeCloseTo(first[0]!.z);
    expect(meshSignature(page.mesh)).toEqual(before);
  });

  it("accepts GPU ring tree proxies and produces canopy lighting", () => {
    const treeSettings = cloneTreeSettings();
    treeSettings.enabled = true;
    treeSettings.seed = 17;
    treeSettings.distanceM = 120;
    treeSettings.placement.slopeMinY = 0;
    treeSettings.placement.minHeightM = 0;
    treeSettings.placement.maxHeightM = 100;
    treeSettings.placement.minGroundWeight = 0;
    treeSettings.ecology.density.baseDensity = 1;
    treeSettings.ecology.clustering.clusterStrength = 0;
    treeSettings.species.oak.minHeightM = 0;
    treeSettings.species.oak.maxHeightM = 100;
    treeSettings.species.pine.minHeightM = 0;
    treeSettings.species.pine.maxHeightM = 100;
    treeSettings.species.dead.minHeightM = 0;
    treeSettings.species.dead.maxHeightM = 100;
    treeSettings.gpu.enabled = true;
    treeSettings.gpu.fallbackToCpu = false;
    const treeSystem = new TreeSystem({
      scene: new THREE.Scene(),
      nodes: [node("L0:0,0", 0, { minX: 0, minZ: 0, maxX: 256, maxZ: 256 })],
      worldCells: 256,
      settings: treeSettings,
      sampler: flatSampler(),
    });
    treeSystems.push(treeSystem);
    (treeSystem as unknown as { gpuStatus: "ring" }).gpuStatus = "ring";
    const proxies = treeSystem.getLightingProxies();
    expect(proxies.length).toBeGreaterThan(0);

    const lightingSettings = cloneForestLightingSettings();
    lightingSettings.field.resolution = 32;
    const lighting = new ForestLightingSystem({ worldCells: 256, settings: lightingSettings });
    lighting.update(0, new THREE.Vector3(128, 0, 128), {
      treeProxies: proxies,
      sunDirection: new THREE.Vector3(1, 1, 0).normalize(),
      force: true,
    });
    const stats = lighting.getStats();
    expect(stats.treeProxies).toBe(proxies.length);
    expect(stats.maxCanopy).toBeGreaterThan(0);
    lighting.dispose();
  });
});

function shaderStub(): THREE.WebGLProgramParametersWithUniforms {
  return {
    uniforms: {},
    vertexShader: "#include <common>\nvoid main(){\n#include <begin_vertex>\n}",
    fragmentShader: "#include <common>\nvoid main(){\nvec4 diffuseColor=vec4(1.0);\n#include <map_fragment>\n#include <color_fragment>\n#include <clipping_planes_fragment>\n}",
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
}

function materialStateFixture(): {
  state: ForestLightingMaterialState;
  signature: ForestLightingMaterialUpdateSignature;
  dispose: () => void;
} {
  const settings = cloneForestLightingSettings();
  settings.field.resolution = 4;
  const field = createForestLightingField(16, settings);
  const textureHandle = createForestLightingTexture(field);
  const state: ForestLightingMaterialState = { textureHandle, settings, worldCells: 16 };
  return {
    state,
    signature: {
      textureHandle,
      textureUpdates: 0,
      settingsVersion: 0,
      enabled: settings.enabled,
      debugMode: settings.materialIntegration.debugMode,
    },
    dispose: () => textureHandle.dispose(),
  };
}

function tree(overrides: Partial<ForestLightingTreeProxy> = {}): ForestLightingTreeProxy {
  return {
    x: 32,
    z: 32,
    height: 16,
    scale: 1,
    crownRadius: 7,
    species: "oak",
    ...overrides,
  };
}

function flatSampler(): TreeTerrainSampler {
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
    bounds: { center: [0, 0, 0], radius: 1, minY: 0, maxY: 0 },
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
