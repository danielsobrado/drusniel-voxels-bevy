import * as THREE from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { GroundDebrisCpuResources } from "./ground_debris_cpu_resources.js";

function createScene(): { scene: THREE.Scene; mesh: THREE.InstancedMesh } {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.name = "ecological-dressing";
  const mesh = new THREE.InstancedMesh(
    new THREE.CircleGeometry(1, 6),
    new THREE.MeshStandardMaterial(),
    1,
  );
  mesh.name = "dressing:leaf_litter";
  root.add(mesh);
  scene.add(root);
  return { scene, mesh };
}

describe("CPU ground-debris renderer mode", () => {
  it("uses NodeMaterial resources under the WebGPU renderer", () => {
    const { scene, mesh } = createScene();
    const originalGeometry = mesh.geometry;
    const originalMaterial = mesh.material as THREE.Material;
    const resources = new GroundDebrisCpuResources({ useWebGpuMaterials: true });

    expect(resources.apply(scene)).toBe(1);
    expect(mesh.material).toBeInstanceOf(MeshStandardNodeMaterial);
    expect((mesh.material as THREE.Material).name).toBe("ground-debris-cpu-webgpu-leaf_litter");

    resources.dispose();
    originalGeometry.dispose();
    originalMaterial.dispose();
  });

  it("keeps classic materials for the WebGL renderer", () => {
    const { scene, mesh } = createScene();
    const originalGeometry = mesh.geometry;
    const originalMaterial = mesh.material as THREE.Material;
    const resources = new GroundDebrisCpuResources({ useWebGpuMaterials: false });

    expect(resources.apply(scene)).toBe(1);
    expect(mesh.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(mesh.material).not.toBeInstanceOf(MeshStandardNodeMaterial);

    resources.dispose();
    originalGeometry.dispose();
    originalMaterial.dispose();
  });
});
