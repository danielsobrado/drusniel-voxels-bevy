import type { TreeParityEvidenceFailure } from "./tree_parity_evidence_types.js";

export function getTreeParityEvidencePath(source: unknown, path: string): unknown {
  let current = source;
  for (const segment of path.split(".")) {
    if (!segment) continue;
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function numericTreeParityEvidenceValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function shellArg(value: string): string {
  if (/^[A-Za-z0-9_./:=,@+-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, "\\\"")}"`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function formatManifestFailures(failures: readonly TreeParityEvidenceFailure[]): string {
  return [
    "Invalid tree parity evidence manifest:",
    ...failures.map((failure) => `- ${failure.captureId}: ${failure.message}`),
  ].join("\n");
}
