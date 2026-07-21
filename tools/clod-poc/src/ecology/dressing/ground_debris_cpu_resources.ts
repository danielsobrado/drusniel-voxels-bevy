import * as THREE from "three";
import type { DressingClassId } from "./class_registry.js";
import { createGroundDebrisCpuNodeMaterial } from "./ground_debris_cpu_node_material.js";
import { createGroundDebrisGeometry } from "./gpu/ground_debris_geometry.js";
import {
  GROUND_DEBRIS_CLASSES,
  groundDebrisVisualProfile,
} from "./gpu/ground_debris_visuals.js";

export interface GroundDebrisCpuMaterialState {
  readonly color: number;
  readonly roughness: number;
}

export interface GroundDebrisCpuResourcesOptions {
  readonly useWebGpuMaterials?: boolean;
}

export class GroundDebrisCpuResources {
  private readonly geometries = new Map<DressingClassId, THREE.BufferGeometry>();
  private readonly materials = new Map<DressingClassId, THREE.Material>();
  private disposed = false;

  constructor(options: GroundDebrisCpuResourcesOptions = {}) {
    for (const classId of GROUND_DEBRIS_CLASSES) {
      const geometry = createGroundDebrisGeometry(classId, 0);
      if (!geometry) throw new Error(`missing CPU ground-debris geometry: ${classId}`);
      this.geometries.set(classId, geometry);
      this.materials.set(classId, createGroundDebrisCpuMaterial(classId, options.useWebGpuMaterials === true));
    }
  }

  apply(scene: THREE.Scene): number {
    if (this.disposed) return 0;
    const root = scene.getObjectByName("ecological-dressing");
    if (!root) return 0;

    let applied = 0;
    for (const classId of GROUND_DEBRIS_CLASSES) {
      const object = root.getObjectByName(`dressing:${classId}`);
      if (!(object instanceof THREE.InstancedMesh)) continue;
      const geometry = this.geometries.get(classId);
      const material = this.materials.get(classId);
      if (!geometry || !material) continue;
      object.geometry = geometry;
      object.material = material;
      object.castShadow = false;
      object.receiveShadow = true;
      applied += 1;
    }
    return applied;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const geometry of this.geometries.values()) geometry.dispose();
    for (const material of this.materials.values()) material.dispose();
    this.geometries.clear();
    this.materials.clear();
  }
}

export function groundDebrisCpuMaterialState(classId: DressingClassId): GroundDebrisCpuMaterialState | null {
  const profile = groundDebrisVisualProfile(classId);
  if (!profile) return null;
  const alwaysWet = classId === "wet_stone_cluster";
  return {
    color: alwaysWet ? profile.wetColor : profile.baseColor,
    roughness: alwaysWet ? profile.wetRoughness : profile.dryRoughness,
  };
}

function createGroundDebrisCpuMaterial(
  classId: DressingClassId,
  useWebGpuMaterials: boolean,
): THREE.Material {
  if (useWebGpuMaterials) {
    const nodeMaterial = createGroundDebrisCpuNodeMaterial(classId);
    if (!nodeMaterial) throw new Error(`missing WebGPU CPU ground-debris material profile: ${classId}`);
    return nodeMaterial;
  }

  const state = groundDebrisCpuMaterialState(classId);
  if (!state) throw new Error(`missing CPU ground-debris material profile: ${classId}`);
  const material = new THREE.MeshStandardMaterial({
    color: state.color,
    roughness: state.roughness,
    metalness: 0,
    side: THREE.DoubleSide,
    transparent: false,
    alphaTest: 0,
    depthWrite: true,
  });
  material.name = `ground-debris-cpu-${classId}`;
  return material;
}
