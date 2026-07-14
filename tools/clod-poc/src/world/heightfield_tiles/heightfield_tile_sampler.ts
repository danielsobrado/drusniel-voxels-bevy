import type { HeightfieldSampler } from "../heightfield_sampler.js";
import { tileOriginM, worldToTile } from "../tile_key.js";
import { heightfieldTileSampleBilinear } from "./heightfield_tile.js";
import type { HeightfieldTileCache, HeightfieldTileCacheCounters } from "./heightfield_tile_cache.js";

function insideDomain(sampler: HeightfieldSampler, x: number, z: number): boolean {
  const domain = sampler.domain;
  return domain !== null
    && x >= domain.minX
    && z >= domain.minZ
    && x < domain.maxX
    && z < domain.maxZ;
}

export function heightfieldTileSampler(
  cache: HeightfieldTileCache,
  procedural: HeightfieldSampler,
  startupRaster: HeightfieldSampler | null = null,
): HeightfieldSampler {
  return Object.freeze({
    kind: "heightfield_tiles" as const,
    domain: null,
    sourceRevision: cache.sourceRevision,
    sampleHeight(x: number, z: number): number {
      if (startupRaster && Number.isInteger(x) && Number.isInteger(z) && insideDomain(startupRaster, x, z)) {
        return startupRaster.sampleHeight(x, z);
      }

      const key = worldToTile(x, z);
      const tile = cache.get(key);
      if (tile) {
        const origin = tileOriginM(key);
        const height = heightfieldTileSampleBilinear(tile, x - origin.x, z - origin.z);
        if (Number.isFinite(height)) return height;
      }

      if (startupRaster && insideDomain(startupRaster, x, z)) return startupRaster.sampleHeight(x, z);

      cache.recordFallbackSample();
      return procedural.sampleHeight(x, z);
    },
  });
}

export function publishHeightfieldTileCounters(
  target: Record<string, number> | null | undefined,
  counters: HeightfieldTileCacheCounters,
): void {
  if (!target) return;
  target["heightfield_tiles_enabled"] = counters.enabled;
  target["heightfield_tiles_resident"] = counters.resident;
  target["heightfield_tiles_required"] = counters.required;
  target["heightfield_tiles_pending"] = counters.pending;
  target["heightfield_tiles_inflight"] = counters.inflight;
  target["heightfield_tiles_builds_total"] = counters.buildsTotal;
  target["heightfield_tiles_build_ms_p95"] = counters.buildMsP95;
  target["heightfield_tiles_evictions_total"] = counters.evictionsTotal;
  target["heightfield_tiles_fallback_samples_total"] = counters.fallbackSamplesTotal;
  target["heightfield_tiles_fallback_samples_this_frame"] = counters.fallbackSamplesThisFrame;
  target["heightfield_tiles_bytes_resident"] = counters.bytesResident;
  target["heightfield_tiles_store_hits"] = counters.storeHits;
  target["heightfield_tiles_store_misses"] = counters.storeMisses;
  target["heightfield_tiles_store_errors"] = counters.storeErrors;
  target["heightfield_tiles_failures_total"] = counters.failuresTotal;
}
