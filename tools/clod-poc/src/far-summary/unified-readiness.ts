import type { FarSummaryRingRequest } from "./clipmap-rings.js";
import type { FarSummaryCache } from "./summary-cache.js";
import type { FarSummaryUnifiedEnrichmentState } from "./summary-tile-builder.js";
import { requestKey } from "./cpu-unified-builder.js";

export interface FarSummaryUnifiedReadiness {
  terrainWaterReady: number;
  waterPending: number;
  canopyPending: number;
  fullyEnriched: number;
}

export function countFarSummaryUnifiedReadiness(
  cache: FarSummaryCache,
  requests: readonly FarSummaryRingRequest[],
  pending: ReadonlyMap<string, FarSummaryUnifiedEnrichmentState>,
  activeBaseKeys: { has(key: string): boolean },
): FarSummaryUnifiedReadiness {
  let waterPending = 0;
  let canopyPending = 0;

  for (const enrichment of pending.values()) {
    if (enrichment.nextSample < enrichment.tile.samples.length) {
      waterPending++;
    } else {
      canopyPending++;
    }
  }

  let terrainWaterReady = 0;
  let fullyEnriched = 0;
  const seen = new Set<string>();

  for (const request of requests) {
    const key = requestKey(request);
    if (seen.has(key)) continue;
    seen.add(key);

    const tile = cache.getTile(request.key);
    if (!isUsable(tile)) continue;

    terrainWaterReady++;
    if (!pending.has(key) && !activeBaseKeys.has(key)) fullyEnriched++;
  }

  return {
    terrainWaterReady,
    waterPending,
    canopyPending,
    fullyEnriched,
  };
}

function isUsable(tile: ReturnType<FarSummaryCache["getTile"]>): boolean {
  if (!tile || tile.samples.length === 0) return false;
  return tile.state === "ready" || tile.state === "stale" || tile.state === "cooling";
}
