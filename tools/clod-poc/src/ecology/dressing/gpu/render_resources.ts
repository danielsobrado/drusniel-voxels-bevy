import * as THREE from "three";
import { MeshStandardNodeMaterial, StorageBufferAttribute, StorageInstancedBufferAttribute } from "three/webgpu";
import {
  cos,
  instanceIndex,
  normalGeometry,
  positionGeometry,
  sin,
  storage,
  vec3,
} from "three/tsl";
import type { VegetationGpuBackend } from "../../../runtime/vegetation/vegetation_gpu_backend.js";
import {
  DRESSING_CLASSES,
  DRESSING_CLASS_DEFINITIONS,
  type DressingClassId,
} from "../class_registry.js";
import { createGroundDebrisGeometry } from "./ground_debris_geometry.js";
import { applyGroundDebrisMaterial } from "./ground_debris_material.js";
import {
  DRESSING_GPU_GROUP_COUNT,
  DRESSING_GPU_INDIRECT_WORDS,
  DRESSING_GPU_LOD_COUNT,
  DRESSING_GPU_RECORD_VEC4S,
  dressingGpuGroupIndex,
} from "./layouts.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

export interface DressingGpuOutputBuffers {
  readonly records: GPUBuffer;
  readonly indirectArgs: GPUBuffer;
}

export interface DressingGpuDrawResources {
  readonly root: THREE.Group;
  readonly records: StorageInstancedBufferAttribute;
  readonly indirect: StorageBufferAttribute;
  readonly outputBuffers: DressingGpuOutputBuffers;
  readonly indexCounts: Uint32Array;
  readonly materials: readonly MeshStandardNodeMaterial[];
  readonly geometries: readonly THREE.BufferGeometry[];
  dispose(): void;
}

