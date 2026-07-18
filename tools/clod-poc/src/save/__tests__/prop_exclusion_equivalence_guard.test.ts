import { indexedDB } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveEnvironmentalPropId } from "../../world/prop_identity.js";
import {
  clearSaveRuntime,
  configurePropExclusionEquivalenceGuard,
  destroyEnvironmentalPropCandidate,
  initSaveRuntime,
  type SaveRuntimeCounters,
} from "../save_runtime.js";
import { loadSavedWorldFromDb } from "../save_service.js";
import { openSaveDb, writeSaveManifestAndMetadata } from "../save_db.js";

afterEach(() => {
  configurePropExclusionEquivalenceGuard({ enabled: false, everyNEdits: 16 });
  clearSaveRuntime();
});

async function bootEmptySave(counters: Partial<SaveRuntimeCounters>): Promise<void> {
  const db = await openSaveDb(indexedDB, `guard-${Date.now()}-${Math.random()}`);
  await writeSaveManifestAndMetadata(db, {
    schemaVersion: 1,
    saveId: "guard-save",
    worldId: "guard-world",
    seed: 7,
    proceduralProfile: "infinite-islands-v1",
    regionSizeM: 512,
    chunkSizeM: 16,
    regionKeys: [],
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
  }, {
    schemaVersion: 1,
    cities: [],
    districts: [],
    roads: [],
    caveEntrances: [],
    caveSystems: [],
    criticalPaths: [],
    revision: 1,
  });
  const loaded = await loadSavedWorldFromDb(db, "guard-save", { replaceVoxelSnapshot: () => {} });
  initSaveRuntime(loaded, counters);
  db.close();
}

describe("prop exclusion equivalence guard (test-only)", () => {
  beforeEach(() => {
    configurePropExclusionEquivalenceGuard({ enabled: true, everyNEdits: 1 });
  });

  it("stays mismatch-free across a destroy sequence when enabled", async () => {
    const counters: Partial<SaveRuntimeCounters> = {};
    await bootEmptySave(counters);
    for (let i = 0; i < 8; i += 1) {
      const address = { tileKey: { x: 0, z: 0 }, layer: "tree" as const, candidateIndex: i };
      destroyEnvironmentalPropCandidate(address, [i * 8, 0, 4], "environment/tree");
      expect(deriveEnvironmentalPropId("guard-world", address)).toMatch(/^env_/);
    }
    expect(counters.prop_exclusion_guard_mismatches ?? 0).toBe(0);
  });
});
