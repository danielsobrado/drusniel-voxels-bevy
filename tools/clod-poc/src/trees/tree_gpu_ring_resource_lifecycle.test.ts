import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { TreeMaterialHandle } from "./tree_material.js";
import {
  disposeTreeGpuRingOwnedResources,
  disposeTreeGpuRingPrepassTwin,
} from "./tree_gpu_ring_resource_lifecycle.js";
import type { TreeGpuRingMesh } from "./tree_system_gpu_ring_draw.js";

describe("tree GPU ring resource lifecycle", () => {
  it("releases staged meshes, twins, geometries, and handles exactly once", () => {
    const root = new THREE.Group();
    const sharedGeometry = new THREE.InstancedBufferGeometry();
    const geometryDispose = vi.spyOn(sharedGeometry, "dispose");
    const handle = fakeHandle();
    const first = mesh(sharedGeometry, handle.regularMaterial);
    const second = mesh(sharedGeometry, handle.regularMaterial);
    const firstDispose = vi.spyOn(first as THREE.Mesh & { dispose(): void }, "dispose");
    const secondDispose = vi.spyOn(second as THREE.Mesh & { dispose(): void }, "dispose");
    root.add(first, second);

    const twinMaterial = new THREE.MeshBasicMaterial();
    const twinMaterialDispose = vi.spyOn(twinMaterial, "dispose");
    const twin = new THREE.Mesh(sharedGeometry, twinMaterial);
    const twinDispose = vi.spyOn(twin as THREE.Mesh & { dispose(): void }, "dispose");
    root.add(twin);

    disposeTreeGpuRingOwnedResources({
      root,
      meshes: [first, second],
      prepassTwins: [twin],
      materialHandles: { first: handle, duplicate: handle },
    });

    expect(root.children).toHaveLength(0);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(firstDispose).toHaveBeenCalledTimes(1);
    expect(secondDispose).toHaveBeenCalledTimes(1);
    expect(twinMaterialDispose).toHaveBeenCalledTimes(1);
    expect(twinDispose).toHaveBeenCalledTimes(1);
    expect(handle.dispose).toHaveBeenCalledTimes(1);
  });

  it("removes and disposes a prepass twin without disposing shared geometry", () => {
    const root = new THREE.Group();
    const geometry = new THREE.BufferGeometry();
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const material = new THREE.MeshBasicMaterial();
    const materialDispose = vi.spyOn(material, "dispose");
    const twin = new THREE.Mesh(geometry, material);
    const twinDispose = vi.spyOn(twin as THREE.Mesh & { dispose(): void }, "dispose");
    root.add(twin);

    disposeTreeGpuRingPrepassTwin(root, twin);

    expect(twin.parent).toBeNull();
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(twinDispose).toHaveBeenCalledTimes(1);
    expect(geometryDispose).not.toHaveBeenCalled();
  });
});

function mesh(geometry: THREE.InstancedBufferGeometry, material: THREE.Material): TreeGpuRingMesh {
  return new THREE.Mesh(geometry, material) as TreeGpuRingMesh;
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
