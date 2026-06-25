import * as THREE from "three";
import { emitAudio } from "../../audio/index.js";
import type { ClodWorkerClient } from "../../clod_worker_client.js";
import {
  addDigEdit,
  DIG_INFLUENCE_MARGIN,
  getDigEditsSnapshot,
  type BrushOp,
  type BrushShape,
  type DigEdit,
} from "../../terrain.js";
import type { ClodPageNode } from "../../types.js";
import type { ClodSelectionController } from "../selection/clod_selection_controller.js";
import type { TerrainRaycastService } from "../../player/terrain_raycast_service.js";

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
  grassSystem: { removePatchesForNodes(ids: string[]): void; markPatchesDirty(): void } | null;
  treeSystem: { removePatchesForNodes(ids: string[]): Array<unknown>; markPatchesDirty(): void } | null;
  understorySystem: { removePatchesForNodes(ids: string[]): void; markPatchesDirty(): void } | null;
  vegetationDirtyQueue: { grass: boolean; trees: boolean; understory: boolean };
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
  flushAncestors(): Promise<void>;
  readonly lastDigAt: number;
}

export function createTerrainEditService(deps: TerrainEditServiceDeps): TerrainEditService {
  let digDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let digRebuildsInFlight = 0;
  let lastDigAt = -Infinity;

  const flushAncestors = async () => {
    await deps.clodWorker.flushParents();
  };

  const performDigRebuild = async (
    edit: DigEdit,
    hit: NonNullable<ReturnType<TerrainRaycastService["raycastEditableTerrain"]>>,
    radius: number,
    brushParams: TerrainBrushParams,
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

      let colliderMs = 0;
      let geometrySwapMs = 0;
      for (const node of lod0.changed) {
        const r = deps.applyNodeMesh(node);
        colliderMs += r.colliderMs;
        geometrySwapMs += r.geometrySwapMs;
      }
      if (lod0.pendingParents > 0) deps.markEditedAncestorsStale(lod0.changed);
      deps.selectionController.patchNodes(lod0.changed);
      const veg = deps.getVegetationState();
      if (veg.grassEnabled && lod0.changed.length > 0) {
        const changedIds = lod0.changed.map((node) => node.id);
        deps.grassSystem?.removePatchesForNodes(changedIds);
        deps.vegetationDirtyQueue.grass = true;
        deps.refreshGrassStats();
      }
      if (veg.treesEnabled && lod0.changed.length > 0) {
        const changedIds = lod0.changed.map((node) => node.id);
        const fallen = deps.treeSystem?.removePatchesForNodes(changedIds) ?? [];
        deps.fallingTrees.push(...fallen);
        deps.vegetationDirtyQueue.trees = true;
        deps.refreshTreeStats();
      }
      if (veg.understoryEnabled && lod0.changed.length > 0) {
        const changedIds = lod0.changed.map((node) => node.id);
        deps.understorySystem?.removePatchesForNodes(changedIds);
        deps.vegetationDirtyQueue.understory = true;
        deps.refreshUnderstoryStats();
      }
      deps.setPendingParentNodes(0);
      deps.setPendingParentMs(0);
      deps.setPendingParentCount(lod0.pendingParents);

      const totalMs = performance.now() - t0;
      const summary =
        `${totalMs.toFixed(0)}ms worker LOD0 (build ${lod0.lod0Ms.toFixed(0)}ms · ${lod0.lod0Pages}p · ` +
        `${lod0.chunksRemeshed}/${lod0.chunksTotal} chunks · swap ${geometrySwapMs.toFixed(0)}ms · collider ${colliderMs.toFixed(0)}ms)`;
      deps.setLastDigSummary(summary);
      console.log(
        `[${brushParams.brushOp} ${brushParams.brushShape} r=${radius}] at (${hit.point.x.toFixed(1)},${hit.point.y.toFixed(1)},${hit.point.z.toFixed(1)}) — ${summary} — ${lod0.pendingParents} ancestors queued in worker`,
      );
      deps.selectionController.invalidate();
      deps.selectionController.update();
      deps.updateInfo();
    } catch (error) {
      emitAudio("clod.rebuild.error");
      if (error instanceof Error && error.name === "ClodBuildError") {
        emitAudio("clod.validation.error");
      }
      throw error;
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

    await performDigRebuild(edit, hit, radius, brushParams);
  };

  const scheduleDig = (ray: THREE.Ray): void => {
    const cloned = ray.clone();
    if (digDebounceTimer !== null) clearTimeout(digDebounceTimer);
    digDebounceTimer = setTimeout(() => {
      digDebounceTimer = null;
      void performDig(cloned);
    }, 40);
  };

  return {
    scheduleDig,
    flushAncestors,
    get lastDigAt() {
      return lastDigAt;
    },
  };
}
