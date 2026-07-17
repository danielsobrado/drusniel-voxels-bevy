import { ConstructionCollapseQueue } from "./construction_collapse_queue.js";
import { refreshConstructionGrounding, type ConstructionGroundingAabb, type ConstructionGroundSolidProbe } from "./construction_grounding.js";
import { ConstructionSupportGraph } from "./construction_support_graph.js";
import {
  predictConstructionStability,
  shouldConstructionCollapse,
  solveConstructionStabilityIsland,
  type ConstructionStabilityNode,
} from "./construction_stability.js";
import type {
  ConstructionMaterial,
  ConstructionPieceDef,
  ConstructionStabilityConfig,
  ConstructionStabilityPrediction,
  ConstructionSupportProfile,
  ConstructionVec3,
  PlacedConstructionPiece,
} from "./types.js";

export interface ConstructionStabilityRuntimeStats {
  dirtyStarts: number;
  islands: number;
  largestIsland: number;
  relaxations: number;
  capHits: number;
  changedPieces: number;
  pendingCollapses: number;
  collapsedTotal: number;
  solveMs: number;
}

const EMPTY_STATS: ConstructionStabilityRuntimeStats = {
  dirtyStarts: 0,
  islands: 0,
  largestIsland: 0,
  relaxations: 0,
  capHits: 0,
  changedPieces: 0,
  pendingCollapses: 0,
  collapsedTotal: 0,
  solveMs: 0,
};

export class ConstructionStabilityRuntime {
  readonly graph = new ConstructionSupportGraph();
  private readonly collapseQueue = new ConstructionCollapseQueue();
  private lastStats: ConstructionStabilityRuntimeStats = { ...EMPTY_STATS };
  private collapsedTotal = 0;

  constructor(
    private readonly config: ConstructionStabilityConfig,
    private readonly piecesById: ReadonlyMap<string, ConstructionPieceDef>,
    private readonly pieces: PlacedConstructionPiece[],
  ) {}

  rebuild(): void {
    this.collapseQueue.clear();
    this.graph.rebuild(this.pieces);
    this.syncConnectionsForAll();
  }

  addPiece(piece: PlacedConstructionPiece): void {
    this.graph.addNode(piece.id);
    for (const connectedId of piece.connectionIds ?? piece.parentIds ?? []) this.graph.connect(piece.id, connectedId);
    this.syncConnectionsFor(piece.id);
    for (const connectedId of this.graph.neighbors(piece.id)) this.syncConnectionsFor(connectedId);
    this.graph.markDirty(piece.id);
    this.graph.markDirtyMany(this.graph.neighbors(piece.id));
  }

  removePiece(id: string): readonly string[] {
    this.collapseQueue.cancel(id);
    const neighbors = this.graph.removeNode(id);
    for (const piece of this.pieces) {
      if (piece.id === id) continue;
      const nextConnections = (piece.connectionIds ?? piece.parentIds ?? []).filter((connectedId) => connectedId !== id);
      piece.connectionIds = nextConnections;
      piece.parentIds = nextConnections;
    }
    this.graph.markDirtyMany(neighbors);
    return neighbors;
  }

  refreshGrounding(groundSolidAt: ConstructionGroundSolidProbe, aabb?: ConstructionGroundingAabb): readonly string[] {
    const changed = refreshConstructionGrounding({
      pieces: this.pieces,
      piecesById: this.piecesById,
      groundSolidAt,
      aabb,
    });
    this.graph.markDirtyMany(changed);
    return changed;
  }

  predict(input: {
    piece: ConstructionPieceDef;
    material: ConstructionMaterial;
    position: ConstructionVec3;
    grounded: boolean;
    connectionIds: readonly string[];
  }): ConstructionStabilityPrediction {
    const byId = new Map(this.pieces.map((piece) => [piece.id, piece]));
    const connectedPieces = input.connectionIds
      .map((id) => byId.get(id))
      .filter((piece): piece is PlacedConstructionPiece => piece !== undefined);
    if (!this.config.enabled) {
      const profile = this.profileForMaterial(input.material);
      const supported = input.grounded || connectedPieces.length > 0;
      return {
        supported,
        grounded: input.grounded,
        value: profile.maxSupport,
        maxSupport: profile.maxSupport,
        ratio: 1,
        connectionIds: connectedPieces.map((piece) => piece.id).sort(),
        reason: supported ? null : "no support",
      };
    }
    return predictConstructionStability({
      grounded: input.grounded,
      position: input.position,
      targetProfile: this.profileForMaterial(input.material),
      connectedPieces,
      profileForPiece: (piece) => this.profileForPiece(piece),
      config: this.config,
    });
  }

