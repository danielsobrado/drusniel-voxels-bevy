import * as THREE from "three";
import { disposeTreeGeometryMap, createTreeGeometryMap, treeGeometryKey, type TreeGeometryMap } from "./tree_geometry.js";
import type { TreeLod, TreeSettings, TreeSpeciesId } from "./tree_config.js";
import { TREE_SPECIES } from "./tree_config.js";
import type { TreeHydrologyWater } from "./tree_node_material.js";
import { createTreeMaterialHandle, type TreeMaterialHandle } from "./tree_material.js";
import { createTreeNodeMaterialHandle } from "./tree_node_material.js";
import { createTreeCrownProxyGeometry } from "./tree_crown_proxy_math.js";
import type { EnvironmentLighting } from "../environment/environment.js";
import type { ForestLightingMaterialState } from "../forest_lighting/index.js";
import { bakeTreeImpostorAtlases, type TreeImpostorAtlas } from "./tree_impostor_baker.js";
import { publishTreeImpostorDebugStatus } from "./tree_impostor_debug.js";
import { selectTreeGpuRingGeometry } from "./tree_gpu_ring_geometry.js";
import { createTreeFoliageAtlas, type TreeFoliageAtlas } from "./tree_alpha_mask.js";
import { bakeTreeFoliageAtlas, replaceTreeFoliageAtlasData } from "./tree_foliage_atlas_baker.js";
import { publishTreeFoliageAtlasDebugStatus } from "./tree_foliage_atlas_debug.js";
import { decorateTreeMaterialHandle } from "./tree_material_parity.js";
import {
  disposeTreeSystemBakedImpostorGeometries,
  disposeTreeSystemImpostorMaterials,
  selectTreeSystemGeometry,
  selectTreeSystemMaterial,
  updateTreeSystemImpostorMaterial,
} from "./tree_system_impostor_resources.js";
import {
  applyTreeSystemMaterials,
  replaceTreeSystemImpostorGeometries,
} from "./tree_system_material_application.js";
import type { TreePatch, TreeImpostorStatus } from "./tree_system_types.js";
import type { TreeMeshBoundsState } from "./tree_system_mesh_bounds.js";

export interface TreeSystemAssetsOptions {
  settings: TreeSettings;
  webgpu: boolean;
  lighting?: EnvironmentLighting;
  hydrologyWater?: TreeHydrologyWater;
  impostorAtlases?: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>>;
}

export type TreeFoliageAtlasStatus = "generated" | "capturing" | "captured" | "fallback";

export class TreeSystemAssets {
  readonly crownProxyGeometry = createTreeCrownProxyGeometry();
  materialHandle: TreeMaterialHandle;
  foliageAtlas: TreeFoliageAtlas;
  foliageAtlasStatus: TreeFoliageAtlasStatus = "generated";
  foliageAtlasReason: string | null = null;
  geometries: TreeGeometryMap;
  geometryKey: string;
  impostorStatus: TreeImpostorStatus;
  impostorReason: string | null = null;
  bakedImpostorGeometries: Partial<Record<TreeSpeciesId, THREE.BufferGeometry>> = {};
  impostorAtlases: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>> = {};
  impostorMaterials: Partial<Record<TreeSpeciesId, THREE.Material>> = {};
  private readonly settings: TreeSettings;
  private readonly webgpu: boolean;
  private readonly hydrologyWater: TreeHydrologyWater | undefined;
  private currentLighting: EnvironmentLighting | undefined;
  private currentForestLighting: ForestLightingMaterialState | null = null;
  private impostorBakeController: AbortController | null = null;

  constructor(options: TreeSystemAssetsOptions) {
    this.settings = options.settings;
    this.webgpu = options.webgpu;
    this.currentLighting = options.lighting;
    this.hydrologyWater = options.hydrologyWater;
    this.geometries = createTreeGeometryMap(this.settings);
    this.geometryKey = treeGeometryKey(this.settings);
    this.foliageAtlas = createTreeFoliageAtlas(this.settings);
    this.materialHandle = this.createMaterialHandle();
    this.publishFoliageAtlasStatus();
    this.impostorStatus = this.settings.impostors.enabled && this.settings.impostors.bakeOnStart
      ? "pending"
      : "disabled";
    if (options.impostorAtlases) this.setImpostorAtlases(options.impostorAtlases);
    else publishTreeImpostorDebugStatus(this.impostorAtlases);
  }

