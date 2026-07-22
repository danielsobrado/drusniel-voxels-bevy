import type { ClodPageNode } from "../../types.js";
import type { TerrainEditVegetationState } from "./terrain_edit_service.js";

const VEGETATION_REBUILD_DEBOUNCE_MS = 160;
const VEGETATION_REBUILD_RETRY_MS = 1000;

export type TerrainVegetationSystem = {
  rebuildNodePatches(ids: string[]): void;
  markPatchesDirty?(): void;
} | null;

export interface TerrainEditVegetationNotifyDeps {
  getVegetationState: () => TerrainEditVegetationState;
  grassSystem: TerrainVegetationSystem;
  treeSystem: TerrainVegetationSystem;
  understorySystem: TerrainVegetationSystem;
  refreshGrassStats: () => void;
  refreshTreeStats: () => void;
  refreshUnderstoryStats: () => void;
}

export interface TerrainEditVegetationNotify {
  queueVegetationRebuild(changed: readonly ClodPageNode[]): void;
  flushVegetationRebuilds(): void;
}

export function createTerrainEditVegetationNotify(
  deps: TerrainEditVegetationNotifyDeps,
): TerrainEditVegetationNotify {
  let vegetationFlushTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingGrassNodeIds = new Set<string>();
  const pendingTreeNodeIds = new Set<string>();
  const pendingUnderstoryNodeIds = new Set<string>();

  const flushVegetationRebuilds = () => {
    vegetationFlushTimer = null;
    const veg = deps.getVegetationState();
    const rebuild = (
      enabled: boolean,
      pending: Set<string>,
      system: TerrainVegetationSystem,
      refresh: () => void,
      label: string,
    ) => {
      if (!enabled || pending.size === 0) return;
      const ids = [...pending];
      try {
        if (system?.markPatchesDirty) system.markPatchesDirty();
        else system?.rebuildNodePatches(ids);
        refresh();
        for (const id of ids) pending.delete(id);
      } catch (error) {
        console.error(`${label} rebuild after terrain edit failed:`, error);
      }
    };
    rebuild(veg.grassEnabled, pendingGrassNodeIds, deps.grassSystem, deps.refreshGrassStats, "grass");
    rebuild(veg.treesEnabled, pendingTreeNodeIds, deps.treeSystem, deps.refreshTreeStats, "tree");
    rebuild(veg.understoryEnabled, pendingUnderstoryNodeIds, deps.understorySystem, deps.refreshUnderstoryStats, "understory");
    const stillPending = (veg.grassEnabled && pendingGrassNodeIds.size > 0)
      || (veg.treesEnabled && pendingTreeNodeIds.size > 0)
      || (veg.understoryEnabled && pendingUnderstoryNodeIds.size > 0);
    if (stillPending) vegetationFlushTimer = setTimeout(flushVegetationRebuilds, VEGETATION_REBUILD_RETRY_MS);
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

  return {
    queueVegetationRebuild,
    flushVegetationRebuilds: () => {
      if (vegetationFlushTimer !== null) clearTimeout(vegetationFlushTimer);
      flushVegetationRebuilds();
    },
  };
}
