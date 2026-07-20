import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { TREE_LODS, TREE_SPECIES, type TreeLod } from "./tree_config.js";
import { applyTreeGpuRingDebugColorMaterials } from "./tree_gpu_ring_debug_material.js";
import type { TreeMaterialHandle } from "./tree_material.js";
import type { TreeGpuRingMesh } from "./tree_system_gpu_ring_draw.js";
import type { TreeGpuRingDrawResources } from "./tree_system_types.js";

describe("tree GPU ring debug materials", () => {
  it("swaps only visible LOD draws and restores regular materials", () => {
    const meshes: TreeGpuRingMesh[] = [];
    const handles: Record<string, TreeMaterialHandle> = {};
    const ownedMaterials = new Set<THREE.Material>();
    const ownedGeometries = new Set<THREE.BufferGeometry>();

    for (const species of TREE_SPECIES) {
      for (const lod of TREE_LODS) {
        const regularMaterial = new THREE.MeshBasicMaterial();
        const debugMaterials = debugMaterialMap();
        const handle = materialHandle(regularMaterial, debugMaterials);
        const geometry = new THREE.InstancedBufferGeometry();
        const mesh = new THREE.Mesh(geometry, regularMaterial) as TreeGpuRingMesh;
        mesh.name = `trees-ring-gpu-${species}-${lod}`;

        handles[`${species}:${lod}`] = handle;
        meshes.push(mesh);
        ownedMaterials.add(regularMaterial);
        for (const material of Object.values(debugMaterials)) ownedMaterials.add(material);
        ownedGeometries.add(geometry);
      }
    }

    const shadowMaterial = new THREE.MeshBasicMaterial();
    const shadowGeometry = new THREE.InstancedBufferGeometry();
    const shadowMesh = new THREE.Mesh(shadowGeometry, shadowMaterial) as TreeGpuRingMesh;
    shadowMesh.name = `trees-ring-gpu-shadow-c0-${TREE_SPECIES[0]}-${TREE_LODS[0]}`;
    meshes.push(shadowMesh);
    ownedMaterials.add(shadowMaterial);
    ownedGeometries.add(shadowGeometry);

    const resources = { meshes, materialHandles: handles } as unknown as TreeGpuRingDrawResources;
    try {
      applyTreeGpuRingDebugColorMaterials(resources, true);
      for (const species of TREE_SPECIES) {
        for (const lod of TREE_LODS) {
          const mesh = meshes.find((candidate) => candidate.name === `trees-ring-gpu-${species}-${lod}`);
          expect(mesh?.material).toBe(handles[`${species}:${lod}`].debugMaterials[lod]);
        }
      }
      expect(shadowMesh.material).toBe(shadowMaterial);

      applyTreeGpuRingDebugColorMaterials(resources, false);
      for (const species of TREE_SPECIES) {
        for (const lod of TREE_LODS) {
          const mesh = meshes.find((candidate) => candidate.name === `trees-ring-gpu-${species}-${lod}`);
          expect(mesh?.material).toBe(handles[`${species}:${lod}`].regularMaterial);
        }
      }
      expect(shadowMesh.material).toBe(shadowMaterial);
    } finally {
      for (const geometry of ownedGeometries) geometry.dispose();
      for (const material of ownedMaterials) material.dispose();
    }
  });

  it("is a no-op before GPU ring resources exist", () => {
    expect(() => applyTreeGpuRingDebugColorMaterials(null, true)).not.toThrow();
  });
});

function debugMaterialMap(): Record<TreeLod, THREE.Material> {
  return {
    near: new THREE.MeshBasicMaterial(),
    mid: new THREE.MeshBasicMaterial(),
    far: new THREE.MeshBasicMaterial(),
    impostor: new THREE.MeshBasicMaterial(),
  };
}

function materialHandle(
  regularMaterial: THREE.Material,
  debugMaterials: Record<TreeLod, THREE.Material>,
): TreeMaterialHandle {
  return {
    regularMaterial,
    debugMaterials,
    setTime() {},
    updateSettings() {},
    dispose() {},
  };
}
