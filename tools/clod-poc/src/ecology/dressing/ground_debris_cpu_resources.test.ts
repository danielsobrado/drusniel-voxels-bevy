import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  GroundDebrisCpuResources,
  groundDebrisCpuMaterialState,
} from "./ground_debris_cpu_resources.js";

describe("CPU ground-debris resources", () => {
  it("reuses the shared grounded geometry and material profiles", () => {
    const scene = new THREE.Scene();
    const root = new THREE.Group();
    root.name = "ecological-dressing";
    const originalGeometry = new THREE.CircleGeometry(1, 6);
    const originalMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const mesh = new THREE.InstancedMesh(originalGeometry, originalMaterial, 4);
    mesh.name = "dressing:leaf_litter";
    mesh.castShadow = true;
    root.add(mesh);
    scene.add(root);

    const resources = new GroundDebrisCpuResources();
    expect(resources.apply(scene)).toBe(1);
    expect(mesh.geometry).not.toBe(originalGeometry);
    expect(mesh.geometry.getAttribute("position").count).toBeGreaterThan(4);
    expect((mesh.material as THREE.Material).name).toBe("ground-debris-cpu-leaf_litter");
    expect(mesh.castShadow).toBe(false);
    expect(mesh.receiveShadow).toBe(true);

    resources.dispose();
    originalGeometry.dispose();
    originalMaterial.dispose();
  });

  it("keeps wet stones permanently dark and polished without claiming per-instance wetness", () => {
    const dry = groundDebrisCpuMaterialState("river_cobbles");
    const wet = groundDebrisCpuMaterialState("wet_stone_cluster");
    expect(dry).toEqual({ color: 0x787f7d, roughness: 0.82 });
    expect(wet).toEqual({ color: 0x283b3f, roughness: 0.28 });
  });

  it("ignores unrelated dressing classes and disposed resource sets", () => {
    expect(groundDebrisCpuMaterialState("dead_log_fresh")).toBeNull();
    const resources = new GroundDebrisCpuResources();
    resources.dispose();
    expect(resources.apply(new THREE.Scene())).toBe(0);
  });
});
