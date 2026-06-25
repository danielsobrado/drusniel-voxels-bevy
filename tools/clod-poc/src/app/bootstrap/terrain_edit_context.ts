import type { ClodPageNode } from "../../types.js";
import type { VegetationDirtyQueue } from "../../systems/vegetation_dirty.js";

function nodeGridCoord(node: ClodPageNode): [number, number] | null {
  const coord = node.id.slice(node.id.indexOf(":") + 1).split(",");
  if (coord.length !== 2) return null;
  const x = Number(coord[0]);
  const z = Number(coord[1]);
  return Number.isFinite(x) && Number.isFinite(z) ? [x, z] : null;
}

export interface TerrainEditContext {
  staleEditedAncestorIds: Set<string>;
  vegetationDirtyQueue: VegetationDirtyQueue;
  markEditedAncestorsStale: (lod0Nodes: readonly ClodPageNode[]) => void;
}

export function createTerrainEditContext(maxTerrainLevel: number): TerrainEditContext {
  const staleEditedAncestorIds = new Set<string>();
  const vegetationDirtyQueue: VegetationDirtyQueue = {
    nodeIds: [],
    grass: false,
    trees: false,
    understory: false,
  };
  const markEditedAncestorsStale = (lod0Nodes: readonly ClodPageNode[]): void => {
    for (const node of lod0Nodes) {
      if (node.level !== 0) continue;
      const coord = nodeGridCoord(node);
      if (!coord) continue;
      const [x, z] = coord;
      for (let level = 1; level <= maxTerrainLevel; level++) {
        staleEditedAncestorIds.add(`L${level}:${x >> level},${z >> level}`);
      }
    }
  };
  return { staleEditedAncestorIds, vegetationDirtyQueue, markEditedAncestorsStale };
}
