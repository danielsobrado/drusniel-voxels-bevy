import { describe, expect, it } from "vitest";
import { evaluateP0PerfGates, type P0PerfGateCaseLike } from "./perf-p0-gates.js";

function passedCase(name: string, metrics: Record<string, number | null | undefined> = {}): P0PerfGateCaseLike {
  return { name, status: "passed", metrics };
}

function exerciseDone(): Record<string, number> {
  return {
    "p0DirtyAtlasExercise.enabled": 1,
    "p0DirtyAtlasExercise.status": 3,
    "p0DirtyAtlasExercise.moveM": 768,
    "p0DirtyAtlasExercise.triggeredFrame": 120,
    "p0DirtyAtlasExercise.resetFrame": 138,
    "p0DirtyAtlasExercise.settleRemaining": 0,
  };
}

function validCases(): P0PerfGateCaseLike[] {
  return [
    passedCase("terrain-material-cache-disabled", exerciseDone()),
    passedCase("terrain-material-cache-enabled", {
      ...exerciseDone(),
      terrainMaterialCacheHits: 8,
      terrainMaterialCacheReady: 4,
      terrainMaterialCacheStale: 0,
      "naadf.farSummaryAtlas.memorySavingsPct": 0.72,
      "naadf.farSummaryAtlas.upload.modeCode": 1,
      "naadf.farSummaryAtlas.upload.dirtyUploads": 2,
      "naadf.farSummaryAtlas.upload.dirtyPixels": 4096,
      "naadf.farSummaryAtlas.upload.totalPixels": 65536,
      "naadf.farSummaryAtlas.upload.dirtyPct": 0.0625,
    }),
    passedCase("gpu-early-reject-disabled", exerciseDone()),
    passedCase("gpu-early-reject-enabled", {
      ...exerciseDone(),
      vegetationGpuCandidatesBudgetBeforeReject: 1200,
      vegetationGpuCandidatesBudgetAfterReject: 800,
      vegetationGpuClustersRejectedEarly: 12,
      vegetationGpuSourceFarSummary: 20,
      treeGpuPrefilterSourceFarSummaryAvg: 8,
      grassGpuPrefilterSourceFarSummaryAvg: 6,
      understoryGpuPrefilterSourceFarSummaryAvg: 6,
      vegetationGpuSourceFallback: 1,
    }),
    passedCase("gpu-early-reject-enabled-with-debug-oracle", {
      ...exerciseDone(),
      vegetationGpuSourceFarSummary: 10,
    }),
    passedCase("combined-cache-and-early-reject-enabled", {
      ...exerciseDone(),
      vegetationGpuSourceFarSummary: 10,
    }),
  ];
}

describe("P0 perf gates", () => {
  it("passes when required evidence is present", () => {
    const summary = evaluateP0PerfGates(validCases());

    expect(summary.status).toBe("passed");
    expect(summary.failedCount).toBe(0);
    expect(summary.results.map((result) => result.name)).toEqual([
      "required-cases-present",
      "cases-passed",
      "p0-dirty-atlas-exercise-completed",
      "terrain-material-cache-evidence",
      "vegetation-early-reject-evidence",
      "far-summary-source-evidence",
      "far-summary-atlas-packing-evidence",
      "far-summary-atlas-dirty-upload-evidence",
    ]);
  });

  it("fails when a required case is missing", () => {
    const cases = validCases().filter((perfCase) => perfCase.name !== "combined-cache-and-early-reject-enabled");

    const summary = evaluateP0PerfGates(cases);

    expect(summary.status).toBe("failed");
    expect(summary.results.find((result) => result.name === "required-cases-present")?.status).toBe("failed");
  });

  it("fails when the atlas exercise is skipped", () => {
    const cases = validCases().map((perfCase) => passedCase(perfCase.name, {
      ...perfCase.metrics,
      "p0DirtyAtlasExercise.enabled": 1,
      "p0DirtyAtlasExercise.status": 4,
      "p0DirtyAtlasExercise.moveM": 0,
      "p0DirtyAtlasExercise.triggeredFrame": -1,
      "p0DirtyAtlasExercise.resetFrame": -1,
    }));

    const summary = evaluateP0PerfGates(cases);

    expect(summary.status).toBe("failed");
    expect(summary.results.find((result) => result.name === "p0-dirty-atlas-exercise-completed")?.status).toBe("failed");
  });

  it("fails when early rejection does not reduce candidates or reject clusters", () => {
    const cases = validCases().map((perfCase) => perfCase.name === "gpu-early-reject-enabled"
      ? passedCase(perfCase.name, {
        ...exerciseDone(),
        vegetationGpuCandidatesBudgetBeforeReject: 100,
        vegetationGpuCandidatesBudgetAfterReject: 100,
        vegetationGpuClustersRejectedEarly: 0,
        vegetationGpuSourceFarSummary: 1,
      })
      : perfCase);

    const summary = evaluateP0PerfGates(cases);

    expect(summary.status).toBe("failed");
    expect(summary.results.find((result) => result.name === "vegetation-early-reject-evidence")?.status).toBe("failed");
  });

  it("fails when far-summary source usage is missing", () => {
    const cases = validCases().map((perfCase) => perfCase.name.includes("early-reject") || perfCase.name.includes("combined")
      ? passedCase(perfCase.name, {
        ...perfCase.metrics,
        vegetationGpuSourceFarSummary: 0,
        treeGpuPrefilterSourceFarSummaryAvg: 0,
        grassGpuPrefilterSourceFarSummaryAvg: 0,
        understoryGpuPrefilterSourceFarSummaryAvg: 0,
      })
      : perfCase);

    const summary = evaluateP0PerfGates(cases);

    expect(summary.status).toBe("failed");
    expect(summary.results.find((result) => result.name === "far-summary-source-evidence")?.status).toBe("failed");
  });

  it("fails when partial atlas uploads are missing", () => {
    const cases = validCases().map((perfCase) => passedCase(perfCase.name, {
      ...perfCase.metrics,
      "naadf.farSummaryAtlas.upload.modeCode": 2,
      "naadf.farSummaryAtlas.upload.dirtyUploads": 0,
      "naadf.farSummaryAtlas.upload.dirtyPixels": 0,
      "naadf.farSummaryAtlas.upload.totalPixels": 65536,
      "naadf.farSummaryAtlas.upload.dirtyPct": 0,
    }));

    const summary = evaluateP0PerfGates(cases);

    expect(summary.status).toBe("failed");
    expect(summary.results.find((result) => result.name === "far-summary-atlas-dirty-upload-evidence")?.status).toBe("failed");
  });
});
