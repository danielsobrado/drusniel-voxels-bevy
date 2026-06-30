import { describe, expect, it } from "vitest";
import {
  validateTreeParityEvidence,
  type TreeParityEvidenceFileInfo,
  type TreeParityEvidenceManifest,
} from "./tree_parity_evidence.js";

describe("TREE-12 parity evidence validator", () => {
  it("passes when required artifacts and metric floors are present", () => {
    const result = validateTreeParityEvidence({
      manifest: manifest(),
      fileInfo: fileInfo({
        "shots/low-sun.png": { exists: true, sizeBytes: 128 },
        "shots/low-sun-stats.json": { exists: true, sizeBytes: 256 },
        "perf/low-sun-summary.json": { exists: true, sizeBytes: 512 },
      }),
      readJson: jsonReader({
        "shots/low-sun-stats.json": { ready: true, error: null },
        "perf/low-sun-summary.json": {
          counters: {
            treeGpuShadowCasterCountAvg: 12,
            treeHeroNearTrianglesAvg: 120_000,
            treeHeroNearFoliageTrianglesAvg: 42_000,
          },
        },
      }),
    });

    expect(result).toEqual({ ok: true, failures: [] });
  });

  it("fails missing artifacts and metric floors clearly", () => {
    const result = validateTreeParityEvidence({
      manifest: manifest(),
      fileInfo: fileInfo({
        "shots/low-sun.png": { exists: false, sizeBytes: 0 },
        "shots/low-sun-stats.json": { exists: true, sizeBytes: 32 },
        "perf/low-sun-summary.json": { exists: true, sizeBytes: 32 },
      }),
      readJson: jsonReader({
        "shots/low-sun-stats.json": { ready: false, error: null },
        "perf/low-sun-summary.json": {
          counters: {
            treeGpuShadowCasterCountAvg: 0,
            treeHeroNearTrianglesAvg: 20_000,
            treeHeroNearFoliageTrianglesAvg: 0,
          },
        },
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.message)).toEqual(expect.arrayContaining([
      "image artifact is missing: shots/low-sun.png",
      "stats.ready expected true, got false",
      "perf.counters.treeGpuShadowCasterCountAvg expected non-zero, got 0",
      "perf.counters.treeHeroNearTrianglesAvg expected >= 100000, got 20000",
      "perf.counters.treeHeroNearFoliageTrianglesAvg expected non-zero, got 0",
    ]));
  });

  it("reports invalid JSON reads as evidence failures", () => {
    const result = validateTreeParityEvidence({
      manifest: {
        captures: [{
          id: "bad-json",
          artifacts: { perf: "perf/missing.json" },
          metrics: [{ artifact: "perf", path: "counters.frameMs", min: 1 }],
        }],
      },
      fileInfo: () => ({ exists: true, sizeBytes: 1 }),
      readJson: () => { throw new Error("not json"); },
    });

    expect(result.ok).toBe(false);
    expect(result.failures[0]?.message).toContain("cannot read perf JSON perf/missing.json: not json");
  });
});

function manifest(): TreeParityEvidenceManifest {
  return {
    captures: [{
      id: "low-sun-shadows",
      artifacts: {
        image: "shots/low-sun.png",
        stats: "shots/low-sun-stats.json",
        perf: "perf/low-sun-summary.json",
      },
      metrics: [
        { artifact: "stats", path: "ready", equals: true },
        { artifact: "perf", path: "counters.treeGpuShadowCasterCountAvg", nonZero: true },
        { artifact: "perf", path: "counters.treeHeroNearTrianglesAvg", min: 100_000 },
        { artifact: "perf", path: "counters.treeHeroNearFoliageTrianglesAvg", nonZero: true },
      ],
    }],
  };
}

function fileInfo(files: Record<string, TreeParityEvidenceFileInfo>) {
  return (path: string) => files[path] ?? { exists: false, sizeBytes: 0 };
}

function jsonReader(files: Record<string, unknown>) {
  return (path: string) => files[path];
}
