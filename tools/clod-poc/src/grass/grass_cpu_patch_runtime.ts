import * as THREE from "three";
import type { ClodPageNode } from "../types.js";
import type { GrassSettings, GrassShaderMode, GrassTier } from "./grass_config.js";
import { generateGrassInstances } from "./grass_cpu_patch.js";
import type { GrassGeometryBuilder } from "./grass_geometry.js";
import { GrassPatchFactory } from "./grass_patch_factory.js";
import {
  clampGrassFootprint,
  grassFootprintCenterX,
  grassFootprintCenterZ,
  grassFootprintRadius,
} from "./grass_patch_footprint.js";
import { updateGrassPatchVisibility } from "./grass_patch_visibility.js";
import type { GrassGenerationStats } from "./grass_stats.js";
import type { GrassPatch } from "./grass_system_support.js";
import type { GrassSharedGeometries } from "./grass_shared_geometries.js";

export interface GrassCpuPatchRuntimeOptions {
  nodes: ClodPageNode[];
  worldCells: number;
  root: THREE.Group;
  geometries: GrassSharedGeometries;
  injectedGeometryBuilder: GrassGeometryBuilder | null;
  materialFor: (mode: GrassShaderMode) => THREE.Material;
}

export class GrassCpuPatchRuntime {
  readonly nodes: ClodPageNode[];
  private readonly worldCells: number;
  private readonly root: THREE.Group;
  private readonly geometries: GrassSharedGeometries;
  private readonly injectedGeometryBuilder: GrassGeometryBuilder | null;
  private readonly materialFor: (mode: GrassShaderMode) => THREE.Material;
  private readonly lastRefreshCenter = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0);
  patches: GrassPatch[] = [];
  patchesDirty = true;
  bladeCount = 0;
  patchRebuildCount = 0;
  buildMs = 0;
  generationStats: GrassGenerationStats = emptyGrassGenerationStats();

  constructor(options: GrassCpuPatchRuntimeOptions) {
    this.nodes = options.nodes
      .filter((node) => node.level === 0)
      .sort((a, b) => a.footprint.minZ - b.footprint.minZ || a.footprint.minX - b.footprint.minX);
    this.worldCells = options.worldCells;
    this.root = options.root;
    this.geometries = options.geometries;
    this.injectedGeometryBuilder = options.injectedGeometryBuilder;
    this.materialFor = options.materialFor;
  }

  markDirty(): void {
    this.patchesDirty = true;
  }

  clear(): void {
    for (const patch of this.patches) this.removePatch(patch);
    this.patches = [];
    this.bladeCount = 0;
    this.patchRebuildCount = 0;
    this.buildMs = 0;
    this.generationStats = emptyGrassGenerationStats();
  }

  removeForNodes(nodeIds: Iterable<string>): void {
    const ids = new Set(nodeIds);
    if (ids.size === 0) return;
    const retained: GrassPatch[] = [];
    for (const patch of this.patches) {
      if (ids.has(patch.nodeId)) {
        this.removePatch(patch);
        this.bladeCount -= patch.bladeCount;
      } else {
        retained.push(patch);
      }
    }
    this.patches = retained;
  }

  rebuildForNodes(nodeIds: Iterable<string>, center: THREE.Vector3, settings: GrassSettings): void {
    const ids = new Set(nodeIds);
    if (ids.size === 0) return;

    const stale: GrassPatch[] = [];
    const retained: GrassPatch[] = [];
    for (const patch of this.patches) {
      if (ids.has(patch.nodeId)) stale.push(patch);
      else retained.push(patch);
    }

    let activeBladeCount = retained.reduce((sum, patch) => sum + patch.bladeCount, 0);
    let remainingBudget = Math.max(0, Math.floor(settings.maxBlades) - activeBladeCount);
    const replacements: GrassPatch[] = [];
    for (const node of this.nodes) {
      if (!ids.has(node.id) || remainingBudget <= 0) continue;
      const footprint = clampGrassFootprint(node.footprint, this.worldCells);
      const distance = Math.hypot(center.x - grassFootprintCenterX(footprint), center.z - grassFootprintCenterZ(footprint));
      if (distance > settings.distance + grassFootprintRadius(footprint)) continue;
      const buildStart = performance.now();
      const instances = generateGrassInstances(footprint, settings, remainingBudget, this.generationStats);
      if (instances.length === 0) continue;
      const patch = this.createPatchFactory(settings).createPatch(node.id, footprint, instances);
      this.buildMs += performance.now() - buildStart;
      this.patchRebuildCount++;
      replacements.push(patch);
      for (const mesh of patch.meshes) this.root.add(mesh);
      activeBladeCount += patch.bladeCount;
      remainingBudget = Math.max(0, Math.floor(settings.maxBlades) - activeBladeCount);
    }

    this.patches = [...retained, ...replacements];
    this.bladeCount = activeBladeCount;
    for (const patch of stale) this.removePatch(patch);
    for (const patch of this.patches) {
      const distance = Math.hypot(center.x - patch.centerX, center.z - patch.centerZ);
      updateGrassPatchVisibility({ patch, distance, settings });
    }
    this.lastRefreshCenter.copy(center);
    this.patchesDirty = false;
  }

  refreshIfNeeded(center: THREE.Vector3, settings: GrassSettings): boolean {
    if (!this.patchesDirty && this.lastRefreshCenter.distanceTo(center) < settings.patchFallback.refreshDistance) {
      return false;
    }
    this.refreshForCenter(center, settings);
    return true;
  }

  refreshForCenter(center: THREE.Vector3, settings: GrassSettings): void {
    const deferred = this.refreshPatches(center, settings);
    for (const patch of this.patches) {
      const distance = Math.hypot(center.x - patch.centerX, center.z - patch.centerZ);
      updateGrassPatchVisibility({ patch, distance, settings });
    }
    this.lastRefreshCenter.copy(center);
    this.patchesDirty = deferred;
  }

  visibleTierCounts(): Record<GrassTier, number> {
    const counts: Record<GrassTier, number> = { near: 0, mid: 0, far: 0, super: 0 };
    for (const patch of this.patches) {
      if (patch.visibleTier !== "hidden") counts[patch.visibleTier]++;
    }
    return counts;
  }

  private refreshPatches(center: THREE.Vector3, settings: GrassSettings): boolean {
    const nearbyNodes = this.nodes.filter((node) => {
      const footprint = node.footprint;
      const centerX = grassFootprintCenterX(footprint);
      const centerZ = grassFootprintCenterZ(footprint);
      const radius = grassFootprintRadius(footprint);
      return Math.hypot(center.x - centerX, center.z - centerZ) <= settings.distance + radius;
    });
    const nearbyIds = new Set(nearbyNodes.map((node) => node.id));
    const retainedPatches: GrassPatch[] = [];
    for (const patch of this.patches) {
      if (nearbyIds.has(patch.nodeId)) {
        retainedPatches.push(patch);
      } else {
        this.removePatch(patch);
        this.bladeCount -= patch.bladeCount;
      }
    }
    this.patches = retainedPatches;

    const retainedIds = new Set(this.patches.map((patch) => patch.nodeId));
    const newNodes = nearbyNodes.filter((node) => !retainedIds.has(node.id));
    let remainingBudget = Math.max(0, Math.floor(settings.maxBlades) - this.bladeCount);
    let built = 0;
    for (let index = 0; index < newNodes.length && remainingBudget > 0; index++) {
      if (built >= settings.patchFallback.maxNewPatchesPerRefresh) return true;
      const node = newNodes[index];
      const footprint = clampGrassFootprint(node.footprint, this.worldCells);
      const remainingNodes = newNodes.length - index;
      const patchBudget = Math.ceil(remainingBudget / remainingNodes);
      const buildStart = performance.now();
      const instances = generateGrassInstances(footprint, settings, patchBudget, this.generationStats);
      if (instances.length === 0) continue;
      const patch = this.createPatchFactory(settings).createPatch(node.id, footprint, instances);
      this.buildMs += performance.now() - buildStart;
      this.patchRebuildCount++;
      this.patches.push(patch);
      for (const mesh of patch.meshes) this.root.add(mesh);
      this.bladeCount += patch.bladeCount;
      remainingBudget -= patch.bladeCount;
      built++;
    }
    return false;
  }

  private createPatchFactory(settings: GrassSettings): GrassPatchFactory {
    return new GrassPatchFactory({
      settings,
      classicBladeGeometry: this.geometries.classicBladeGeometry,
      terrainPatchNearGeometry: this.geometries.terrainPatchNearGeometry,
      terrainPatchNearCrossedGeometry: this.geometries.terrainPatchNearCrossedGeometry,
      terrainPatchMidGeometry: this.geometries.terrainPatchMidGeometry,
      terrainPatchFarGeometry: this.geometries.terrainPatchFarGeometry,
      terrainPatchSuperGeometry: this.geometries.terrainPatchSuperGeometry,
      injectedGeometryBuilder: this.injectedGeometryBuilder,
      materialFor: this.materialFor,
    });
  }

  private removePatch(patch: GrassPatch): void {
    for (const mesh of patch.meshes) {
      this.root.remove(mesh);
      mesh.geometry.dispose();
    }
  }
}

function emptyGrassGenerationStats(): GrassGenerationStats {
  return {
    generatedCandidates: 0,
    acceptedCandidates: 0,
    edgeSuppressedCandidates: 0,
  };
}
