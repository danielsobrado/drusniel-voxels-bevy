import { describe, expect, it } from "vitest";
import { buildClodCacheKey } from "../cacheKey.js";
import type { ClodCacheKeyParts } from "../cacheTypes.js";

const base: ClodCacheKeyParts = {
  namespace: "drusniel-clod-poc",
  schemaVersion: 1,
  builderVersion: "clod-poc-cache-v1",
  artifactKind: "clod-page-node",
  worldSeed: "0",
  generatorVersion: "0.22.0",
  sourceRevision: "abc123",
  configHash: "cfg111",
  sourceHash: "src222",
  pageX: 2,
  pageZ: 3,
  lod: 1,
  nodeId: "L1:2,3",
};

describe("cache key", () => {
  it("is stable for identical inputs", () => {
    const a = buildClodCacheKey(base);
    const b = buildClodCacheKey({ ...base });
    expect(a).toBe(b);
    expect(a).toBe(
      "drusniel-clod-poc/1/clod-poc-cache-v1/clod-page-node/0/0.22.0/abc123/cfg111/src222/2_3_lod1_node_L1-2-3",
    );
  });

  it("changes when config hash changes", () => {
    const a = buildClodCacheKey(base);
    const b = buildClodCacheKey({ ...base, configHash: "cfg999" });
    expect(a).not.toBe(b);
  });

  it("changes when source hash changes", () => {
    const a = buildClodCacheKey(base);
    const b = buildClodCacheKey({ ...base, sourceHash: "src999" });
    expect(a).not.toBe(b);
  });

  it("changes when builder version changes", () => {
    const a = buildClodCacheKey(base);
    const b = buildClodCacheKey({ ...base, builderVersion: "clod-poc-cache-v2" });
    expect(a).not.toBe(b);
  });

  it("uses underscore placeholders for undefined page fields", () => {
    const key = buildClodCacheKey({
      ...base,
      pageX: undefined,
      pageZ: undefined,
      lod: undefined,
      nodeId: undefined,
      artifactKind: "terrain-summary",
    });
    expect(key.split("/").at(-1)).toBe("_____");
  });
});
