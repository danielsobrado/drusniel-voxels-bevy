import type { TerrainQueryResult } from "./types.js";
import type { LocalCounters } from "./query_types.js";

export function recordLocalCounters(counters: LocalCounters, terrain: TerrainQueryResult): void {
  if (terrain.nearTableHit) counters.nearTableHits++;
  if (terrain.hashFallbackHit) counters.hashFallbackHits++;
  if (terrain.farClipmapHit) counters.farClipmapHits++;
  if (terrain.unknown || terrain.missingSample) counters.missingSamples++;
}
