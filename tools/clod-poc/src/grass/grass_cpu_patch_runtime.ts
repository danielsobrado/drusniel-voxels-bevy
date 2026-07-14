import * as THREE from "three";
import type { ClodPageNode, PageFootprint } from "../types.js";
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
import { runtimeWorldUsesCameraRelativeCoordinates } from "../world/runtime_world_policy.js";

export interface GrassCpuPatchRuntimeOptions {
  nodes: ClodPageNode[];
  worldCells: number;
  root: THREE.Group;
  geometries: GrassSharedGeometries;
  injectedGeometryBuilder: GrassGeometryBuilder | null;
  materialFor: (mode: GrassShaderMode) => THREE.Material;
}

interface GrassPatchSource {
  id: string;
  footprint: PageFootprint;
}

const DEFAULT_UNBOUNDED_GRASS_PATCH_M = 64;

export class GrassCpuPatchRuntime {
  readonly nodes: ClodPageNode[];
  private readonly worldCells: number;
  private readonly root: THREE.Group;
  private readonly geometries: GrassSharedGeometries;
  private readonly injectedGeometryBuilder: GrassGeometryBuilder | null;
  private readonly materialFor: (mode: GrassShaderMode) => THREE.Material;
  private readonly unboundedWorld: boolean;
  private readonly unboundedPatchSize: number;
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
    this.unboundedWorld = runtimeWorldUsesCameraRelativeCoordinates();
    this.unboundedPatchSize = grassFallbackPatchSize(this.nodes);
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
    const nearbyNodes = this.nearbyFiniteNodes(center, settings);
    const patchSources = nearbyNodes.length > 0
      ? nearbyNodes.map((node) => ({ id: node.id, footprint: node.footprint }))
      : this.unboundedWorld
        ? unboundedGrassPatchSources(center, settings.distance, this.unboundedPatchSize)
        : [];
    const nearbyIds = new Set(patchSources.map((source) => source.id));
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
    const newSources = patchSources.filter((source) => !retainedIds.has(source.id));
    let remainingBudget = Math.max(0, Math.floor(settings.maxBlades) - this.bladeCount);
    let built = 0;
    for (let index = 0; index < newSources.length && remainingBudget > 0; index++) {
      if (built >= settings.patchFallback.maxNewPatchesPerRefresh) return true;
      const source = newSources[index];
      const footprint = grassRuntimeFootprint(source.footprint, this.worldCells, this.unboundedWorld);
      const remainingNodes = newSources.length - index;
      const patchBudget = Math.ceil(remainingBudget / remainingNodes);
      const buildStart = performance.now();
      const instances = generateGrassInstances(footprint, settings, patchBudget, this.generationStats);
      if (instances.length === 0) continue;
      const patch = this.createPatchFactory(settings).createPatch(source.id, footprint, instances);
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

  private nearbyFiniteNodes(center: THREE.Vector3, settings: GrassSettings): ClodPageNode[] {
    return this.nodes.filter((node) => {
      const footprint = node.footprint;
      const centerX = grassFootprintCenterX(footprint);
      const centerZ = grassFootprintCenterZ(footprint);
      const radius = grassFootprintRadius(footprint);
      return Math.hypot(center.x - centerX, center.z - centerZ) <= settings.distance + radius;
    });
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

export function grassRuntimeFootprint(footprint: PageFootprint, worldCells: number, unbounded: boolean): PageFootprint {
  return unbounded ? { ...footprint } : clampGrassFootprint(footprint, worldCells);
}

export function unboundedGrassPatchSources(
  center: THREE.Vector3,
  distanceM: number,
  patchSizeM: number,
): GrassPatchSource[] {
  const size = Number.isFinite(patchSizeM) && patchSizeM > 0 ? patchSizeM : DEFAULT_UNBOUNDED_GRASS_PATCH_M;
  const radius = Math.max(0, Number.isFinite(distanceM) ? distanceM : 0);
  const minX = Math.floor((center.x - radius) / size);
  const maxX = Math.floor((center.x + radius) / size);
  const minZ = Math.floor((center.z - radius) / size);
  const maxZ = Math.floor((center.z + radius) / size);
  const sources: GrassPatchSource[] = [];
  for (let z = minZ; z <= maxZ; z++) {
    for (let x = minX; x <= maxX; x++) {
      const footprint = { minX: x * size, minZ: z * size, maxX: (x + 1) * size, maxZ: (z + 1) * size };
      const centerX = grassFootprintCenterX(footprint);
      const centerZ = grassFootprintCenterZ(footprint);
      if (Math.hypot(center.x - centerX, center.z - centerZ) > radius + grassFootprintRadius(footprint)) continue;
      sources.push({ id: `grass-unbounded:${x},${z}`, footprint });
    }
  }
  return sources;
}

function grassFallbackPatchSize(nodes: readonly ClodPageNode[]): number {
  const first = nodes[0]?.footprint;
  const size = first ? Math.max(first.maxX - first.minX, first.maxZ - first.minZ) : DEFAULT_UNBOUNDED_GRASS_PATCH_M;
  return Number.isFinite(size) && size > 0 ? size : DEFAULT_UNBOUNDED_GRASS_PATCH_M;
}


function emptyGrassGenerationStats(): GrassGenerationStats {
  return {
    generatedCandidates: 0,
    acceptedCandidates: 0,
    edgeSuppressedCandidates: 0,
  };
}
