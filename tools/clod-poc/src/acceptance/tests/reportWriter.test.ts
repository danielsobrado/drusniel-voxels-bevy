import { describe, expect, it, beforeEach } from "vitest";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createRunId,
  createRunDir,
  overallStatus,
  writeSummaryJson,
  writeMetricsCsv,
  writeSummaryMarkdown,
  buildReport,
  createArtifacts,
  writeAllArtifacts,
  recommendationFromGates,
} from "../reportWriter.js";
import type { AcceptanceGateResult, AcceptanceConfig, AcceptanceMetrics } from "../acceptanceTypes.js";

let tmpRunDir: string;

beforeEach(() => {
  tmpRunDir = join(tmpdir(), `acceptance-test-${Date.now()}`);
  mkdirSync(tmpRunDir, { recursive: true });
  mkdirSync(join(tmpRunDir, "screenshots"), { recursive: true });
  mkdirSync(join(tmpRunDir, "debug"), { recursive: true });
});

function makeGate(id: "A1" | "A2" | "A3" | "A4" | "A5" | "A6", name: string, status: "pass" | "warn" | "fail"): AcceptanceGateResult {
  return {
    id,
    name,
    status,
    message: `${name}: ${status}`,
    measurements: {},
    failures: [],
  };
}

const DEFAULT_CONFIG: AcceptanceConfig = {
  outputDir: "acceptance-runs",
  world: { lod0PagesX: 8, lod0PagesZ: 8, smokeLod0PagesX: 4, smokeLod0PagesZ: 4 },
  thresholds: {
    borderPositionEpsilon: 1e-6,
    borderNormalDotMin: 0.9999,
    borderMaterialWeightDeltaMax: 1e-4,
    lod3TriangleRatioMax: 0.15,
    lowBenefitRateMax: 0.1,
    fullHierarchyBuildMsMax: 8000,
    singleNodeRebuildMsMax: 80,
    densityScarScoreMax: 0.35,
    visualHolePixelRatioMax: 0,
    visualLipPixelRatioMax: 0,
    requireMeasuredSingleNodeRebuild: false,
  },
  visual: { enabled: false, screenshotWidth: 1920, screenshotHeight: 1080, cameraFovYDeg: 60, grazingAngleDeg: 7, crossfadeFrames: 12 },
  stressScenes: { ridgeBorder: true, cliffCorner: true, caveMouthBorder: true, thinBridge: true, forcedNeighborLodDeltas: [1, 2, 3], nearFieldBubbleMask: true },
  logging: { level: "info" },
};

const METRICS: AcceptanceMetrics = {
  lod0Triangles: 100000,
  lod3Triangles: 5000,
  lod3TriangleRatio: 0.05,
  fullHierarchyBuildMs: 4210,
  fullHierarchyBuildMsMin: 4100,
  fullHierarchyBuildMsP50: 4200,
  fullHierarchyBuildMsP95: 4300,
  fullHierarchyBuildRuns: 8,
  singleNodeRebuildMeasured: false,
  singleNodeRebuildMsMin: 10,
  singleNodeRebuildMsP50: 12,
  singleNodeRebuildMsP95: 45,
  lowBenefitRateLevel1: 0.02,
  lowBenefitRateLevel2: 0.03,
  maxBorderPositionDelta: 0.0000005,
  minBorderNormalDot: 0.99995,
  maxBorderMaterialWeightDelta: 0.00001,
  densityScarScore: 0.21,
  visualHolePixelRatio: -1,
  visualLipPixelRatio: -1,
  visualSweepAvailable: false,
  sameLevelEdgesTested: 42,
  sameLevelFailureCount: 0,
  mixedLodDeltasTested: 3,
  mixedLodEdgesTested: 12,
  mixedLodFailureCount: 0,
  mixedLodUntestableDeltaCount: 0,
};

