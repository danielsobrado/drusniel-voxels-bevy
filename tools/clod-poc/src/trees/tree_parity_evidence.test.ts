import { describe, expect, it } from "vitest";
import {
  buildTreeParityCaptureCommands,
  buildTreeParityEvidenceMarkdownReport,
  validateTreeParityEvidence,
  validateTreeParityManifestCaptureConfig,
  type TreeParityEvidenceFileInfo,
  type TreeParityEvidenceManifest,
} from "./tree_parity_evidence.js";

describe("TREE-12 parity evidence validator", () => {
  it("passes when required artifacts and metric floors are present", () => {
    const result = validateTreeParityEvidence(validInput());

    expect(result).toEqual({ ok: true, failures: [] });
  });

  it("fails missing artifacts and metric floors clearly", () => {
    const result = validateTreeParityEvidence(failingInput());

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.message)).toEqual(expect.arrayContaining([
      "image artifact is missing: shots/low-sun.png",
      "stats.ready expected true, got false",
      "perf.snapshot.counters.treeGpuShadowCasterCountAvg expected non-zero, got 0",
      "perf.snapshot.counters.treeHeroNearTrianglesAvg expected >= 100000, got 20000",
      "perf.snapshot.counters.treeHeroNearFoliageTrianglesAvg expected non-zero, got 0",
    ]));
  });

  it("reports invalid JSON reads as evidence failures", () => {
    const result = validateTreeParityEvidence({
      manifest: {
        captures: [{
          id: "bad-json",
          artifacts: { perf: "perf/missing.json" },
          capture: { perfCase: "tree-gpu-ring" },
          metrics: [{ artifact: "perf", path: "snapshot.counters.frameMs", min: 1 }],
        }],
      },
      fileInfo: () => ({ exists: true, sizeBytes: 1 }),
      readJson: () => { throw new Error("not json"); },
    });

    expect(result.ok).toBe(false);
    expect(result.failures[0]?.message).toContain("cannot read perf JSON perf/missing.json: not json");
  });
});

describe("TREE-12 parity manifest capture validation", () => {
  it("rejects unsupported capture params before command generation", () => {
    const invalid = manifest({ sunPreset: "low" });

    expect(validateTreeParityManifestCaptureConfig(invalid)).toEqual([
      { captureId: "low-sun-shadows", message: "unsupported capture param: sunPreset" },
    ]);
    expect(() => buildTreeParityCaptureCommands(invalid)).toThrow("unsupported capture param: sunPreset");
  });

  it("requires perf artifacts and perf cases to be paired", () => {
    expect(validateTreeParityManifestCaptureConfig({
      captures: [{
        id: "missing-case",
        artifacts: { perf: "perf/run/tree-gpu-ring.json" },
      }],
    })).toEqual([{ captureId: "missing-case", message: "perf artifact requires capture.perfCase" }]);
    expect(validateTreeParityManifestCaptureConfig({
      captures: [{
        id: "missing-artifact",
        capture: { perfCase: "tree-gpu-ring" },
      }],
    })).toEqual([{ captureId: "missing-artifact", message: "capture.perfCase requires perf artifact" }]);
  });
});

describe("TREE-12 parity capture command generation", () => {
  it("builds screenshot and perf commands from manifest capture config", () => {
    const commands = buildTreeParityCaptureCommands(manifest(), {
      baseUrl: "http://127.0.0.1:5180/",
      sampleFrames: 10,
      warmupFrames: 5,
      timeoutMs: 60000,
    });

    expect(commands).toHaveLength(1);
    expect(commands[0]?.screenshotCommand).toContain("npm --prefix tools/clod-poc run shoot --");
    expect(commands[0]?.screenshotCommand).toContain("--scene trees-perf");
    expect(commands[0]?.screenshotCommand).toContain("--renderer webgpu");
    expect(commands[0]?.screenshotCommand).toContain("--out shots/low-sun.png");
    expect(commands[0]?.screenshotCommand).toContain("--stats shots/low-sun-stats.json");
    expect(commands[0]?.screenshotCommand).toContain("--treeGpu 1");
    expect(commands[0]?.screenshotCommand).toContain("--sunElevationDeg 8");
    expect(commands[0]?.perfCommand).toContain("npm --prefix tools/clod-poc run perf:main --");
    expect(commands[0]?.perfCommand).toContain("--case tree-gpu-ring");
    expect(commands[0]?.perfCommand).toContain("--out perf/low-sun");
    expect(commands[0]?.perfCommand).toContain("--params treeGpu=1,webgpuSelection=1,freeze=1,sunElevationDeg=8");
  });
});

