import * as THREE from "three";
import type { TreeLod, TreeSettings, TreeSpeciesId } from "./tree_config.js";
import { createTreeBakedImpostorGeometry, type TreeGeometryMap } from "./tree_geometry.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";
import {
  createSelectedTreeImpostorMaterial,
  treeImpostorMaterialMatchesSelection,
  type TreeImpostorMaterialSelection,
} from "./tree_impostor_material_selector.js";
import { updateTreeImpostorMaterialSettings } from "./tree_impostor_material.js";
import type { TreeMaterialHandle } from "./tree_material.js";

export interface TreeSystemGeometryInput {
  species: TreeSpeciesId;
  lod: TreeLod;
  settings: TreeSettings;
  geometries: TreeGeometryMap;
  impostorAtlases: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>>;
  bakedImpostorGeometries: Partial<Record<TreeSpeciesId, THREE.BufferGeometry>>;
}

export interface TreeSystemMaterialInput {
  species: TreeSpeciesId;
  lod: TreeLod;
  settings: TreeSettings;
  materialHandle: TreeMaterialHandle;
  impostorAtlases: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>>;
  impostorMaterials: Partial<Record<TreeSpeciesId, THREE.Material>>;
}

export interface TreeSystemImpostorMaterialUpdateInput {
  species: TreeSpeciesId;
  settings: TreeSettings;
  atlas: TreeImpostorAtlas;
  webgpu: boolean;
  viewBlend?: boolean;
  viewBlendGeometryReady?: boolean;
  impostorMaterials: Partial<Record<TreeSpeciesId, THREE.Material>>;
}

export function treeCanUseBakedImpostor(
  settings: TreeSettings,
  impostorAtlases: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>>,
  species: TreeSpeciesId,
): boolean {
  return settings.impostors.enabled && !!impostorAtlases[species]?.ready;
}

export function treeUnbakedImpostorFallbackLod(settings: TreeSettings): TreeLod {
  return settings.impostors.enabled ? "impostor" : "far";
}

export function selectTreeSystemGeometry(input: TreeSystemGeometryInput): THREE.BufferGeometry {
  if (input.lod === "impostor") {
    const atlas = input.impostorAtlases[input.species];
    if (treeCanUseBakedImpostor(input.settings, input.impostorAtlases, input.species)) {
      input.bakedImpostorGeometries[input.species] ??= createTreeBakedImpostorGeometry(input.species, input.settings, atlas);
      return input.bakedImpostorGeometries[input.species]!;
    }
    return input.geometries[input.species][treeUnbakedImpostorFallbackLod(input.settings)];
  }
  return input.geometries[input.species][input.lod];
}

export function selectTreeSystemMaterial(input: TreeSystemMaterialInput): THREE.Material {
  if (input.settings.render.debugColorByLod) return input.materialHandle.debugMaterials[input.lod];
  if (input.lod === "impostor" && treeCanUseBakedImpostor(input.settings, input.impostorAtlases, input.species)) {
    return input.impostorMaterials[input.species] ?? input.materialHandle.regularMaterial;
  }
  return input.materialHandle.regularMaterial;
}

export function updateTreeSystemImpostorMaterial(input: TreeSystemImpostorMaterialUpdateInput): THREE.Material {
  const selection: TreeImpostorMaterialSelection = {
    webgpu: input.webgpu,
    viewBlend: !!input.viewBlend && !!input.viewBlendGeometryReady,
  };
  const current = input.impostorMaterials[input.species];
  if (!treeImpostorMaterialMatchesSelection(current, selection)) {
    current?.dispose();
    input.impostorMaterials[input.species] = createSelectedTreeImpostorMaterial(input.settings, input.atlas, selection);
  }
  const material = input.impostorMaterials[input.species]!;
  updateTreeImpostorMaterialSettings(material, input.settings);
  return material;
}

export function disposeTreeSystemBakedImpostorGeometries(
  geometries: Partial<Record<TreeSpeciesId, THREE.BufferGeometry>>,
): void {
  for (const geometry of Object.values(geometries)) geometry?.dispose();
}

export function disposeTreeSystemImpostorMaterials(
  materials: Partial<Record<TreeSpeciesId, THREE.Material>>,
): void {
  for (const material of Object.values(materials)) material?.dispose();
}