  recomputeDirty(nowMs = performance.now()): readonly string[] {
    const startedAt = performance.now();
    const starts = this.graph.takeDirtyStarts();
    if (!this.config.enabled || starts.length === 0) {
      this.lastStats = {
        ...EMPTY_STATS,
        dirtyStarts: starts.length,
        pendingCollapses: this.collapseQueue.pendingCount(),
        collapsedTotal: this.collapsedTotal,
        solveMs: performance.now() - startedAt,
      };
      return [];
    }

    const byId = new Map(this.pieces.map((piece) => [piece.id, piece]));
    const visited = new Set<string>();
    const changedIds: string[] = [];
    let islands = 0;
    let largestIsland = 0;
    let relaxations = 0;
    let capHits = 0;

    for (const start of starts) {
      if (visited.has(start) || !byId.has(start)) continue;
      const island = this.graph.collectIsland(start, this.config.maxIslandSize);
      for (const id of island.ids) visited.add(id);
      if (island.exceededLimit) {
        capHits += 1;
        console.warn(`[construction] stability island exceeded ${this.config.maxIslandSize} pieces; prior values retained`);
        continue;
      }

      const nodes = new Map<string, ConstructionStabilityNode>();
      for (const id of island.ids) {
        const placed = byId.get(id);
        if (!placed) continue;
        nodes.set(id, {
          id,
          position: placed.position,
          profile: this.profileForPiece(placed),
          grounded: placed.grounded === true,
        });
      }
      const solved = solveConstructionStabilityIsland(nodes, this.graph, this.config.epsilon);
      islands += 1;
      largestIsland = Math.max(largestIsland, nodes.size);
      relaxations += solved.relaxations;

      for (const [id, value] of solved.values) {
        const placed = byId.get(id);
        if (!placed) continue;
        const oldValue = placed.stability ?? 0;
        const oldUnsupported = placed.unsupported === true;
        const oldCollapsePending = placed.collapsePending === true;
        const unstable = shouldConstructionCollapse({ grounded: placed.grounded, stability: value }, this.config);
        placed.stability = value;
        placed.unsupported = unstable;
        placed.collapsePending = unstable;
        if (unstable) this.collapseQueue.schedule(id, nowMs, this.config.collapseDelayMs);
        else this.collapseQueue.cancel(id);
        if (Math.abs(oldValue - value) > this.config.epsilon
          || oldUnsupported !== unstable
          || oldCollapsePending !== unstable) {
          changedIds.push(id);
        }
      }
    }

    this.syncConnectionsForAll();
    this.lastStats = {
      dirtyStarts: starts.length,
      islands,
      largestIsland,
      relaxations,
      capHits,
      changedPieces: changedIds.length,
      pendingCollapses: this.collapseQueue.pendingCount(),
      collapsedTotal: this.collapsedTotal,
      solveMs: performance.now() - startedAt,
    };
    return changedIds;
  }

  takeReadyCollapseIds(nowMs = performance.now()): readonly string[] {
    return this.collapseQueue.takeReady(nowMs, this.config.maxCollapsesPerFrame);
  }

  isStillUnstable(id: string): boolean {
    const piece = this.pieces.find((candidate) => candidate.id === id);
    return piece ? shouldConstructionCollapse(piece, this.config) : false;
  }

  cancelCollapse(id: string): void {
    this.collapseQueue.cancel(id);
    const piece = this.pieces.find((candidate) => candidate.id === id);
    if (piece) piece.collapsePending = false;
  }

  recordCollapsed(count: number): void {
    this.collapsedTotal += Math.max(0, count);
  }

  markAllDirty(): void {
    this.graph.markAllDirty();
  }

  stats(): ConstructionStabilityRuntimeStats {
    return {
      ...this.lastStats,
      pendingCollapses: this.collapseQueue.pendingCount(),
      collapsedTotal: this.collapsedTotal,
    };
  }

  profileForMaterial(material: ConstructionMaterial): ConstructionSupportProfile {
    return this.config.materialProfiles[material];
  }

  profileForPiece(piece: PlacedConstructionPiece): ConstructionSupportProfile {
    const definition = this.piecesById.get(piece.typeId);
    return this.profileForMaterial(piece.material ?? definition?.material ?? "wood");
  }

  private syncConnectionsForAll(): void {
    for (const piece of this.pieces) this.syncConnectionsFor(piece.id);
  }

  private syncConnectionsFor(id: string): void {
    const piece = this.pieces.find((candidate) => candidate.id === id);
    if (!piece || !this.graph.hasNode(id)) return;
    const connections = this.graph.neighbors(id);
    piece.connectionIds = connections;
    piece.parentIds = connections;
  }
}
