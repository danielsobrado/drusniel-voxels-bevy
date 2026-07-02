import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { QaConfig, QaReport } from "./qaTypes.js";

export function writeReport(report: QaReport, config: QaConfig, outputDir: string): void {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, config.report_json_name ?? "qa-report.json"), JSON.stringify(report, null, 2));
  writeFileSync(resolve(outputDir, config.report_markdown_name ?? "qa-report.md"), renderMarkdown(report));
}

export function renderMarkdown(report: QaReport): string {
  const lines = [
    "# clod-poc QA Report",
    "",
    `Overall status: **${report.overall_status}**`,
    "",
    `- Summary: \`${report.summary_path}\``,
    `- Scene: \`${String(report.bench.scene)}\``,
    "",
    "## Scenes",
    "",
    "| scene | checkpoint | status | screenshots | probes | timing | checks |",
    "|---|---|---|---:|---:|---:|---:|",
  ];
  for (const scene of report.scenes) {
    lines.push(`| ${scene.id} | ${scene.checkpoint} | ${scene.status} | ${scene.screenshots.length} | ${scene.probes.length} | ${scene.timing.length} | ${scene.checks.length} |`);
  }
  if (report.failures.length) {
    lines.push("", "## Failures", "");
    for (const failure of report.failures) lines.push(`- ${failure}`);
  }
  return `${lines.join("\n")}\n`;
}
