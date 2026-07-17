import type { PlacedConstructionPiece } from "./types.js";

export interface ConstructionSupportIsland {
  ids: readonly string[];
  truncated: boolean;
}

export class ConstructionSupportGraph {
  private readonly adjacency = new Map<string, Set<string>>();

  clear(): void {
    this.adjacency.clear();
  }

  addNode(id: string): void {
    if (!this.adjacency.has(id)) this.adjacency.set(id, new Set());
  }

  hasNode(id: string): boolean {
    return this.adjacency.has(id);
  }

  connect(a: string, b: string): void {
    if (a === b || !this.adjacency.has(a) || !this.adjacency.has(b)) return;
    this.adjacency.get(a)!.add(b);
    this.adjacency.get(b)!.add(a);
  }

  replaceConnections(id: string, connectionIds: readonly string[]): void {
    this.addNode(id);
    for (const neighbor of this.removeEdges(id)) this.adjacency.get(neighbor)?.delete(id);
    for (const connectionId of connectionIds) this.connect(id, connectionId);
  }

  removeNode(id: string): readonly string[] {
    const neighbors = this.removeEdges(id);
    this.adjacency.delete(id);
    for (const neighbor of neighbors) this.adjacency.get(neighbor)?.delete(id);
    return neighbors;
  }

  neighbors(id: string): readonly string[] {
    return [...(this.adjacency.get(id) ?? [])].sort();
  }

  collectIsland(start: string, maxSize: number): ConstructionSupportIsland {
    if (!this.adjacency.has(start)) return { ids: [], truncated: false };
    const visited = new Set<string>([start]);
    const queue = [start];
    const ids: string[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      ids.push(id);
      if (ids.length > maxSize) return { ids, truncated: true };
      for (const neighbor of this.neighbors(id)) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    return { ids, truncated: false };
  }

  rebuild(pieces: readonly PlacedConstructionPiece[]): void {
    this.clear();
    for (const piece of pieces) this.addNode(piece.id);
    for (const piece of pieces) {
      for (const connectionId of piece.connectionIds ?? piece.parentIds ?? []) this.connect(piece.id, connectionId);
    }
  }

  nodeCount(): number {
    return this.adjacency.size;
  }

  edgeCount(): number {
    let directedEdges = 0;
    for (const neighbors of this.adjacency.values()) directedEdges += neighbors.size;
    return directedEdges / 2;
  }

  private removeEdges(id: string): readonly string[] {
    const neighbors = [...(this.adjacency.get(id) ?? [])];
    this.adjacency.get(id)?.clear();
    return neighbors;
  }
}