describe("TREE-12 parity evidence markdown report", () => {
  it("renders a reusable PASS report with artifact and metric values", () => {
    const report = buildTreeParityEvidenceMarkdownReport(validInput(), {
      generatedAt: "2026-06-30T00:00:00.000Z",
    });

    expect(report).toContain("Status: PASS");
    expect(report).toContain("### low-sun-shadows");
    expect(report).toContain("| image | shots/low-sun.png | 128 bytes |");
    expect(report).toContain("| perf.snapshot.counters.treeGpuShadowCasterCountAvg | non-zero | 12 |");
    expect(report).toContain("| perf.snapshot.counters.treeHeroNearTrianglesAvg | >= 100000 | 120000 |");
  });

  it("renders failures for closeout review", () => {
    const report = buildTreeParityEvidenceMarkdownReport(failingInput(), {
      generatedAt: "2026-06-30T00:00:00.000Z",
    });

    expect(report).toContain("Status: FAIL");
    expect(report).toContain("## Failures");
    expect(report).toContain("- low-sun-shadows: image artifact is missing: shots/low-sun.png");
  });
});

function manifest(extraParams: Record<string, string> = {}): TreeParityEvidenceManifest {
  return {
    captures: [{
      id: "low-sun-shadows",
      artifacts: {
        image: "shots/low-sun.png",
        stats: "shots/low-sun-stats.json",
        perf: "perf/low-sun/tree-gpu-ring.json",
      },
      capture: {
        scene: "trees-perf",
        params: {
          treeGpu: "1",
          webgpuSelection: "1",
          freeze: "1",
          sunElevationDeg: "8",
          ...extraParams,
        },
        perfCase: "tree-gpu-ring",
      },
      metrics: [
        { artifact: "stats", path: "ready", equals: true },
        { artifact: "perf", path: "snapshot.counters.treeGpuShadowCasterCountAvg", nonZero: true },
        { artifact: "perf", path: "snapshot.counters.treeHeroNearTrianglesAvg", min: 100_000 },
        { artifact: "perf", path: "snapshot.counters.treeHeroNearFoliageTrianglesAvg", nonZero: true },
      ],
    }],
  };
}

function validInput() {
  return {
    manifest: manifest(),
    fileInfo: fileInfo({
      "shots/low-sun.png": { exists: true, sizeBytes: 128 },
      "shots/low-sun-stats.json": { exists: true, sizeBytes: 256 },
      "perf/low-sun/tree-gpu-ring.json": { exists: true, sizeBytes: 512 },
    }),
    readJson: jsonReader({
      "shots/low-sun-stats.json": { ready: true, error: null },
      "perf/low-sun/tree-gpu-ring.json": {
        snapshot: {
          counters: {
            treeGpuShadowCasterCountAvg: 12,
            treeHeroNearTrianglesAvg: 120_000,
            treeHeroNearFoliageTrianglesAvg: 42_000,
          },
        },
      },
    }),
  };
}

function failingInput() {
  return {
    manifest: manifest(),
    fileInfo: fileInfo({
      "shots/low-sun.png": { exists: false, sizeBytes: 0 },
      "shots/low-sun-stats.json": { exists: true, sizeBytes: 32 },
      "perf/low-sun/tree-gpu-ring.json": { exists: true, sizeBytes: 32 },
    }),
    readJson: jsonReader({
      "shots/low-sun-stats.json": { ready: false, error: null },
      "perf/low-sun/tree-gpu-ring.json": {
        snapshot: {
          counters: {
            treeGpuShadowCasterCountAvg: 0,
            treeHeroNearTrianglesAvg: 20_000,
            treeHeroNearFoliageTrianglesAvg: 0,
          },
        },
      },
    }),
  };
}

function fileInfo(files: Record<string, TreeParityEvidenceFileInfo>) {
  return (path: string) => files[path] ?? { exists: false, sizeBytes: 0 };
}

function jsonReader(files: Record<string, unknown>) {
  return (path: string) => files[path];
}
