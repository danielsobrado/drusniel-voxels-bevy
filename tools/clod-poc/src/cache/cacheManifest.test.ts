import { describe, expect, it } from "vitest";
import { ClodCacheManifest } from "./cacheManifest.js";

function entry(key: string, lastAccessedUnixMs: number, storedBytes = 10) {
  return {
    key,
    artifactKind: "clod-page-node" as const,
    createdAtUnixMs: lastAccessedUnixMs,
    lastAccessedUnixMs,
    hitCount: 0,
    storedBytes,
  };
}

describe("ClodCacheManifest eviction planning", () => {
  it("selects the oldest entries without deleting them before storage succeeds", () => {
    const manifest = new ClodCacheManifest();
    manifest.upsert(entry("old", 1));
    manifest.upsert(entry("new", 2));

    expect(manifest.evictionCandidates(1, 100).map((candidate) => candidate.key)).toEqual(["old"]);
    expect(manifest.listEntries().map((candidate) => candidate.key).sort()).toEqual(["new", "old"]);
  });
});
