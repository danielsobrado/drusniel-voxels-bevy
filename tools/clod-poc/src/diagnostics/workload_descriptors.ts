import * as THREE from "three";

/**
 * Workload descriptors (rpg-content-density-scaling D1a): the cost-model axes every
 * benchmark content profile records and every dense baseline reports. A profile whose
 * descriptors cannot be measured cannot be gated, so publication is explicit about
 * which descriptors have a live measurement source (`wd_measured_*`).
 */
export const WORKLOAD_DESCRIPTOR_KEYS = [
  "visible_instances",
  "construction_pieces_total",
  "construction_pieces_visible",
  "interactive_props",
  "colliders",
  "shadow_casters",
  "transparent_instances",
  "unique_meshes",
  "unique_materials",
  "dynamic_lights",
  "texture_residency_est_mb",
  "triangles",
  "vegetation_candidates",
  "agents_full",
  "agents_mid",
  "agents_frozen",
] as const;

export type WorkloadDescriptorKey = (typeof WORKLOAD_DESCRIPTOR_KEYS)[number];

export type WorkloadDescriptorValues = Record<WorkloadDescriptorKey, number>;

export interface WorkloadDescriptorSample {
  readonly values: WorkloadDescriptorValues;
  readonly unmeasured: readonly WorkloadDescriptorKey[];
}

/** Keys measured by scene-graph traversal every sample (dynamic per frame). */
const SCENE_MEASURED_KEYS = new Set<WorkloadDescriptorKey>([
  "visible_instances",
  "construction_pieces_visible",
  "shadow_casters",
  "transparent_instances",
  "unique_meshes",
  "unique_materials",
  "dynamic_lights",
  "texture_residency_est_mb",
]);

/** Fallback chains into the shared stats counter record (first present wins). */
const COUNTER_SOURCES: Record<string, readonly string[]> = {
  construction_pieces_total: ["construction_placed_meshes", "rpg_density_construction_pieces_total"],
  interactive_props: ["props.interactive_total", "rpg_density_placed_props"],
  vegetation_candidates: ["props.gpu_candidates", "props.candidates"],
};

/** Counter groups whose contributions are additive rather than alternatives. */
const SUM_COUNTER_SOURCES: Record<string, readonly string[]> = {
  colliders: ["props.colliders_active", "construction_colliders_active", "terrain_colliders_active"],
};

/** Agent rings are defined as zero until the D5 envelopes exist. */
const AGENT_KEYS = ["agents_full", "agents_mid", "agents_frozen"] as const;

const MIP_CHAIN_FACTOR = 4 / 3;
const CONSTRUCTION_MESH_PREFIX = "construction-";

function instanceCount(object: THREE.Object3D): number {
  return object instanceof THREE.InstancedMesh ? object.count : 1;
}

function collectMaterials(object: THREE.Object3D): THREE.Material[] {
  const material = (object as THREE.Mesh).material;
  if (!material) return [];
  return Array.isArray(material) ? material : [material];
}

function estimateTextureBytes(texture: THREE.Texture): number {
  const image = texture.image as { width?: number; height?: number } | undefined;
  const width = image?.width ?? 0;
  const height = image?.height ?? 0;
  return width * height * 4 * MIP_CHAIN_FACTOR;
}

export interface SceneWorkloadDescriptors {
  visible_instances: number;
  construction_pieces_visible: number;
  shadow_casters: number;
  transparent_instances: number;
  unique_meshes: number;
  unique_materials: number;
  dynamic_lights: number;
  texture_residency_est_mb: number;
}