export function createDressingGpuDrawResources(
  scene: THREE.Scene,
  backend: VegetationGpuBackend,
  capacityPerGroup: number,
  worldCells: number,
): DressingGpuDrawResources {
  const capacity = Math.max(1, Math.floor(capacityPerGroup));
  const root = new THREE.Group();
  root.name = "ecological-dressing-gpu";
  scene.add(root);

  const records = new StorageInstancedBufferAttribute(
    capacity * DRESSING_GPU_GROUP_COUNT * DRESSING_GPU_RECORD_VEC4S,
    4,
  );
  records.name = "dressing-gpu-records";
  backend.createStorageAttribute(records);
  const indirect = new StorageBufferAttribute(
    new Uint32Array(DRESSING_GPU_GROUP_COUNT * DRESSING_GPU_INDIRECT_WORDS),
    DRESSING_GPU_INDIRECT_WORDS,
  );
  indirect.name = "dressing-gpu-indirect";
  backend.createIndirectStorageAttribute(indirect);

  const recordBuffer = backend.get(records).buffer;
  const indirectBuffer = backend.get(indirect).buffer;
  if (!recordBuffer || !indirectBuffer) throw new Error("dressing GPU draw buffers were not created by the WebGPU backend");

  const materials: MeshStandardNodeMaterial[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const indexCounts = new Uint32Array(DRESSING_GPU_GROUP_COUNT);
  try {
    for (const classId of DRESSING_CLASSES) {
      const material = createDressingGpuMaterial(classId, records, capacity * DRESSING_GPU_GROUP_COUNT);
      materials.push(material);
      for (let lod = 0; lod < DRESSING_GPU_LOD_COUNT; lod++) {
        const source = createDressingGeometry(classId, lod);
        geometries.push(source);
        const group = dressingGpuGroupIndex(classId, lod);
        indexCounts[group] = indexCount(source);
        if (indexCounts[group] === 0) continue;
        const geometry = createIndirectGeometry(source, capacity, indirect, group, worldCells);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `dressing-gpu-${classId}-lod${lod}`;
        mesh.frustumCulled = false;
        mesh.castShadow = lod === 0 && DRESSING_CLASS_DEFINITIONS[classId].castsNearShadow;
        mesh.receiveShadow = true;
        root.add(mesh);
      }
    }
  } catch (error) {
    scene.remove(root);
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    materials.forEach((material) => material.dispose());
    geometries.forEach((geometry) => geometry.dispose());
    records.dispose();
    indirect.dispose();
    throw error;
  }

  return {
    root,
    records,
    indirect,
    outputBuffers: { records: recordBuffer, indirectArgs: indirectBuffer },
    indexCounts,
    materials,
    geometries,
    dispose() {
      scene.remove(root);
      root.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      materials.forEach((material) => material.dispose());
      geometries.forEach((geometry) => geometry.dispose());
      records.dispose();
      indirect.dispose();
      root.clear();
    },
  };
}

function createDressingGpuMaterial(
  classId: DressingClassId,
  records: StorageInstancedBufferAttribute,
  capacity: number,
): MeshStandardNodeMaterial {
  const recordNodes: TslNode = storage(records, "vec4", capacity * DRESSING_GPU_RECORD_VEC4S).toReadOnly();
  const base: TslNode = instanceIndex.mul(DRESSING_GPU_RECORD_VEC4S);
  const positionScale: TslNode = recordNodes.element(base);
  const rotationEnvironment: TslNode = recordNodes.element(base.add(1));
  const yaw: TslNode = rotationEnvironment.x;
  const scale: TslNode = positionScale.w;
  const c: TslNode = cos(yaw);
  const s: TslNode = sin(yaw);
  const local: TslNode = positionGeometry.mul(scale);
  const rotated: TslNode = vec3(
    local.x.mul(c).add(local.z.mul(s)),
    local.y,
    local.z.mul(c).sub(local.x.mul(s)),
  );
  const sourceNormal: TslNode = normalGeometry;
  const normal: TslNode = vec3(
    sourceNormal.x.mul(c).add(sourceNormal.z.mul(s)),
    sourceNormal.y,
    sourceNormal.z.mul(c).sub(sourceNormal.x.mul(s)),
  ).normalize();

  const material = new MeshStandardNodeMaterial();
  material.name = `dressing-gpu-material-${classId}`;
  material.positionNode = positionScale.xyz.add(rotated);
  material.normalNode = normal;
  if (!applyGroundDebrisMaterial(material, classId, { positionScale, rotationEnvironment })) {
    material.color = new THREE.Color(CLASS_COLORS[classId]);
    material.roughness = classId === "wet_stone_cluster" ? 0.34 : classId.includes("lichen") ? 0.95 : 0.78;
    material.metalness = 0;
    material.side = THREE.DoubleSide;
    material.transparent = false;
    material.alphaTest = 0;
  }
  return material;
}

function createIndirectGeometry(
  source: THREE.BufferGeometry,
  capacity: number,
  indirect: StorageBufferAttribute,
  group: number,
  worldCells: number,
): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry() as THREE.InstancedBufferGeometry & {
    setIndirect?(attribute: THREE.BufferAttribute, offset: number): void;
  };
  geometry.setIndex(source.getIndex());
  for (const name of Object.keys(source.attributes)) geometry.setAttribute(name, source.getAttribute(name));
  geometry.instanceCount = capacity;
  if (!geometry.setIndirect) throw new Error("dressing GPU rendering requires InstancedBufferGeometry.setIndirect support");
  geometry.setIndirect(indirect, group * DRESSING_GPU_INDIRECT_WORDS * Uint32Array.BYTES_PER_ELEMENT);
  const extent = Math.max(512, worldCells + 256);
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(-extent, -128, -extent),
    new THREE.Vector3(extent, 512, extent),
  );
  geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
  return geometry;
}

