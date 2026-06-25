import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AcceptanceRunReport,
  AcceptanceStatus,
  AcceptanceMetrics,
  AcceptanceGateResult,
  AcceptanceArtifacts,
  AcceptanceConfig,
} from "./acceptanceTypes.js";
import type { Logger } from "./acceptanceTypes.js";

export function createRunId(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}-${min}-${s}`;
}

export function createRunDir(outputDir: string, runId: string): string {
  const dir = join(outputDir, runId);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "screenshots"), { recursive: true });
  mkdirSync(join(dir, "debug"), { recursive: true });
  return dir;
}

export function overallStatus(gates: AcceptanceGateResult[]): AcceptanceStatus {
  for (const g of gates) {
    if (g.status === "fail") return "fail";
  }
  for (const g of gates) {
    if (g.status === "warn") return "warn";
  }
  return "pass";
}

export function writeSummaryJson(runDir: string, report: AcceptanceRunReport): string {
  const path = join(runDir, "summary.json");
  writeFileSync(path, JSON.stringify(report, null, 2), "utf-8");
  return path;
}

export function writeMetricsCsv(runDir: string, metrics: AcceptanceMetrics, gates: AcceptanceGateResult[]): string {
  const path = join(runDir, "metrics.csv");
  const lines: string[] = [];
  const entries: { key: keyof AcceptanceMetrics; label: string; thresholdKey?: string; gate?: string }[] = [
    { key: "lod0Triangles", label: "lod0Triangles" },
    { key: "lod3Triangles", label: "lod3Triangles" },
    { key: "lod3TriangleRatio", label: "lod3TriangleRatio", gate: "A4" },
    { key: "fullHierarchyBuildMs", label: "fullHierarchyBuildMs", gate: "A5" },
    { key: "singleNodeRebuildP50Ms", label: "singleNodeRebuildP50Ms", gate: "A5" },
    { key: "singleNodeRebuildP95Ms", label: "singleNodeRebuildP95Ms", gate: "A5" },
    { key: "lowBenefitRateLevel1", label: "lowBenefitRateLevel1", gate: "A6" },
    { key: "lowBenefitRateLevel2", label: "lowBenefitRateLevel2", gate: "A6" },
    { key: "maxBorderPositionDelta", label: "maxBorderPositionDelta", gate: "A2" },
    { key: "minBorderNormalDot", label: "minBorderNormalDot", gate: "A2" },
    { key: "maxBorderMaterialWeightDelta", label: "maxBorderMaterialWeightDelta", gate: "A2" },
    { key: "densityScarScore", label: "densityScarScore", gate: "A3" },
    { key: "visualHolePixelRatio", label: "visualHolePixelRatio", gate: "A1" },
    { key: "visualLipPixelRatio", label: "visualLipPixelRatio", gate: "A1" },
  ];

  lines.push("metric,value,threshold,gate");
  for (const e of entries) {
    const value = metrics[e.key];
    let threshold = "";
    if (e.gate) {
      const gate = gates.find((g) => g.id === e.gate);
      if (gate && typeof gate.measurements[`${e.key}_threshold`] === "number") {
        threshold = String(gate.measurements[`${e.key}_threshold`]);
      }
    }
    lines.push(`${e.label},${value},${threshold},${e.gate ?? ""}`);
  }

  writeFileSync(path, lines.join("\n"), "utf-8");
  return path;
}

export function recommendationFromGates(gates: AcceptanceGateResult[]): string {
  for (const g of gates) {
    if (g.id === "A1" && g.status === "fail") {
      return "Do not port. Fix builder topology/border chain first.";
    }
  }
  for (const g of gates) {
    if (g.id === "A2" && g.status === "fail") {
      return "Do not port. Fix dirty input, normal mismatch, or material weight propagation.";
    }
  }
  for (const g of gates) {
    if (g.id === "A3" && g.status === "fail") {
      return "Try 8x8 chunks per page and rerun before rejecting approach.";
    }
  }
  for (const g of gates) {
    if (g.id === "A4" && g.status === "fail") {
      const a1a2a3Pass = gates
        .filter((x) => x.id === "A1" || x.id === "A2" || x.id === "A3")
        .every((x) => x.status !== "fail");
      if (a1a2a3Pass) {
        return "Tune simplify target ratio, target error, and attribute weights. Do not use simplify_sloppy.";
      }
    }
  }
  for (const g of gates) {
    if (g.id === "A5" && g.status === "fail") {
      return "Profile weld/simplify/validation. Keep work async. Do not port until rebuild cost is plausible.";
    }
  }
  for (const g of gates) {
    if (g.id === "A6" && g.status === "fail") {
      return "Locked-border density is too high. Try larger page size.";
    }
  }
  const allPass = gates.every((g) => g.status === "pass");
  if (allPass) {
    return "Phase 3 passed. Rust offline builder port is allowed.";
  }
  return "Review warnings and address before porting.";
}

export function writeSummaryMarkdown(runDir: string, report: AcceptanceRunReport, config: AcceptanceConfig): string {
  const path = join(runDir, "summary.md");
  const lines: string[] = [];

  lines.push("# CLOD Phase 3 Acceptance Report");
  lines.push("");
  lines.push(`**Result:** ${report.status.toUpperCase()}`);
  lines.push("");
  lines.push(`Run ID: ${report.runId}`);
  lines.push(`Started: ${report.startedAtIso}`);
  lines.push(`Finished: ${report.finishedAtIso}`);
  lines.push(`Duration: ${report.durationMs.toFixed(1)} ms`);
  if (report.gitCommit) lines.push(`Git commit: ${report.gitCommit}`);
  lines.push(`Config: ${report.configPath}`);
  lines.push("");

  lines.push("## Gates");
  lines.push("");
  lines.push("| Gate | Status | Summary |");
  lines.push("|---|---|---|");
  for (const g of report.gates) {
    const statusIcon = g.status === "pass" ? "PASS" : g.status === "warn" ? "WARN" : "FAIL";
    lines.push(`| ${g.id} ${g.name} | ${statusIcon} | ${g.message} |`);
  }
  lines.push("");

  lines.push("## Key Metrics");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---|");
  lines.push(`| LOD0 triangles | ${report.metrics.lod0Triangles} |`);
  lines.push(`| LOD3 triangles | ${report.metrics.lod3Triangles} |`);
  lines.push(`| LOD3 triangle ratio | ${report.metrics.lod3TriangleRatio.toFixed(4)} |`);
  lines.push(`| Full hierarchy build (ms) | ${report.metrics.fullHierarchyBuildMs.toFixed(1)} |`);
  lines.push(`| Single node rebuild p50 (ms) | ${report.metrics.singleNodeRebuildP50Ms.toFixed(1)} |`);
  lines.push(`| Single node rebuild p95 (ms) | ${report.metrics.singleNodeRebuildP95Ms.toFixed(1)} |`);
  lines.push(`| Low-benefit rate L1 | ${(report.metrics.lowBenefitRateLevel1 * 100).toFixed(1)}% |`);
  lines.push(`| Low-benefit rate L2 | ${(report.metrics.lowBenefitRateLevel2 * 100).toFixed(1)}% |`);
  lines.push(`| Max border position delta | ${report.metrics.maxBorderPositionDelta.toExponential(2)} |`);
  lines.push(`| Min border normal dot | ${report.metrics.minBorderNormalDot.toFixed(6)} |`);
  lines.push(`| Max border material weight delta | ${report.metrics.maxBorderMaterialWeightDelta.toExponential(2)} |`);
  lines.push(`| Density scar score | ${report.metrics.densityScarScore.toFixed(4)} |`);
  lines.push(`| Visual hole pixel ratio | ${report.metrics.visualHolePixelRatio.toFixed(6)} |`);
  lines.push(`| Visual lip pixel ratio | ${report.metrics.visualLipPixelRatio.toFixed(6)} |`);
  lines.push("");

  const failed = report.gates.filter((g) => g.failures.length > 0);
  if (failed.length > 0) {
    lines.push("## Failures");
    lines.push("");
    for (const g of failed) {
      lines.push(`### ${g.id} ${g.name}`);
      lines.push("");
      lines.push(`Status: ${g.status}`);
      lines.push(`Message: ${g.message}`);
      lines.push("");
      if (g.failures.length > 0) {
        lines.push("| Code | Message | Scene | Node | Level |");
        lines.push("|---|---|---|---|---|");
        const top = g.failures.slice(0, 20);
        for (const f of top) {
          lines.push(`| ${f.code} | ${f.message.replace(/\|/g, "\\|")} | ${f.scene ?? ""} | ${f.nodeId ?? ""} | ${f.level ?? ""} |`);
        }
      }
      lines.push("");
    }
  }

  lines.push("## Recommendation");
  lines.push("");
  lines.push(recommendationFromGates(report.gates));
  lines.push("");

  writeFileSync(path, lines.join("\n"), "utf-8");
  return path;
}

