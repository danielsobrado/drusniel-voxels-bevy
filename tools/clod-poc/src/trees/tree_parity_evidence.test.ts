import { describe, expect, it } from "vitest";
import {
  buildTreeParityCaptureCommands,
  buildTreeParityEvidenceMarkdownReport,
  evaluateTreeParityAcceptanceEvidence,
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

  it("rejects duplicate capture ids and artifact paths", () => {
    const failures = validateTreeParityManifestCaptureConfig({
      captures: [
        {
          id: "same-id",
          artifacts: {
            image: "shots/tree.png",
            stats: "shots/tree-stats.json",
          },
        },
        {
          id: "same-id",
          artifacts: {
            image: "shots/tree.png",
          },
        },
      ],
    });

    expect(failures).toEqual(expect.arrayContaining([
      { captureId: "same-id", message: "duplicate capture id: same-id" },
      { captureId: "same-id", message: "image artifact duplicates same-id.image: shots/tree.png" },
    ]));
  });

  it("rejects empty artifact paths and metric rules without matching artifacts", () => {
    const failures = validateTreeParityManifestCaptureConfig({
      captures: [{
        id: "broken-metric",
        artifacts: { stats: "" },
        metrics: [
          { artifact: "stats", path: "", equals: true },
          { artifact: "perf", path: "snapshot.counters.value", nonZero: true },
        ],
      }],
    });

    expect(failures).toEqual(expect.arrayContaining([
      { captureId: "broken-metric", message: "stats artifact path is required" },
      { captureId: "broken-metric", message: "metric path is required" },
      { captureId: "broken-metric", message: "metric snapshot.counters.value has no perf artifact configured" },
    ]));
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

describe("TREE-11 acceptance evidence bridge", () => {
  it("evaluates acceptance from measured visual and perf artifacts", () => {
    const result = evaluateTreeParityAcceptanceEvidence(acceptanceInput());

    expect(result?.report.status).toBe("pass");
    expect(result?.report.measurements.perfSpeedup).toBeCloseTo(1.5);
  });

  it("adds TREE-11 acceptance results to the markdown report", () => {
    const report = buildTreeParityEvidenceMarkdownReport(acceptanceInput(), {
      generatedAt: "2026-06-30T00:00:00.000Z",
    });

    expect(report).toContain("## TREE-11 acceptance");
    expect(report).toContain("Status: PASS");
    expect(report).toContain("| perfSpeedup | 1.5 |");
  });

  it("fails the report when TREE-11 acceptance fails", () => {
    const report = buildTreeParityEvidenceMarkdownReport(acceptanceInput({ luminanceStdDev: 0.001 }), {
      generatedAt: "2026-06-30T00:00:00.000Z",
    });

    expect(report).toContain("Status: FAIL");
    expect(report).toContain("TREE_IMPOSTOR_FLAT_LIGHTING");
  });

  it("fails evidence validation when TREE-11 acceptance fails", () => {
    const result = validateTreeParityEvidence(acceptanceInput({ luminanceStdDev: 0.001 }));

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.message).join("\n")).toContain("TREE_IMPOSTOR_FLAT_LIGHTING");
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

function acceptanceManifest(): TreeParityEvidenceManifest {
  return {
    ...manifest(),
    acceptance: {
      visualArtifact: "shots/tree-acceptance-visual.json",
      baselinePerfArtifact: "perf/baseline.json",
      impostorPerfArtifact: "perf/impostor.json",
    },
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
      "perf/low-sun/tree-gpu-ring.json": perfJson(12, 120_000, 42_000),
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
      "perf/low-sun/tree-gpu-ring.json": perfJson(0, 20_000, 0),
    }),
  };
}

function acceptanceInput(visualOverrides: Record<string, number> = {}) {
  return {
    manifest: acceptanceManifest(),
    fileInfo: fileInfo({
      "shots/low-sun.png": { exists: true, sizeBytes: 128 },
      "shots/low-sun-stats.json": { exists: true, sizeBytes: 256 },
      "perf/low-sun/tree-gpu-ring.json": { exists: true, sizeBytes: 512 },
      "shots/tree-acceptance-visual.json": { exists: true, sizeBytes: 128 },
      "perf/baseline.json": { exists: true, sizeBytes: 512 },
      "perf/impostor.json": { exists: true, sizeBytes: 512 },
    }),
    readJson: jsonReader({
      "shots/low-sun-stats.json": { ready: true, error: null },
      "perf/low-sun/tree-gpu-ring.json": perfJson(12, 120_000, 42_000),
      "shots/tree-acceptance-visual.json": {
        luminanceMean: 0.5,
        luminanceStdDev: 0.08,
        maxViewBlendDelta: 0.05,
        nearImpostorColorDelta: 0.08,
        boundaryHoleRatio: 0,
        boundaryDoubleDrawRatio: 0,
        ...visualOverrides,
      },
      "perf/baseline.json": framePerfJson(18),
      "perf/impostor.json": framePerfJson(12),
    }),
  };
}

function perfJson(treeGpuShadowCasterCountAvg: number, treeHeroNearTrianglesAvg: number, treeHeroNearFoliageTrianglesAvg: number) {
  return {
    snapshot: {
      counters: {
        treeGpuShadowCasterCountAvg,
        treeHeroNearTrianglesAvg,
        treeHeroNearFoliageTrianglesAvg,
      },
    },
  };
}

function framePerfJson(frameMsP95: number) {
  return { snapshot: { metrics: { frameMs: { p95: frameMsP95 } } } };
}

function fileInfo(files: Record<string, TreeParityEvidenceFileInfo>) {
  return (path: string) => files[path] ?? { exists: false, sizeBytes: 0 };
}

function jsonReader(files: Record<string, unknown>) {
  return (path: string) => files[path];
}
