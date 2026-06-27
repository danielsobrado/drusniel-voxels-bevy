import * as THREE from "three";
import { emitAudio } from "../../audio/index.js";
import type { ClodWorkerClient } from "../../clod_worker_client.js";
import type { ConstructionTerrainConformRequest } from "../../construction/types.js";
import {
  addDigEdit,
  DIG_INFLUENCE_MARGIN,
  getDigEditsSnapshot,
  type BrushOp,
  type BrushShape,
  type DigEdit,
} from "../../terrain/terrain.js";
import type { ClodPageNode } from "../../types.js";
import type { ClodSelectionController } from "../selection/clod_selection_controller.js";
import type { TerrainRaycastService } from "../../player/terrain_raycast_service.js";

const VEGETATION_REBUILD_DEBOUNCE_MS = 160;

export interface TerrainBrushParams {
  digRadius: number;
  brushShape: BrushShape;
  brushOp: BrushOp;
  brushMaterial: number;
  brushHeight: number;
  brushStrength: number;
  brushFalloff: number;
}

export interface TerrainEditVegetationState {
  grassEnabled: boolean;
  treesEnabled: boolean;
  understoryEnabled: boolean;
}

export interface TerrainEditServiceDeps {
  clodWorker: ClodWorkerClient;
  terrainRaycast: TerrainRaycastService;
  getBrushParams: () => TerrainBrushParams;
  getVegetationState: () => TerrainEditVegetationState;
  applyNodeMesh: (node: ClodPageNode) => { colliderMs: number; geometrySwapMs: number };
  markEditedAncestorsStale: (lod0Nodes: readonly ClodPageNode[]) => void;
  selectionController: Pick<ClodSelectionController, "patchNodes" | "invalidate" | "update">;
  applyTerrainTextures: () => void;
  grassSystem: { rebuildNodePatches(ids: string[]): void } | null;
  treeSystem: { removePatchesForNodes(ids: string[]): Array<unknown>; rebuildNodePatches(ids: string[]): void } | null;
  understorySystem: { rebuildNodePatches(ids: string[]): void } | null;
  fallingTrees: unknown[];
  refreshGrassStats: () => void;
  refreshTreeStats: () => void;
  refreshUnderstoryStats: () => void;
  updateInfo: () => void;
  getLastDigSummary: () => string;
  setLastDigSummary: (summary: string) => void;
  setPendingParentCount: (count: number) => void;
  setPendingParentNodes: (nodes: number) => void;
  setPendingParentMs: (ms: number) => void;
}

export interface TerrainEditService {
  scheduleDig(ray: THREE.Ray): void;
  scheduleConstructionTerrainConform(request: ConstructionTerrainConformRequest): void;
  flushAncestors(): Promise<void>;
  readonly lastDigAt: number;
}

interface TerrainRebuildHit {
  point: THREE.Vector3;
}