/** Traverses visible scene content; cost scales with scene size, so sample, don't run per frame. */
export function measureSceneWorkloadDescriptors(root: THREE.Object3D): SceneWorkloadDescriptors {
  let visibleInstances = 0;
  let constructionPiecesVisible = 0;
  let shadowCasters = 0;
  let transparentInstances = 0;
  let dynamicLights = 0;
  const geometries = new Set<string>();
  const materials = new Set<string>();
  const textures = new Map<string, number>();

  root.traverseVisible((object) => {
    if (object instanceof THREE.Light) {
      if (!(object instanceof THREE.AmbientLight) && !(object instanceof THREE.HemisphereLight)) {
        dynamicLights++;
      }
      return;
    }
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh && !(object instanceof THREE.Points) && !(object instanceof THREE.LineSegments)) return;
    const count = instanceCount(object);
    visibleInstances += count;
    if (object.name.startsWith(CONSTRUCTION_MESH_PREFIX)) constructionPiecesVisible += count;
    if (object.castShadow) shadowCasters += count;
    if (mesh.geometry) geometries.add(mesh.geometry.uuid);
    for (const material of collectMaterials(object)) {
      materials.add(material.uuid);
      if (material.transparent) transparentInstances += count;
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.set(value.uuid, estimateTextureBytes(value));
      }
    }
  });

  let textureBytes = 0;
  for (const bytes of textures.values()) textureBytes += bytes;

  return {
    visible_instances: visibleInstances,
    construction_pieces_visible: constructionPiecesVisible,
    shadow_casters: shadowCasters,
    transparent_instances: transparentInstances,
    unique_meshes: geometries.size,
    unique_materials: materials.size,
    dynamic_lights: dynamicLights,
    texture_residency_est_mb: Number((textureBytes / (1024 * 1024)).toFixed(2)),
  };
}

export interface WorkloadDescriptorInput {
  readonly scene: THREE.Object3D;
  readonly counters: Readonly<Record<string, number>>;
  /** Submitted triangles for the sampled frame (EngineStats.triangles). */
  readonly triangles: number;
}

function sumPresentCounters(counters: Readonly<Record<string, number>>, sources: readonly string[]): number | null {
  let found = false;
  let total = 0;
  for (const source of sources) {
    const value = counters[source];
    if (value === undefined) continue;
    found = true;
    total += value;
  }
  return found ? total : null;
}

export function sampleWorkloadDescriptors(input: WorkloadDescriptorInput): WorkloadDescriptorSample {
  const sceneDescriptors = measureSceneWorkloadDescriptors(input.scene);
  const values = {} as WorkloadDescriptorValues;
  const unmeasured: WorkloadDescriptorKey[] = [];

  for (const key of WORKLOAD_DESCRIPTOR_KEYS) {
    if (SCENE_MEASURED_KEYS.has(key)) {
      values[key] = sceneDescriptors[key as keyof SceneWorkloadDescriptors];
      continue;
    }
    if (key === "triangles") {
      values[key] = input.triangles;
      continue;
    }
    if ((AGENT_KEYS as readonly string[]).includes(key)) {
      values[key] = input.counters[key] ?? 0;
      continue;
    }
    const summed = SUM_COUNTER_SOURCES[key]
      ? sumPresentCounters(input.counters, SUM_COUNTER_SOURCES[key]!)
      : null;
    if (summed !== null) {
      values[key] = summed;
      continue;
    }
    const source = COUNTER_SOURCES[key]?.find((name) => input.counters[name] !== undefined);
    if (source === undefined) {
      values[key] = 0;
      unmeasured.push(key);
      continue;
    }
    values[key] = input.counters[source] ?? 0;
  }

  return { values, unmeasured };
}

/** Writes wd_<key> plus wd_measured_<key> (0/1) and wd_unmeasured_count into the shared counters. */
export function publishWorkloadDescriptors(
  counters: Record<string, number>,
  sample: WorkloadDescriptorSample,
): void {
  const unmeasured = new Set(sample.unmeasured);
  for (const key of WORKLOAD_DESCRIPTOR_KEYS) {
    counters[`wd_${key}`] = sample.values[key];
    counters[`wd_measured_${key}`] = unmeasured.has(key) ? 0 : 1;
  }
  counters["wd_unmeasured_count"] = sample.unmeasured.length;
}