  updateLighting(lighting: EnvironmentLighting): void {
    this.currentLighting = lighting;
    this.materialHandle.updateLighting?.(lighting);
  }

  updateForestLighting(state: ForestLightingMaterialState | null): void {
    this.currentForestLighting = state;
    this.materialHandle.updateForestLighting?.(state);
  }

  cancelImpostorBake(reason = "tree impostor baking cancelled"): void {
    this.impostorBakeController?.abort(reason);
    this.impostorBakeController = null;
  }

  rebuildGeometries(): void {
    this.cancelImpostorBake("tree geometry rebuilt");
    this.geometryKey = treeGeometryKey(this.settings);
    disposeTreeGeometryMap(this.geometries);
    this.geometries = createTreeGeometryMap(this.settings);
    this.materialHandle.dispose();
    this.foliageAtlas.dispose();
    this.foliageAtlas = createTreeFoliageAtlas(this.settings);
    this.foliageAtlasStatus = "generated";
    this.foliageAtlasReason = null;
    this.materialHandle = this.createMaterialHandle();
    this.publishFoliageAtlasStatus();
    this.disposeBakedImpostorGeometries();
  }

  async bakeImpostors(renderer: unknown): Promise<{ supported: boolean; reason: string | null }> {
    this.cancelImpostorBake("superseded by a newer tree impostor bake");
    const controller = new AbortController();
    this.impostorBakeController = controller;
    try {
      await this.captureFoliageAtlas(renderer);
      if (controller.signal.aborted) {
        return { supported: false, reason: String(controller.signal.reason ?? "tree impostor baking cancelled") };
      }
      if (!this.settings.impostors.enabled || !this.settings.impostors.bakeOnStart) {
        this.impostorStatus = "disabled";
        this.impostorReason = "tree impostor baking disabled";
        return { supported: false, reason: this.impostorReason };
      }
      this.impostorStatus = "baking";
      this.impostorReason = null;
      const result = await bakeTreeImpostorAtlases({
        renderer,
        settings: this.settings,
        geometries: this.geometries,
        material: this.materialHandle.regularMaterial,
        foliageAtlas: this.foliageAtlas,
        webgpu: this.webgpu,
        signal: controller.signal,
      });
      if (controller.signal.aborted || this.impostorBakeController !== controller) {
        for (const atlas of Object.values(result.atlases)) atlas?.dispose();
        return { supported: false, reason: String(controller.signal.reason ?? "tree impostor baking cancelled") };
      }
      if (result.supported) {
        this.setImpostorAtlases(result.atlases);
        this.impostorStatus = "baked";
        this.impostorReason = null;
      } else {
        this.impostorStatus = "fallback";
        this.impostorReason = result.reason;
      }
      return { supported: result.supported, reason: result.reason };
    } finally {
      if (this.impostorBakeController === controller) this.impostorBakeController = null;
    }
  }

  setImpostorAtlases(atlases: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>>): void {
    for (const atlas of Object.values(this.impostorAtlases)) atlas?.dispose();
    this.impostorAtlases = { ...atlases };
    publishTreeImpostorDebugStatus(this.impostorAtlases);
    this.disposeImpostorMaterials();
    this.disposeBakedImpostorGeometries();
    this.updateImpostorMaterials();
  }

  materialFor(species: TreeSpeciesId, lod: TreeLod): THREE.Material {
    return selectTreeSystemMaterial({
      species,
      lod,
      settings: this.settings,
      materialHandle: this.materialHandle,
      impostorAtlases: this.impostorAtlases,
      impostorMaterials: this.impostorMaterials,
    });
  }

  applyMaterials(patches: readonly TreePatch[]): void {
    applyTreeSystemMaterials({
      patches,
      settings: this.settings,
      materialHandle: this.materialHandle,
      impostorAtlases: this.impostorAtlases,
      impostorMaterials: this.impostorMaterials,
    });
  }