export function createTerrainEditService(deps: TerrainEditServiceDeps): TerrainEditService {
  let digDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let conformDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let vegetationFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let digRebuildsInFlight = 0;
  let lastDigAt = -Infinity;
  const pendingGrassNodeIds = new Set<string>();
  const pendingTreeNodeIds = new Set<string>();
  const pendingUnderstoryNodeIds = new Set<string>();

  const flushVegetationRebuilds = () => {
    vegetationFlushTimer = null;
    const veg = deps.getVegetationState();

    if (veg.grassEnabled && pendingGrassNodeIds.size > 0) {
      deps.grassSystem?.rebuildNodePatches([...pendingGrassNodeIds]);
      pendingGrassNodeIds.clear();
      deps.refreshGrassStats();
    }
    if (veg.treesEnabled && pendingTreeNodeIds.size > 0) {
      const changedIds = [...pendingTreeNodeIds];
      pendingTreeNodeIds.clear();
      const fallen = deps.treeSystem?.removePatchesForNodes(changedIds) ?? [];
      deps.fallingTrees.push(...fallen);
      deps.treeSystem?.rebuildNodePatches(changedIds);
      deps.refreshTreeStats();
    }
    if (veg.understoryEnabled && pendingUnderstoryNodeIds.size > 0) {
      deps.understorySystem?.rebuildNodePatches([...pendingUnderstoryNodeIds]);
      pendingUnderstoryNodeIds.clear();
      deps.refreshUnderstoryStats();
    }
  };

  const queueVegetationRebuild = (changed: readonly ClodPageNode[]) => {
    const veg = deps.getVegetationState();
    for (const node of changed) {
      if (veg.grassEnabled) pendingGrassNodeIds.add(node.id);
      if (veg.treesEnabled) pendingTreeNodeIds.add(node.id);
      if (veg.understoryEnabled) pendingUnderstoryNodeIds.add(node.id);
    }
    if (vegetationFlushTimer !== null) clearTimeout(vegetationFlushTimer);
    vegetationFlushTimer = setTimeout(flushVegetationRebuilds, VEGETATION_REBUILD_DEBOUNCE_MS);
  };

  const flushAncestors = async () => {
    await deps.clodWorker.flushParents();
  };

  const applyLod0Result = (changed: readonly ClodPageNode[], pendingParents: number): void => {
    for (const node of changed) deps.applyNodeMesh(node);
    if (pendingParents > 0) deps.markEditedAncestorsStale(changed);
    deps.selectionController.patchNodes(changed);
    if (changed.length > 0) queueVegetationRebuild(changed);
    deps.setPendingParentCount(pendingParents);
    deps.selectionController.invalidate();
    deps.selectionController.update();
    deps.updateInfo();
  };

  const performEditRebuild = async (
    edit: DigEdit,
    hit: TerrainRebuildHit,
    radius: number,
    label: string,
  ) => {
    const t0 = performance.now();
    lastDigAt = t0;
    digRebuildsInFlight++;
    try {
      const margin = radius + DIG_INFLUENCE_MARGIN;
      const lod0 = await deps.clodWorker.rebuildAfterDig(edit, {
        minX: hit.point.x - margin,
        maxX: hit.point.x + margin,
        minZ: hit.point.z - margin,
        maxZ: hit.point.z + margin,
      });

      applyLod0Result(lod0.changed, lod0.pendingParents);
      deps.setPendingParentNodes(0);
      deps.setPendingParentMs(0);

      const totalMs = performance.now() - t0;
      const batchSuffix = lod0.requestCount > 1 ? ` · batch ${lod0.requestCount}` : "";
      const summary =
        `${totalMs.toFixed(0)}ms worker LOD0 (build ${lod0.lod0Ms.toFixed(0)}ms · ${lod0.lod0Pages}p · ` +
        `${lod0.chunksRemeshed}/${lod0.chunksTotal} chunks · serialize ${lod0.serializeMs.toFixed(0)}ms${batchSuffix})`;
      deps.setLastDigSummary(summary);
      console.log(
        `[${label} ${edit.op ?? "edit"} ${edit.shape ?? "sphere"} r=${radius}] at (${hit.point.x.toFixed(1)},${hit.point.y.toFixed(1)},${hit.point.z.toFixed(1)}) — ${summary} — ${lod0.pendingParents} ancestors queued in worker`,
      );
    } catch (error) {
      emitAudio("clod.rebuild.error");
      if (error instanceof Error && error.name === "ClodBuildError") {
        emitAudio("clod.validation.error");
      }
      console.error(`${label} rebuild failed:`, error);
    } finally {
      digRebuildsInFlight--;
    }
  };

  const performDig = async (ray: THREE.Ray) => {
    const hit = deps.terrainRaycast.raycastEditableTerrain(ray);
    if (!hit) {
      deps.setLastDigSummary("no terrain under brush");
      deps.updateInfo();
      return;
    }
    const brushParams = deps.getBrushParams();
    const radius = brushParams.digRadius;
    const edit = {
      x: hit.point.x, y: hit.point.y, z: hit.point.z, r: radius,
      shape: brushParams.brushShape, op: brushParams.brushOp,
      material: brushParams.brushOp === "add" ? brushParams.brushMaterial : undefined,
      height: brushParams.brushHeight, strength: brushParams.brushStrength, falloff: brushParams.brushFalloff,
    };
    const hadPaintedTerrain = getDigEditsSnapshot().some((existing) => existing.op === "add");
    addDigEdit(edit);
    if (!hadPaintedTerrain && edit.op === "add") deps.applyTerrainTextures();

    emitAudio(brushParams.brushOp === "add" ? "terrain.raise" : "terrain.dig.tick");

    await performEditRebuild(edit, hit, radius, `${brushParams.brushOp} ${brushParams.brushShape}`);
  };

  const performConstructionTerrainConform = async (request: ConstructionTerrainConformRequest) => {
    const radius = Math.max(request.dimensionsM[0], request.dimensionsM[2]) * 0.5 + request.padMarginM;
    const topY = request.position[1] - request.dimensionsM[1] * 0.5;
    const hit = { point: new THREE.Vector3(request.position[0], topY, request.position[2]) };
    const fillEdit: DigEdit = {
      x: request.position[0],
      y: topY - request.fillDepthM * 0.5,
      z: request.position[2],
      r: radius,
      shape: "cube",
      op: "add",
      material: request.materialSlot,
      height: request.fillDepthM * 0.5,
      strength: 1,
      falloff: request.falloffM,
    };
    const trimEdit: DigEdit = {
      x: request.position[0],
      y: topY + request.trimHeightM * 0.5,
      z: request.position[2],
      r: radius,
      shape: "cube",
      op: "remove",
      height: request.trimHeightM * 0.5,
      strength: 1,
      falloff: request.falloffM,
    };

    const hadPaintedTerrain = getDigEditsSnapshot().some((existing) => existing.op === "add");
    addDigEdit(fillEdit);
    if (request.trimHeightM > 0) addDigEdit(trimEdit);
    if (!hadPaintedTerrain) deps.applyTerrainTextures();
    emitAudio("terrain.raise");
    await performEditRebuild(fillEdit, hit, radius, "construction terrain fill");
    if (request.trimHeightM > 0) {
      await performEditRebuild(trimEdit, hit, radius, "construction terrain trim");
    }
  };

  const scheduleDig = (ray: THREE.Ray): void => {
    const cloned = ray.clone();
    if (digDebounceTimer !== null) clearTimeout(digDebounceTimer);
    digDebounceTimer = setTimeout(() => {
      digDebounceTimer = null;
      void performDig(cloned);
    }, 40);
  };

  const scheduleConstructionTerrainConform = (request: ConstructionTerrainConformRequest): void => {
    if (conformDebounceTimer !== null) clearTimeout(conformDebounceTimer);
    conformDebounceTimer = setTimeout(() => {
      conformDebounceTimer = null;
      void performConstructionTerrainConform(request);
    }, 20);
  };

  return {
    scheduleDig,
    scheduleConstructionTerrainConform,
    flushAncestors,
    get lastDigAt() {
      return lastDigAt;
    },
  };
}
