import type {
  GpuClodRootBuildRequest,
  GpuClodRootBuildResult,
  GpuClodRootMesher,
  GpuClodRootMesherStats,
} from "./gpu_clod_root_mesher_single.js";
import type { GpuClodResidentPageCache } from "./gpu_clod_resident_page_cache.js";
import {
  destroyGpuClodResidentPage,
  type GpuClodResidentPage,
} from "./gpu_clod_resident_types.js";

export interface BufferedResidentAdoption {
  onPage(page: GpuClodResidentPage): void;
  wrap(mesher: GpuClodRootMesher): GpuClodRootMesher;
}

export function createBufferedResidentAdoption(
  cache: GpuClodResidentPageCache,
): BufferedResidentAdoption {
  const pending: GpuClodResidentPage[] = [];
  let active = false;

  const clearPending = (): void => {
    for (const page of pending.splice(0)) destroyGpuClodResidentPage(page);
  };

  return {
    onPage(page) {
      pending.push(page);
    },
    wrap(mesher) {
      return {
        async buildPages(batch: readonly GpuClodRootBuildRequest[]): Promise<GpuClodRootBuildResult> {
          if (active || pending.length > 0) {
            clearPending();
            throw new Error("GPU CLOD resident adoption buffer entered an invalid overlapping state");
          }
          active = true;
          try {
            const result = await mesher.buildPages(batch);
            cache.adoptMany(pending);
            pending.length = 0;
            return result;
          } catch (error) {
            clearPending();
            throw error;
          } finally {
            active = false;
          }
        },
        stats(): GpuClodRootMesherStats {
          return mesher.stats();
        },
        recordFallbackPages(count: number): void {
          mesher.recordFallbackPages(count);
        },
        recordWorkerFallbackPages(count: number): void {
          mesher.recordWorkerFallbackPages(count);
        },
        dispose(): void {
          clearPending();
          mesher.dispose();
        },
      };
    },
  };
}
