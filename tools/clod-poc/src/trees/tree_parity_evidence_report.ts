import { validateTreeParityEvidence } from "./tree_parity_evidence_validator.js";
import {
  errorMessage,
  getTreeParityEvidencePath,
} from "./tree_parity_evidence_utils.js";
import type {
  TreeParityEvidenceArtifact,
  TreeParityEvidenceCapture,
  TreeParityEvidenceFileInfo,
  TreeParityEvidenceInput,
  TreeParityEvidenceMetricRule,
  TreeParityEvidenceReportOptions,
} from "./tree_parity_evidence_types.js";

export function buildTreeParityEvidenceMarkdownReport(
  input: TreeParityEvidenceInput,
  options: TreeParityEvidenceReportOptions = {},
): string {
  const result = validateTreeParityEvidence(input);
  const lines = [
    `# ${options.title ?? "clod-poc tree parity evidence"}`,
    "",
    `Generated: ${options.generatedAt ?? new Date().toISOString()}`,
    `Status: ${result.ok ? "PASS" : "FAIL"}`,
    `Captures: ${input.manifest.captures.length}`,
    "",
    "## Captures",
    "",
  ];

  for (const capture of input.manifest.captures) {
    lines.push(`### ${capture.id}`, "");
    if (capture.description) lines.push(capture.description, "");
    lines.push("| artifact | path | status |", "| --- | --- | --- |");
    for (const [artifact, path] of Object.entries(capture.artifacts ?? {}) as [TreeParityEvidenceArtifact, string][]) {
      const info = input.fileInfo(path);
      lines.push(`| ${artifact} | ${path} | ${artifactStatus(info)} |`);
    }
    lines.push("", "| metric | expected | actual |", "| --- | --- | ---: |");
    for (const rule of capture.metrics ?? []) {
      lines.push(metricReportRow(capture, rule, input));
    }
    lines.push("");
  }

  if (result.failures.length > 0) {
    lines.push("## Failures", "");
    for (const failure of result.failures) lines.push(`- ${failure.captureId}: ${failure.message}`);
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function metricReportRow(
  capture: TreeParityEvidenceCapture,
  rule: TreeParityEvidenceMetricRule,
  input: TreeParityEvidenceInput,
): string {
  const path = capture.artifacts?.[rule.artifact];
  if (!path) return `| ${rule.artifact}.${rule.path} | ${metricExpectation(rule)} | missing ${rule.artifact} artifact |`;
  try {
    const source = input.readJson(path);
    const value = getTreeParityEvidencePath(source, rule.path);
    return `| ${rule.artifact}.${rule.path} | ${metricExpectation(rule)} | ${formatMetricValue(value)} |`;
  } catch (error) {
    return `| ${rule.artifact}.${rule.path} | ${metricExpectation(rule)} | ${errorMessage(error)} |`;
  }
}

function artifactStatus(info: TreeParityEvidenceFileInfo): string {
  if (!info.exists) return "missing";
  if (info.sizeBytes <= 0) return "empty";
  return `${info.sizeBytes} bytes`;
}

function metricExpectation(rule: TreeParityEvidenceMetricRule): string {
  const parts: string[] = [];
  if (rule.equals !== undefined) parts.push(`= ${String(rule.equals)}`);
  if (rule.nonZero) parts.push("non-zero");
  if (rule.min !== undefined) parts.push(`>= ${rule.min}`);
  if (rule.max !== undefined) parts.push(`<= ${rule.max}`);
  if (rule.present === false) parts.push("absent");
  return parts.length > 0 ? parts.join(", ") : "present";
}

function formatMetricValue(value: unknown): string {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
