import type { TerrainMaterialCacheEntry, TerrainMaterialSourceProvider } from "./terrainMaterialCacheTypes.js";

export interface TerrainMaterialBakeJob {
  cacheKey: string;
  entry: TerrainMaterialCacheEntry;
  provider: TerrainMaterialSourceProvider;
}

export class TerrainMaterialBakeQueue {
  private readonly jobs: TerrainMaterialBakeJob[] = [];
  private readonly queuedKeys = new Set<string>();

  enqueue(key: string, job: TerrainMaterialBakeJob): boolean {
    if (this.queuedKeys.has(key)) return false;
    this.jobs.push(job);
    this.queuedKeys.add(key);
    return true;
  }

  take(): TerrainMaterialBakeJob | null {
    const job = this.jobs.shift() ?? null;
    if (job) this.queuedKeys.delete(job.cacheKey);
    return job;
  }

  takeByCacheKey(cacheKey: string): TerrainMaterialBakeJob | null {
    const index = this.jobs.findIndex((job) => job.cacheKey === cacheKey);
    if (index < 0) return null;
    const [job] = this.jobs.splice(index, 1);
    this.queuedKeys.delete(cacheKey);
    return job ?? null;
  }

  removeWhere(predicate: (job: TerrainMaterialBakeJob) => boolean): number {
    let removed = 0;
    for (let i = this.jobs.length - 1; i >= 0; i--) {
      const job = this.jobs[i]!;
      if (!predicate(job)) continue;
      this.jobs.splice(i, 1);
      this.queuedKeys.delete(job.cacheKey);
      removed++;
    }
    return removed;
  }

  get length(): number {
    return this.jobs.length;
  }
}
