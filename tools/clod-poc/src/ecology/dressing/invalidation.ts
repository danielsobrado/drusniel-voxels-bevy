import type { DressingBounds3D } from "./types.js";

export interface DressingInvalidationCluster {
  readonly id: string;
  readonly bounds: DressingBounds3D;
}

function overlaps(a: DressingBounds3D, b: DressingBounds3D): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX
    && a.minY <= b.maxY && a.maxY >= b.minY
    && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}

export class DressingInvalidationQueue {
  private readonly clusters = new Map<string, DressingBounds3D>();
  private readonly queued = new Set<string>();

  constructor(private readonly maximumClustersPerFrame = 8) {
    if (!Number.isSafeInteger(maximumClustersPerFrame) || maximumClustersPerFrame < 1) {
      throw new Error("maximum clusters per frame must be a positive integer");
    }
  }

  register(cluster: DressingInvalidationCluster): void {
    this.clusters.set(cluster.id, cluster.bounds);
  }

  unregister(id: string): void {
    this.clusters.delete(id);
    this.queued.delete(id);
  }

  invalidate(bounds: DressingBounds3D): readonly string[] {
    const invalidated: string[] = [];
    for (const [id, clusterBounds] of this.clusters) {
      if (!overlaps(bounds, clusterBounds)) continue;
      this.queued.add(id);
      invalidated.push(id);
    }
    return invalidated;
  }

  drain(): readonly string[] {
    const result = [...this.queued].sort().slice(0, this.maximumClustersPerFrame);
    for (const id of result) this.queued.delete(id);
    return result;
  }

  get pending(): number {
    return this.queued.size;
  }
}