  refreshMaterials(patches: readonly TreePatch[]): void {
    this.materialHandle.updateSettings(this.settings);
    this.updateImpostorMaterials();
    this.applyMaterials(patches);
  }

  geometryFor(species: TreeSpeciesId, lod: TreeLod): THREE.BufferGeometry {
    return selectTreeSystemGeometry({
      species,
      lod,
      settings: this.settings,
      geometries: this.geometries,
      impostorAtlases: this.impostorAtlases,
      bakedImpostorGeometries: this.bakedImpostorGeometries,
    });
  }

  geometryForGpuRing(species: TreeSpeciesId, lod: TreeLod): THREE.BufferGeometry {
    return selectTreeGpuRingGeometry({
      species,
      lod,
      geometries: this.geometries,
      settings: this.settings,
      impostorAtlases: this.impostorAtlases,
      bakedImpostorGeometries: this.bakedImpostorGeometries,
    }).geometry;
  }

  replaceImpostorMeshGeometries(
    patches: readonly TreePatch[],
    meshBoundsState: WeakMap<THREE.InstancedMesh, TreeMeshBoundsState>,
  ): void {
    replaceTreeSystemImpostorGeometries({
      patches,
      settings: this.settings,
      geometries: this.geometries,
      impostorAtlases: this.impostorAtlases,
      bakedImpostorGeometries: this.bakedImpostorGeometries,
      includeBlendAttributes: true,
      meshBoundsState,
    });
  }

  dispose(): void {
    this.cancelImpostorBake("tree system disposed");
    disposeTreeGeometryMap(this.geometries);
    this.crownProxyGeometry.dispose();
    this.disposeBakedImpostorGeometries();
    this.disposeImpostorMaterials();
    for (const atlas of Object.values(this.impostorAtlases)) atlas?.dispose();
    publishTreeImpostorDebugStatus({});
    this.materialHandle.dispose();
    this.foliageAtlas.dispose();
  }

  private async captureFoliageAtlas(renderer: unknown): Promise<void> {
    this.foliageAtlasStatus = "capturing";
    this.foliageAtlasReason = null;
    this.publishFoliageAtlasStatus();
    const result = await bakeTreeFoliageAtlas({
      renderer,
      settings: this.settings,
      webgpu: this.webgpu,
    });
    if (result.supported && result.atlas) {
      replaceTreeFoliageAtlasData(this.foliageAtlas, result.atlas);
      this.foliageAtlasStatus = "captured";
      this.publishFoliageAtlasStatus();
      return;
    }
    this.foliageAtlasStatus = "fallback";
    this.foliageAtlasReason = result.reason;
    this.publishFoliageAtlasStatus();
  }

  private publishFoliageAtlasStatus(): void {
    publishTreeFoliageAtlasDebugStatus(
      this.foliageAtlas,
      this.foliageAtlasStatus,
      this.foliageAtlasReason,
    );
  }

  private createMaterialHandle(): TreeMaterialHandle {
    const base = this.webgpu
      ? createTreeNodeMaterialHandle(this.settings, this.currentLighting, this.hydrologyWater)
      : createTreeMaterialHandle(this.settings, this.foliageAtlas);
    const handle = decorateTreeMaterialHandle(base, { foliageAtlas: this.foliageAtlas });
    if (this.currentForestLighting) handle.updateForestLighting?.(this.currentForestLighting);
    return handle;
  }

  private updateImpostorMaterials(): void {
    for (const species of TREE_SPECIES) {
      const atlas = this.impostorAtlases[species];
      if (!atlas?.ready) continue;
      updateTreeSystemImpostorMaterial({
        species,
        settings: this.settings,
        atlas,
        webgpu: this.webgpu,
        viewBlend: true,
        viewBlendGeometryReady: true,
        impostorMaterials: this.impostorMaterials,
      });
    }
  }

  private disposeBakedImpostorGeometries(): void {
    disposeTreeSystemBakedImpostorGeometries(this.bakedImpostorGeometries);
    this.bakedImpostorGeometries = {};
  }

  private disposeImpostorMaterials(): void {
    disposeTreeSystemImpostorMaterials(this.impostorMaterials);
    this.impostorMaterials = {};
  }
}
