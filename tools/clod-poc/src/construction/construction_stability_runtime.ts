import {
  constructionSupportProfile,
  shouldCollapseConstruction,
  solveConstructionStability,
  type ConstructionStabilityNode,
} from "./construction_stability.js";
import type { ConstructionSupportGraph } from "./construction_support_graph.js";
import type {
  ConstructionPieceDef,
  ConstructionStabilityConfig,
  ConstructionSupportProfiles,
  PlacedConstructionPiece,
} from "./types.js";

export interface ConstructionStabilityRuntimeStats {
  recomputeMs: number;
  recomputeCount: number;
  islandsLast: number;
  largestIslandLast: number;
  relaxationsLast: number;
  capHitsTotal: number;
  pendingCollapses: number;
  collapsedTotal: number;
}

export interface ConstructionStabilityRecomputeResult {
  changedIds: readonly string[];
  islands: number;
  largestIsland: number;
  relaxations: number;
  capHits: number;
  elapsedMs: number;
}

export interface ConstructionStabilityRemovalResult {
  removed: boolean;
  disconnectedNeighborIds: readonly string[];
}

export interface ConstructionCollapseStepResult {
  collapsedIds: readonly string[];
  recomputes: number;
}

export class ConstructionStabilityRuntime {
  private readonly dirtyIds = new Set<string>();
  private readonly runtimeStats: ConstructionStabilityRuntimeStats = {
    recomputeMs: 0,
    recomputeCount: 0,
    islandsLast: 0,
    largestIslandLast: 0,
    relaxationsLast: 0,
    capHitsTotal: 0,
    pendingCollapses: 0,
    collapsedTotal: 0,
  };

  constructor(
    private readonly graph: ConstructionSupportGraph,
    private readonly piecesById: ReadonlyMap<string, ConstructionPieceDef>,
    private readonly supportProfiles: ConstructionSupportProfiles,
    private readonly config: ConstructionStabilityConfig,
  ) {}

  markDirty(id: string): void {
    if (this.graph.hasNode(id)) this.dirtyIds.add(id);
  }

  markDirtyMany(ids: Iterable<string>): void {
    for (const id of ids) this.markDirty(id);
  }

  markAllDirty(pieces: readonly PlacedConstructionPiece[]): void {
    for (const piece of pieces) this.markDirty(piece.id);
  }

  recompute(pieces: readonly PlacedConstructionPiece[]): ConstructionStabilityRecomputeResult {
    const startedAt = performance.now();
    if (this.dirtyIds.size === 0) {
      return { changedIds: [], islands: 0, largestIsland: 0, relaxations: 0, capHits: 0, elapsedMs: 0 };
    }

    const placedById = new Map(pieces.map((piece) => [piece.id, piece]));
    const pending = [...this.dirtyIds].sort();
    this.dirtyIds.clear();
    const visited = new Set<string>();
    const changedIds = new Set<string>();
    let islands = 0;
    let largestIsland = 0;
    let relaxations = 0;
    let capHits = 0;

    for (const start of pending) {
      if (visited.has(start) || !placedById.has(start)) continue;
      const island = this.graph.collectIsland(start, this.config.maxIslandSize);
      for (const id of island.ids) visited.add(id);
      if (island.truncated) {
        capHits += 1;
        console.warn(`[construction] stability island exceeded cap of ${this.config.maxIslandSize}; prior values retained`);
        continue;
      }

      const nodes = new Map<string, ConstructionStabilityNode>();
      for (const id of island.ids) {
        const placed = placedById.get(id);
        if (!placed) continue;
        const definition = this.piecesById.get(placed.typeId);
        if (!definition) continue;
        const material = placed.material ?? definition.material;
        nodes.set(id, {
          id,
          position: placed.position,
          profile: constructionSupportProfile(definition, material, this.supportProfiles),
          grounded: placed.grounded === true,
        });
      }

      const solved = solveConstructionStability(nodes, (id) => this.graph.neighbors(id), this.config);
      islands += 1;
      largestIsland = Math.max(largestIsland, nodes.size);
      relaxations += solved.relaxations;

      for (const [id, node] of nodes) {
        const placed = placedById.get(id)!;
        const value = solved.values.get(id) ?? 0;
        const unsupported = shouldCollapseConstruction(value, node.grounded, this.config);
        if (Math.abs((placed.stability ?? 0) - value) > this.config.epsilon
          || (placed.unsupported === true) !== unsupported) changedIds.add(id);
        placed.stability = value;
        if (unsupported) placed.unsupported = true;
        else delete placed.unsupported;
      }
    }

    const elapsedMs = performance.now() - startedAt;
    this.runtimeStats.recomputeMs = elapsedMs;
    this.runtimeStats.recomputeCount += 1;
    this.runtimeStats.islandsLast = islands;
    this.runtimeStats.largestIslandLast = largestIsland;
    this.runtimeStats.relaxationsLast = relaxations;
    this.runtimeStats.capHitsTotal += capHits;
    this.runtimeStats.pendingCollapses = 0;
    return { changedIds: [...changedIds].sort(), islands, largestIsland, relaxations, capHits, elapsedMs };
  }

  processPendingCollapses(
    _pieces: PlacedConstructionPiece[],
    _removePiece: (id: string) => ConstructionStabilityRemovalResult,
  ): ConstructionCollapseStepResult {
    // TODO: Reintroduce paced collapse only with the structural-collapse plan's visible
    // motion, physics, damage, and persistence contract. Unsupported pieces remain present.
    return { collapsedIds: [], recomputes: 0 };
  }

  pendingCollapseCount(): number {
    return 0;
  }

  stats(): ConstructionStabilityRuntimeStats {
    return { ...this.runtimeStats, pendingCollapses: 0 };
  }
}
