import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { cloneTreeSettings, type TreeLod } from "./tree_config.js";
import type { TreeMaterialHandle } from "./tree_material.js";
import {
  clearTreeGpuRing,
  createTreeGpuRingRuntimeState,
  updateTreeGpuRingTrees,
  type TreeGpuRingRuntimeInput,
} from "./tree_system_gpu_ring_runtime.js";
import type { TreeGpuRingDrawResources, TreeWebGpuBackendAccess } from "./tree_system_types.js";
import type { TreeGpuRingMesh } from "./tree_system_gpu_ring_draw.js";

describe("tree GPU ring runtime failure handling", () => {
  it("falls back once and latches a synchronous initialization failure", () => {
    const fixture = runtimeFixture(true);
    fixture.createDrawResources.mockImplementation(() => {
      throw new Error("tree draw init failed");
    });

    expect(updateTreeGpuRingTrees(fixture.input, new THREE.Vector3())).toBe(false);
    expect(fixture.input.state.status).toBe("fallback-cpu");
    expect(fixture.input.state.stats.status).toBe("failed");
    expect(fixture.input.state.stats.reason).toBe("tree draw init failed");
    expect(fixture.input.state.failedKey).not.toBe("");
    expect(fixture.createDrawResources).toHaveBeenCalledTimes(1);

    expect(updateTreeGpuRingTrees(fixture.input, new THREE.Vector3())).toBe(false);
    expect(fixture.createDrawResources).toHaveBeenCalledTimes(1);

    fixture.input.settings.seed++;
    expect(updateTreeGpuRingTrees(fixture.input, new THREE.Vector3())).toBe(false);
    expect(fixture.createDrawResources).toHaveBeenCalledTimes(2);
  });

  it("reports an error without CPU fallback and does not retry the same key", () => {
    const fixture = runtimeFixture(false);
    fixture.createDrawResources.mockImplementation(() => {
      throw new Error("tree draw init failed");
    });

    expect(updateTreeGpuRingTrees(fixture.input, new THREE.Vector3())).toBe(false);
    expect(fixture.input.state.status).toBe("error");
    expect(updateTreeGpuRingTrees(fixture.input, new THREE.Vector3())).toBe(false);
    expect(fixture.createDrawResources).toHaveBeenCalledTimes(1);
  });

  it("allows an explicit clear to retry the same configuration", () => {
    const fixture = runtimeFixture(true);
    fixture.createDrawResources.mockImplementation(() => {
      throw new Error("tree draw init failed");
    });

    expect(updateTreeGpuRingTrees(fixture.input, new THREE.Vector3())).toBe(false);
    clearTreeGpuRing(fixture.input);
    expect(fixture.input.state.failedKey).toBe("");
    expect(updateTreeGpuRingTrees(fixture.input, new THREE.Vector3())).toBe(false);
    expect(fixture.createDrawResources).toHaveBeenCalledTimes(2);
  });

  it("disposes full ring mesh and prepass state through canonical ownership", () => {
    const fixture = runtimeFixture(true);
    const geometry = new THREE.InstancedBufferGeometry();
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const handle = fakeHandle();
    const mesh = new THREE.Mesh(geometry, handle.regularMaterial) as TreeGpuRingMesh;
    const meshDispose = vi.spyOn(mesh as THREE.Mesh & { dispose(): void }, "dispose");
    const twinMaterial = new THREE.MeshBasicMaterial();
    const twinMaterialDispose = vi.spyOn(twinMaterial, "dispose");
    const twin = new THREE.Mesh(geometry, twinMaterial);
    const twinDispose = vi.spyOn(twin as THREE.Mesh & { dispose(): void }, "dispose");
    fixture.input.root.add(mesh, twin);
    fixture.input.state.ringMeshes = [mesh];
    fixture.input.state.prepassTwins = [twin];
    fixture.input.state.draw = {
      meshes: [mesh],
      materialHandles: { oak: handle },
    } as TreeGpuRingDrawResources;

    clearTreeGpuRing(fixture.input);

    expect(fixture.input.root.children).toHaveLength(0);
    expect(meshDispose).toHaveBeenCalledTimes(1);
    expect(twinDispose).toHaveBeenCalledTimes(1);
    expect(twinMaterialDispose).toHaveBeenCalledTimes(1);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(handle.dispose).toHaveBeenCalledTimes(1);
    expect(fixture.input.state.ringMeshes).toEqual([]);
    expect(fixture.input.state.prepassTwins).toEqual([]);
    expect(fixture.input.state.draw).toBeNull();
  });
});

function runtimeFixture(fallbackToCpu: boolean): {
  input: TreeGpuRingRuntimeInput;
  createDrawResources: ReturnType<typeof vi.fn>;
} {
  const settings = cloneTreeSettings();
  settings.gpu.fallbackToCpu = fallbackToCpu;
  const createDrawResources = vi.fn<() => TreeGpuRingDrawResources>();
  const lodCounts = { near: 0, mid: 0, far: 0, impostor: 0 } satisfies Record<TreeLod, number>;
  return {
    createDrawResources,
    input: {
      state: createTreeGpuRingRuntimeState({} as GPUDevice),
      root: new THREE.Group(),
      settings,
      worldCells: 64,
      sampler: undefined,
      gpuDevice: {} as GPUDevice,
      gpuBackend: {} as TreeWebGpuBackendAccess,
      supportsGpuTrees: true,
      unsupportedReason: null,
      lodCounts,
      createDrawResources,
      geometryForGpuRing: () => new THREE.BoxGeometry(1, 1, 1),
    },
  };
}

function fakeHandle(): TreeMaterialHandle & { dispose: ReturnType<typeof vi.fn> } {
  const regularMaterial = new THREE.MeshBasicMaterial();
  const debugMaterial = new THREE.MeshBasicMaterial();
  const dispose = vi.fn(() => {
    regularMaterial.dispose();
    debugMaterial.dispose();
  });
  return {
    regularMaterial,
    debugMaterials: {
      near: debugMaterial,
      mid: debugMaterial,
      far: debugMaterial,
      impostor: debugMaterial,
    },
    setTime() {},
    updateSettings() {},
    dispose,
  };
}