export function buildReport(
  runId: string,
  startedAtIso: string,
  finishedAtIso: string,
  durationMs: number,
  configPath: string,
  gates: AcceptanceGateResult[],
  metrics: AcceptanceMetrics,
  artifacts: AcceptanceArtifacts,
  gitCommit?: string,
): AcceptanceRunReport {
  return {
    schemaVersion: 1,
    runId,
    startedAtIso,
    finishedAtIso,
    durationMs,
    gitCommit,
    configPath,
    status: overallStatus(gates),
    gates,
    metrics,
    artifacts,
  };
}

export function createArtifacts(runDir: string): AcceptanceArtifacts {
  return {
    summaryJson: join(runDir, "summary.json"),
    summaryMarkdown: join(runDir, "summary.md"),
    metricsCsv: join(runDir, "metrics.csv"),
    screenshots: [],
    debugFiles: [],
  };
}

export function writeAllArtifacts(
  runDir: string,
  report: AcceptanceRunReport,
  config: AcceptanceConfig,
): AcceptanceArtifacts {
  const jsonPath = writeSummaryJson(runDir, report);
  const mdPath = writeSummaryMarkdown(runDir, report, config);
  const csvPath = writeMetricsCsv(runDir, report.metrics, report.gates);
  return {
    summaryJson: jsonPath,
    summaryMarkdown: mdPath,
    metricsCsv: csvPath,
    screenshots: [],
    debugFiles: [],
  };
}
