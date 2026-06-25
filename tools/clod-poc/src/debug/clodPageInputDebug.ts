import type GUI from "lil-gui";
import type { ClodRuntimeState } from "../clod/runtime/clodRuntime.js";
import { setFreezeSelection } from "../clod/runtime/clodRuntime.js";

export interface ClodPageInputStats {
  selectedNodes: number;
  trianglesByLod: string;
  pageSourceTerrainTriangles: number;
  excludedWaterOceanTriangles: number;
}

export interface ClodPageInputDebugDeps {
  gui: GUI;
  runtimeState?: ClodRuntimeState;
  getSelectionStats?: () => {
    selectedNodes: number;
    trianglesByLod: Map<number, number>;
  };
  setFreezeLodSelection?: (frozen: boolean) => void;
  setPageBoundariesVisible(visible: boolean): void;
  setLockedBorderVisible(visible: boolean): void;
  setPageSourcePurityVisible(visible: boolean): void;
  setWaterExclusionVisible(visible: boolean): void;
}

export interface ClodPageInputDebugController {
  stats: ClodPageInputStats;
  update(sourceTerrainTriangles: number, excludedWaterOceanTriangles: number): void;
  dispose(): void;
}

export function createClodPageInputDebug(
  deps: ClodPageInputDebugDeps,
): ClodPageInputDebugController {
  const state = {
    showPageBoundaries: false,
    showLockedBorderVertices: false,
    showPageSourcePurity: false,
    showWaterOceanExclusion: false,
    freezeLodSelection: deps.runtimeState?.freezeSelection ?? false,
  };
  const stats: ClodPageInputStats = {
    selectedNodes: 0,
    trianglesByLod: "",
    pageSourceTerrainTriangles: 0,
    excludedWaterOceanTriangles: 0,
  };
  const folder = deps.gui.addFolder("CLOD page input");
  folder.add(state, "showPageBoundaries").name("page boundaries")
    .onChange(deps.setPageBoundariesVisible);
  folder.add(state, "showLockedBorderVertices").name("locked border vertices")
    .onChange(deps.setLockedBorderVisible);
  folder.add(state, "showPageSourcePurity").name("page source purity")
    .onChange(deps.setPageSourcePurityVisible);
  folder.add(state, "showWaterOceanExclusion").name("water/ocean exclusion")
    .onChange(deps.setWaterExclusionVisible);
  folder.add(state, "freezeLodSelection").name("freeze LOD selection")
    .onChange((frozen: boolean) => {
      if (deps.runtimeState) setFreezeSelection(deps.runtimeState, frozen);
      deps.setFreezeLodSelection?.(frozen);
    });
  folder.add(stats, "selectedNodes").listen().disable();
  folder.add(stats, "trianglesByLod").listen().disable();
  folder.add(stats, "pageSourceTerrainTriangles").listen().disable();
  folder.add(stats, "excludedWaterOceanTriangles").listen().disable();

  return {
    stats,
    update(sourceTerrainTriangles, excludedWaterOceanTriangles) {
      const external = deps.getSelectionStats?.();
      stats.selectedNodes = external?.selectedNodes
        ?? deps.runtimeState?.stats.selectedNodeCount
        ?? 0;
      const trianglesByLevel = external?.trianglesByLod ?? new Map<number, number>();
      if (!external && deps.runtimeState) {
        for (const selected of deps.runtimeState.previousCut?.nodes.values() ?? []) {
          trianglesByLevel.set(
            selected.level,
            (trianglesByLevel.get(selected.level) ?? 0)
              + (deps.runtimeState.nodeTriangleCounts.get(selected.nodeId) ?? 0),
          );
        }
      }
      stats.trianglesByLod = [...trianglesByLevel.entries()]
        .map(([level, triangles]) => `L${level}:${triangles}`)
        .join(" ");
      stats.pageSourceTerrainTriangles = sourceTerrainTriangles;
      stats.excludedWaterOceanTriangles = excludedWaterOceanTriangles;
    },
    dispose() {
      folder.destroy();
    },
  };
}
