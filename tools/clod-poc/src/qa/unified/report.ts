import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CounterGateResult, InformationalMetricResult } from "./counters.js";
import type { RegionProbeResult } from "./region_probes.js";
import type { TimingGateResult } from "./timing.js";

export type UnifiedStatus = "PASS" | "FAIL" | "BASELINE_MISSING" | "NOT_APPLICABLE" | "NON_AUTHORITATIVE" | "ERROR";

export interface UnifiedSceneReport {
  id: string;
  target: string;
  status: UnifiedStatus;
  reproductionCommand: string;
  failures: string[];
  timing: TimingGateResult[];
  counters: CounterGateResult[];
  informational: InformationalMetricResult[];
  regions: RegionProbeResult[];
  image?: Record<string, number | string | boolean | null>;
}

export interface UnifiedQaReport {
  schema_version: 1;
  status: UnifiedStatus;
  generated_utc: string;
  authoritative: boolean;
  manifest_paths: string[];
  summary_path: string;
  scenes: UnifiedSceneReport[];
  failures: string[];
}

export function writeUnifiedReports(report: UnifiedQaReport, outputDir: string): void {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(outputDir, "report.md"), markdown(report));
  writeFileSync(join(outputDir, "report.html"), html(report));
  writeFileSync(join(outputDir, "junit.xml"), junit(report));
}

function markdown(report: UnifiedQaReport): string {
  const lines = [
    "# Unified QA Report", "", `Status: **${report.status}**`, `Authoritative: **${report.authoritative}**`, "",
    "| Scene | Target | Status | Failures |", "|---|---|---|---|",
    ...report.scenes.map((scene) => `| ${scene.id} | ${scene.target} | ${scene.status} | ${escapeMd(scene.failures.join("; "))} |`),
  ];
  for (const scene of report.scenes) {
    lines.push("", `## ${scene.id}`, "", `Reproduce: \`${scene.reproductionCommand}\``);
    if (scene.failures.length) lines.push("", ...scene.failures.map((failure) => `- ${failure}`));
  }
  return `${lines.join("\n")}\n`;
}

function html(report: UnifiedQaReport): string {
  const rows = report.scenes.map((scene) => `<tr><td>${escapeHtml(scene.id)}</td><td>${escapeHtml(scene.target)}</td><td>${scene.status}</td><td>${escapeHtml(scene.failures.join("; "))}</td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Unified QA</title><style>body{font:14px system-ui;margin:2rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:.5rem;text-align:left}.FAIL,.ERROR{font-weight:700}</style></head><body><h1>Unified QA Report</h1><p>Status: <strong class="${report.status}">${report.status}</strong></p><p>Authoritative: ${report.authoritative}</p><table><thead><tr><th>Scene</th><th>Target</th><th>Status</th><th>Failures</th></tr></thead><tbody>${rows}</tbody></table></body></html>\n`;
}

function junit(report: UnifiedQaReport): string {
  const failures = report.scenes.filter((scene) => scene.status === "FAIL" || scene.status === "ERROR").length;
  const cases = report.scenes.map((scene) => {
    const failure = scene.failures.length ? `<failure message="${escapeXml(scene.failures.join("; "))}"/>` : "";
    const skipped = scene.status === "NOT_APPLICABLE" || scene.status === "BASELINE_MISSING" || scene.status === "NON_AUTHORITATIVE" ? `<skipped message="${scene.status}"/>` : "";
    return `<testcase classname="unified-qa" name="${escapeXml(scene.id)}">${failure}${skipped}</testcase>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><testsuite name="unified-qa" tests="${report.scenes.length}" failures="${failures}">${cases}</testsuite>\n`;
}
function escapeMd(value: string): string { return value.replaceAll("|", "\\|").replaceAll("\n", " "); }
function escapeHtml(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function escapeXml(value: string): string { return escapeHtml(value).replaceAll("'", "&apos;"); }