function createDressingGeometry(classId: DressingClassId, lod: number): THREE.BufferGeometry {
  const debrisGeometry = createGroundDebrisGeometry(classId, lod);
  if (debrisGeometry) return debrisGeometry;
  if (lod === 2) return farCardGeometry(classId);
  const family = DRESSING_CLASS_DEFINITIONS[classId].geometryFamily;
  const low = lod === 1;
  if (family === "dead_log" || family === "driftwood") {
    const geometry = new THREE.CylinderGeometry(0.22, 0.3, family === "driftwood" ? 2.5 : 3.2, low ? 5 : 7, 1, false);
    geometry.rotateZ(Math.PI / 2);
    return geometry;
  }
  if (family === "stump") return new THREE.CylinderGeometry(0.33, 0.42, 0.65, low ? 6 : 8);
  if (family === "broken_snag") return new THREE.CylinderGeometry(0.17, 0.34, 3.8, low ? 5 : 7);
  if (family === "fungus_shelf") {
    const geometry = new THREE.SphereGeometry(0.22, low ? 6 : 8, 4, 0, Math.PI, 0, Math.PI / 2);
    geometry.scale(1.4, 0.32, 0.8);
    return geometry;
  }
  if (family === "fungus_cap") {
    const geometry = new THREE.SphereGeometry(0.18, low ? 6 : 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    geometry.scale(1, 0.35, 1);
    return geometry;
  }
  if (family === "vine") return new THREE.CylinderGeometry(0.018, 0.025, 2.2, 5);
  if (family.includes("fern")) return crossedCards(0.75, 0.85);
  if (family === "river_cobble" || family === "wet_stone" || family === "small_talus") {
    const geometry = new THREE.IcosahedronGeometry(family === "small_talus" ? 0.45 : 0.25, 0);
    geometry.scale(1.2, 0.55, 0.9);
    return geometry;
  }
  if (family === "flower_patch") return crossedCards(0.5, 0.55);
  if (family.includes("litter") || family.includes("cluster") || family.includes("patch")) {
    const geometry = new THREE.CircleGeometry(family.includes("litter") ? 0.75 : 0.55, low ? 5 : 7);
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  }
  return crossedCards(0.55, 0.6);
}

function farCardGeometry(classId: DressingClassId): THREE.BufferGeometry {
  const family = DRESSING_CLASS_DEFINITIONS[classId].geometryFamily;
  if (family === "dead_log" || family === "driftwood") return crossedCards(2.4, 0.65);
  if (family === "broken_snag") return crossedCards(0.9, 3.8);
  if (family === "stump" || family === "river_cobble" || family === "wet_stone" || family === "small_talus") {
    return crossedCards(0.9, 0.7);
  }
  return crossedCards(0.8, 0.85);
}

function crossedCards(width: number, height: number): THREE.BufferGeometry {
  const positions = new Float32Array([
    -width / 2, 0, 0, width / 2, 0, 0, width / 2, height, 0, -width / 2, height, 0,
    0, 0, -width / 2, 0, 0, width / 2, 0, height, width / 2, 0, height, -width / 2,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  geometry.computeVertexNormals();
  return geometry;
}

function indexCount(geometry: THREE.BufferGeometry): number {
  return geometry.getIndex()?.count ?? geometry.getAttribute("position")?.count ?? 0;
}

const CLASS_COLORS: Readonly<Record<DressingClassId, number>> = {
  dead_log_fresh: 0x76503a,
  dead_log_mossy: 0x4e5936,
  dead_log_rotten: 0x3f3429,
  stump_fresh: 0x76503a,
  stump_rotten: 0x3f3429,
  broken_snag: 0x554536,
  large_driftwood: 0x88765d,
  large_talus_boulder: 0x656761,
  shelf_fungus: 0xc49a6c,
  cap_fungus: 0xb77952,
  trunk_moss: 0x42643a,
  trunk_lichen: 0x9a9d78,
  root_moss: 0x365d35,
  hanging_vine: 0x3e6736,
  root_fern: 0x3b7440,
  moss_patch: 0x476f3c,
  lichen_patch: 0x9ca477,
  leaf_litter: 0x5f432b,
  needle_litter: 0x51452c,
  twig_cluster: 0x6b4a31,
  bark_chip_cluster: 0x68422c,
  small_talus: 0x77776e,
  river_cobbles: 0x787f7d,
  wet_stone_cluster: 0x3f4b4c,
  small_driftwood: 0x817057,
  bank_fern: 0x3d7843,
  cave_mouth_fern: 0x315f3a,
  cliff_fern: 0x4a7747,
  flower_patch: 0xc989a5,
};