describe("reportWriter", () => {
  it("creates run id", () => {
    const id = createRunId();
    expect(id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
  });

  it("creates run directory structure", () => {
    const runId = createRunId();
    const dir = createRunDir(tmpRunDir, runId);
    expect(existsSync(dir)).toBe(true);
    expect(existsSync(join(dir, "screenshots"))).toBe(true);
    expect(existsSync(join(dir, "debug"))).toBe(true);
  });

  it("overallStatus returns pass when all pass", () => {
    const gates = [makeGate("A1", "test", "pass"), makeGate("A2", "test", "pass")];
    expect(overallStatus(gates)).toBe("pass");
  });

  it("overallStatus returns fail when any fails", () => {
    const gates = [makeGate("A1", "test", "pass"), makeGate("A2", "test", "fail")];
    expect(overallStatus(gates)).toBe("fail");
  });

  it("overallStatus returns warn when no failures but warnings", () => {
    const gates = [makeGate("A1", "test", "pass"), makeGate("A2", "test", "warn")];
    expect(overallStatus(gates)).toBe("warn");
  });

  it("writes summary.json", () => {
    const report = buildReport("test-run", "2025-01-01", "2025-01-01", 100, "config.yaml", [], METRICS, createArtifacts(tmpRunDir));
    const jsonPath = writeSummaryJson(tmpRunDir, report);
    expect(existsSync(jsonPath)).toBe(true);
    const content = JSON.parse(readFileSync(jsonPath, "utf-8"));
    expect(content.schemaVersion).toBe(1);
    expect(content.status).toBe("pass");
  });

  it("writes summary.md with visual sweep honesty", () => {
    const gates = [makeGate("A1", "Watertight", "pass")];
    const report = buildReport("test-run", "2025-01-01", "2025-01-01", 100, "config.yaml", gates, METRICS, createArtifacts(tmpRunDir));
    const mdPath = writeSummaryMarkdown(tmpRunDir, report, DEFAULT_CONFIG);
    expect(existsSync(mdPath)).toBe(true);
    const content = readFileSync(mdPath, "utf-8");
    expect(content).toContain("CLOD Phase 3 Acceptance Report");
    expect(content).toContain("PASS");
    expect(content).toContain("N/A (sweep not available)");
  });

  it("writes metrics.csv with new fields", () => {
    const gates = [makeGate("A1", "Watertight", "pass")];
    const csvPath = writeMetricsCsv(tmpRunDir, METRICS, gates);
    expect(existsSync(csvPath)).toBe(true);
    const content = readFileSync(csvPath, "utf-8");
    expect(content).toContain("lod0Triangles");
    expect(content).toContain("100000");
    expect(content).toContain("mixedLodDeltasTested");
    expect(content).toContain("visualSweepAvailable");
    expect(content).toContain("fullHierarchyBuildRuns");
  });

  it("preserves failed gate details in report", () => {
    const gate = makeGate("A2", "Border", "fail");
    gate.failures.push({
      code: "BORDER_NORMAL_MISMATCH",
      message: "Normal dot 0.5 at vertex 5",
      nodeId: "L2:1,1",
      edge: "east",
      level: 2,
      value: 0.5,
      threshold: 0.9999,
    });

    const report = buildReport("test-run", "2025-01-01", "2025-01-01", 100, "config.yaml", [gate], METRICS, createArtifacts(tmpRunDir));
    expect(report.status).toBe("fail");
    expect(report.gates[0].failures).toHaveLength(1);
  });

  it("recommendation returns correct message for pass", () => {
    const gates = [makeGate("A1", "Watertight", "pass"), makeGate("A2", "Border", "pass")];
    const rec = recommendationFromGates(gates);
    expect(rec).toContain("Phase 3");
  });

  it("recommendation returns do not port for A1 fail", () => {
    const gates = [makeGate("A1", "Watertight", "fail")];
    const rec = recommendationFromGates(gates);
    expect(rec).toContain("Do not port");
    expect(rec).toContain("topology");
  });

  it("writeAllArtifacts produces summary.json with correct artifact list", () => {
    const gates = [makeGate("A1", "Watertight", "pass")];
    const report = buildReport("test-run", "2025-01-01", "2025-01-01", 100, "config.yaml", gates, METRICS, createArtifacts(tmpRunDir));
    const written = writeAllArtifacts(tmpRunDir, report, DEFAULT_CONFIG, ["debug/visual_sweep_unavailable.json"], []);
    expect(written.summaryJson).toBeTruthy();
    expect(written.debugFiles).toContain("debug/visual_sweep_unavailable.json");
    expect(written.screenshots).toEqual([]);

    const jsonContent = JSON.parse(readFileSync(written.summaryJson, "utf-8"));
    expect(Array.isArray(jsonContent.artifacts.debugFiles)).toBe(true);
  });
});
