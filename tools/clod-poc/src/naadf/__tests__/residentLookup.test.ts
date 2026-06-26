import { describe, expect, it } from "vitest";
import { createHashFallback } from "../hash.js";
import { createNearPageTable } from "../nearPageTable.js";
import { NaadfMetricsCollector } from "../metrics.js";
import { syncResidentLookupTables } from "../residentLookup.js";
import type { ResidentChunkEntry } from "../types.js";

function readyEntry(key: { x: number; z: number }, indexHint: number): ResidentChunkEntry {
  return {
    key,
    state: "ready",
    brick: { revision: indexHint } as ResidentChunkEntry["brick"],
    mipChain: null,
    pendingBrick: null,
    pendingMipChain: null,
    revision: indexHint,
    requestedFrame: 0,
    builtFrame: 0,
    lastTouchedFrame: 0,
    coolingSinceMs: 0,
  };
}

describe("naadf resident lookup", () => {
  it("counts hash insert failures when the fallback table is full", () => {
    const nearTable = createNearPageTable(0);
    const hashTable = createHashFallback(4);
    const metrics = new NaadfMetricsCollector();
    const residents: ResidentChunkEntry[] = [
      readyEntry({ x: 100, z: 0 }, 0),
      readyEntry({ x: 200, z: 0 }, 1),
      readyEntry({ x: 300, z: 0 }, 2),
      readyEntry({ x: 400, z: 0 }, 3),
      readyEntry({ x: 500, z: 0 }, 4),
    ];

    syncResidentLookupTables(nearTable, hashTable, residents, metrics);

    expect(metrics.hashInsertFailures).toBe(1);
  });
});
