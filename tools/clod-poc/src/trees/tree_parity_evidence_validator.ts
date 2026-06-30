import { validateTreeParityManifestCaptureConfig } from "./tree_parity_evidence_manifest.js";
import {
  errorMessage,
  getTreeParityEvidencePath,
  numericTreeParityEvidenceValue,
} from "./tree_parity_evidence_utils.js";
import type {
  TreeParityEvidenceArtifact,
  TreeParityEvidenceCapture,
  TreeParityEvidenceFailure,
  TreeParityEvidenceInput,
  TreeParityEvidenceMetricRule,
  TreeParityEvidenceResult,
} from "./tree_parity_evidence_types.js";

export function validateTreeParityEvidence(input: TreeParityEvidenceInput): TreeParityEvidenceResult {
  const failures: TreeParityEvidenceFailure[] = validateTreeParityManifestCaptureConfig(input.manifest);
  for (const capture of input.manifest.captures) {
    validateCaptureFiles(capture, input, failures);
    validateCaptureMetrics(capture, input, failures);
  }
  return { ok: failures.length === 0, failures };
}

function validateCaptureFiles(
  capture: TreeParityEvidenceCapture,
  input: TreeParityEvidenceInput,
  failures: TreeParityEvidenceFailure[],
): void {
  for (const [artifact, path] of Object.entries(capture.artifacts ?? {}) as [TreeParityEvidenceArtifact, string][]) {
    if (!path) continue;
    const info = input.fileInfo(path);
    if (!info.exists) {
      failures.push({ captureId: capture.id, message: `${artifact} artifact is missing: ${path}` });
      continue;
    }
    if (info.sizeBytes <= 0) failures.push({ captureId: capture.id, message: `${artifact} artifact is empty: ${path}` });
  }
}

function validateCaptureMetrics(
  capture: TreeParityEvidenceCapture,
  input: TreeParityEvidenceInput,
  failures: TreeParityEvidenceFailure[],
): void {
  const jsonCache: Partial<Record<"stats" | "perf", unknown>> = {};
  for (const rule of capture.metrics ?? []) {
    const path = capture.artifacts?.[rule.artifact];
    if (!path) {
      failures.push({ captureId: capture.id, message: `metric ${rule.path} has no ${rule.artifact} artifact configured` });
      continue;
    }
    try {
      jsonCache[rule.artifact] ??= input.readJson(path);
    } catch (error) {
      failures.push({ captureId: capture.id, message: `cannot read ${rule.artifact} JSON ${path}: ${errorMessage(error)}` });
      continue;
    }
    const value = getTreeParityEvidencePath(jsonCache[rule.artifact], rule.path);
    validateMetricRule(capture.id, rule, value, failures);
  }
}

function validateMetricRule(
  captureId: string,
  rule: TreeParityEvidenceMetricRule,
  value: unknown,
  failures: TreeParityEvidenceFailure[],
): void {
  if (rule.present !== false && value === undefined) {
    failures.push({ captureId, message: `${rule.artifact}.${rule.path} is missing` });
    return;
  }
  if (rule.present === false) return;
  if (rule.equals !== undefined && value !== rule.equals) {
    failures.push({ captureId, message: `${rule.artifact}.${rule.path} expected ${String(rule.equals)}, got ${String(value)}` });
  }
  if (rule.nonZero && numericTreeParityEvidenceValue(value) === 0) {
    failures.push({ captureId, message: `${rule.artifact}.${rule.path} expected non-zero, got ${String(value)}` });
  }
  if (rule.min !== undefined && numericTreeParityEvidenceValue(value) < rule.min) {
    failures.push({ captureId, message: `${rule.artifact}.${rule.path} expected >= ${rule.min}, got ${String(value)}` });
  }
  if (rule.max !== undefined && numericTreeParityEvidenceValue(value) > rule.max) {
    failures.push({ captureId, message: `${rule.artifact}.${rule.path} expected <= ${rule.max}, got ${String(value)}` });
  }
}
