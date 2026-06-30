export type TreeParityEvidenceArtifact = "image" | "stats" | "perf" | "notes";

export interface TreeParityEvidenceArtifactSet {
  image?: string;
  stats?: string;
  perf?: string;
  notes?: string;
}

export interface TreeParityEvidenceMetricRule {
  artifact: "stats" | "perf";
  path: string;
  min?: number;
  max?: number;
  equals?: number | string | boolean | null;
  present?: boolean;
  nonZero?: boolean;
}

export interface TreeParityEvidenceCapture {
  id: string;
  description?: string;
  artifacts?: TreeParityEvidenceArtifactSet;
  metrics?: TreeParityEvidenceMetricRule[];
}

export interface TreeParityEvidenceManifest {
  captures: TreeParityEvidenceCapture[];
}

export interface TreeParityEvidenceFileInfo {
  exists: boolean;
  sizeBytes: number;
}

export interface TreeParityEvidenceInput {
  manifest: TreeParityEvidenceManifest;
  fileInfo(path: string): TreeParityEvidenceFileInfo;
  readJson(path: string): unknown;
}

export interface TreeParityEvidenceFailure {
  captureId: string;
  message: string;
}

export interface TreeParityEvidenceResult {
  ok: boolean;
  failures: TreeParityEvidenceFailure[];
}

export function validateTreeParityEvidence(input: TreeParityEvidenceInput): TreeParityEvidenceResult {
  const failures: TreeParityEvidenceFailure[] = [];
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
    const value = getPath(jsonCache[rule.artifact], rule.path);
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
  if (rule.nonZero && numericValue(value) === 0) {
    failures.push({ captureId, message: `${rule.artifact}.${rule.path} expected non-zero, got ${String(value)}` });
  }
  if (rule.min !== undefined && numericValue(value) < rule.min) {
    failures.push({ captureId, message: `${rule.artifact}.${rule.path} expected >= ${rule.min}, got ${String(value)}` });
  }
  if (rule.max !== undefined && numericValue(value) > rule.max) {
    failures.push({ captureId, message: `${rule.artifact}.${rule.path} expected <= ${rule.max}, got ${String(value)}` });
  }
}

function getPath(source: unknown, path: string): unknown {
  let current = source;
  for (const segment of path.split(".")) {
    if (!segment) continue;
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function numericValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
