import * as THREE from "three";
import { createTreeBakedImpostorGeometry, type TreeGeometryMap } from "./tree_geometry.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";
import type { TreeLod, TreeSettings, TreeSpeciesId } from "./tree_config.js";

export interface TreeGpuRingGeometryInput {
  species: TreeSpeciesId;
  lod: TreeLod;
  geometries: TreeGeometryMap;
  settings: TreeSettings;
  impostorAtlases: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>>;
  bakedImpostorGeometries: Partial<Record<TreeSpeciesId, THREE.BufferGeometry>>;
}

export interface TreeGpuRingGeometryResult {
  geometry: THREE.BufferGeometry;
  bakedImpostor: boolean;
}

export function selectTreeGpuRingGeometry(input: TreeGpuRingGeometryInput): TreeGpuRingGeometryResult {
  if (input.lod !== "impostor") {
    return { geometry: input.geometries[input.species][input.lod], bakedImpostor: false };
  }

  const atlas = input.impostorAtlases[input.species];
  if (!input.settings.impostors.enabled || !atlas?.ready) {
    return { geometry: input.geometries[input.species].impostor, bakedImpostor: false };
  }

  input.bakedImpostorGeometries[input.species] ??= createTreeBakedImpostorGeometry(input.species, input.settings);
  return { geometry: input.bakedImpostorGeometries[input.species]!, bakedImpostor: true };
}
