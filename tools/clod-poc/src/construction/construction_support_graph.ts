import type { PlacedConstructionPiece } from "./types.js";

export interface ConstructionSupportIsland {
  ids: readonly string[];
  exceededLimit: boolean;
}

export class ConstructionSupportGraph {
  private readonly edges = new Map<string, Set<string>>();
  private readonly dirty = new Set<string>();

  clear(): void {
    this.edges.clear();
    this.dirty.clear();
  }

  rebuild(pieces: readonly PlacedConstructionPiece[]): void {
    this.clear();
    const ids = new Set(pieces.map((piece) => piece.id));
    for (const piece of pieces) this.addNode(piece.id);
    for (const piece of pieces) {
      for (const connectedId of piece.connectionIds ?? piece.parentIds ?? []) {
        if (ids.has(connectedId)) this.connect(piece.id, connectedId);
      }
    }
    this.markAllDirty();
  }

  addNode(id: string): void {
    if (!this.edges.has(id)) this.edges.set(id, new Set());
  }

  hasNode(id: string): boolean {
    return this.edges.has(id);
  }

  connect(a: string, b: string): void {
    if (a === b || !this.edges.has(a) || !this.edges.has(b)) return;
    this.edges.get(a)!.add(b);
    this.edges.get(b)!.add(a);
  }

  neighbors(id: string): readonly string[] {
    return [...(this.edges.get(id) ?? [])].sort();
  }

  removeNode(id: string): readonly string[] {
    const neighbors = this.neighbors(id);
    this.edges.delete(id);
    this.dirty.delete(id);
    for (const neighbor of neighbors) {
      this.edges.get(neighbor)?.delete(id);
      this.dirty.add(neighbor);
    }
    return neighbors;
  }

  markDirty(id: string): void {
    if (this.edges.has(id)) this.dirty.add(id);
  }

  markDirtyMany(ids: Iterable<string>): void {
    for (const id of ids) this.markDirty(id);
  }

  markAllDirty(): void {
    for (const id of this.edges.keys()) this.dirty.add(id);
  }

  takeDirtyStarts(): readonly string[] {
    const result = [...this.dirty].sort();
    this.dirty.clear();
    return result;
  }

  dirtyCount(): number {
    return this.dirty.size;
  }

  collectIsland(start: string, maxSize: number): ConstructionSupportIsland {
    if (!this.edges.has(start)) return { ids: [], exceededLimit: false };
    const limit = Math.max(1, Math.floor(maxSize));
    const visited = new Set<string>([start]);
    const queue = [start];
    const result: string[] = [];

    while (queue.length > 0) {
      const id = queue.shift()!;
      result.push(id);
      if (result.length > limit) return { ids: result, exceededLimit: true };
      for (const neighbor of this.neighbors(id)) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    return { ids: result, exceededLimit: false };
  }
}
