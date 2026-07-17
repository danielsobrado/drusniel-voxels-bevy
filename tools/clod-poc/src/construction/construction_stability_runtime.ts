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
  private readonly pendingCollapseIds = new Set<string>();
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
        const collapsing = shouldCollapseConstruction(value, node.grounded, this.config);
        if (Math.abs((placed.stability ?? 0) - value) > this.config.epsilon
          || (placed.unsupported === true) !== collapsing) changedIds.add(id);
        placed.stability = value;
        if (collapsing) {
          placed.unsupported = true;
          this.pendingCollapseIds.add(id);
        } else {
          delete placed.unsupported;
          this.pendingCollapseIds.delete(id);
        }
      }
    }

    const elapsedMs = performance.now() - startedAt;
    this.runtimeStats.recomputeMs = elapsedMs;
    this.runtimeStats.recomputeCount += 1;
    this.runtimeStats.islandsLast = islands;
    this.runtimeStats.largestIslandLast = largestIsland;
    this.runtimeStats.relaxationsLast = relaxations;
    this.runtimeStats.capHitsTotal += capHits;
    this.runtimeStats.pendingCollapses = this.pendingCollapseIds.size;
    return { changedIds: [...changedIds].sort(), islands, largestIsland, relaxations, capHits, elapsedMs };
  }

  processPendingCollapses(
    pieces: PlacedConstructionPiece[],
    removePiece: (id: string) => ConstructionStabilityRemovalResult,
  ): ConstructionCollapseStepResult {
    const collapsedIds: string[] = [];
    let recomputes = 0;
    for (let index = 0; index < this.config.maxCollapsesPerFrame; index += 1) {
      if (this.dirtyIds.size > 0) {
        this.recompute(pieces);
        recomputes += 1;
      }
      const nextId = [...this.pendingCollapseIds].sort()[0];
      if (!nextId) break;
      const placed = pieces.find((piece) => piece.id === nextId);
      if (!placed || !shouldCollapseConstruction(placed.stability ?? 0, placed.grounded === true, this.config)) {
        this.pendingCollapseIds.delete(nextId);
        continue;
      }
      const removal = removePiece(nextId);
      this.pendingCollapseIds.delete(nextId);
      if (!removal.removed) continue;
      collapsedIds.push(nextId);
      this.markDirtyMany(removal.disconnectedNeighborIds);
      if (this.dirtyIds.size > 0) {
        this.recompute(pieces);
        recomputes += 1;
      }
    }
    this.runtimeStats.collapsedTotal += collapsedIds.length;
    this.runtimeStats.pendingCollapses = this.pendingCollapseIds.size;
    return { collapsedIds, recomputes };
  }

  pendingCollapseCount(): number {
    return this.pendingCollapseIds.size;
  }

  stats(): ConstructionStabilityRuntimeStats {
    return { ...this.runtimeStats, pendingCollapses: this.pendingCollapseIds.size };
  }
}
