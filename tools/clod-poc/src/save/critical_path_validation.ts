import type { CriticalPathStatus, SavedCriticalPath, WorldMetadataRecord } from "./save_schema.js";

export type CriticalPathValidationSeverity = "error" | "warning";
export type CriticalPathValidationCode =
  | "empty_points"
  | "missing_road"
  | "missing_prop"
  | "missing_cave_entrance"
  | "missing_cave_system"
  | "status_warning"
  | "status_blocked"
  | "status_dirty";

export interface CriticalPathValidationIssue {
  severity: CriticalPathValidationSeverity;
  code: CriticalPathValidationCode;
  criticalPathId: string;
  message: string;
}

export interface CriticalPathValidationResult {
  errors: CriticalPathValidationIssue[];
  warnings: CriticalPathValidationIssue[];
  touchedCriticalPathIds: string[];
  durationMs: number;
}

export interface CriticalPathValidationOptions {
  propIds?: ReadonlySet<string>;
  nowMs?: () => number;
  blockWarnings?: boolean;
}

function defaultNowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function issue(
  severity: CriticalPathValidationSeverity,
  code: CriticalPathValidationCode,
  path: SavedCriticalPath,
  message: string,
): CriticalPathValidationIssue {
  return { severity, code, criticalPathId: path.id, message };
}

function statusWarningCode(status: CriticalPathStatus): CriticalPathValidationCode | null {
  if (status === "warning") return "status_warning";
  if (status === "blocked") return "status_blocked";
  if (status === "dirty") return "status_dirty";
  return null;
}

function sortIssues(a: CriticalPathValidationIssue, b: CriticalPathValidationIssue): number {
  return a.criticalPathId.localeCompare(b.criticalPathId)
    || a.code.localeCompare(b.code)
    || a.message.localeCompare(b.message);
}

export function validateCriticalPaths(
  metadata: WorldMetadataRecord,
  options: CriticalPathValidationOptions = {},
): CriticalPathValidationResult {
  const now = options.nowMs ?? defaultNowMs;
  const startedAt = now();
  const roadIds = new Set(metadata.roads.map((road) => road.id));
  const propIds = options.propIds ?? new Set<string>();
  const caveEntranceIds = new Set(metadata.caveEntrances.map((entrance) => entrance.id));
  const caveSystemIds = new Set(metadata.caveSystems.map((system) => system.id));
  const errors: CriticalPathValidationIssue[] = [];
  const warnings: CriticalPathValidationIssue[] = [];

  for (const path of metadata.criticalPaths) {
    if (path.points.length === 0) {
      errors.push(issue("error", "empty_points", path, `critical path ${path.id} has no points`));
    }
    for (const roadId of path.linkedRoadIds) {
      if (!roadIds.has(roadId)) errors.push(issue("error", "missing_road", path, `critical path ${path.id} links missing road ${roadId}`));
    }
    for (const propId of path.linkedPropIds) {
      if (!propIds.has(propId)) errors.push(issue("error", "missing_prop", path, `critical path ${path.id} links missing prop ${propId}`));
    }
    const statusCode = statusWarningCode(path.status);
    if (statusCode) warnings.push(issue("warning", statusCode, path, `critical path ${path.id} status is ${path.status}`));
  }

  const pathIds = new Set(metadata.criticalPaths.map((path) => path.id));
  for (const entrance of metadata.caveEntrances) {
    if (!caveSystemIds.has(entrance.caveSystemId)) {
      const path = entrance.linkedCriticalPathId ? metadata.criticalPaths.find((candidate) => candidate.id === entrance.linkedCriticalPathId) : null;
      if (path) errors.push(issue("error", "missing_cave_system", path, `cave entrance ${entrance.id} links missing cave system ${entrance.caveSystemId}`));
    }
    if (entrance.linkedCriticalPathId && !pathIds.has(entrance.linkedCriticalPathId)) {
      errors.push({
        severity: "error",
        code: "missing_cave_entrance",
        criticalPathId: entrance.linkedCriticalPathId,
        message: `cave entrance ${entrance.id} links missing critical path ${entrance.linkedCriticalPathId}`,
      });
    }
  }

  for (const system of metadata.caveSystems) {
    for (const entranceId of system.entranceIds) {
      if (caveEntranceIds.has(entranceId)) continue;
      for (const pathId of system.criticalPathIds) {
        errors.push({
          severity: "error",
          code: "missing_cave_entrance",
          criticalPathId: pathId,
          message: `cave system ${system.id} links missing entrance ${entranceId}`,
        });
      }
    }
    for (const pathId of system.criticalPathIds) {
      if (pathIds.has(pathId)) continue;
      errors.push({
        severity: "error",
        code: "missing_cave_system",
        criticalPathId: pathId,
        message: `cave system ${system.id} links missing critical path ${pathId}`,
      });
    }
  }

  errors.sort(sortIssues);
  warnings.sort(sortIssues);
  const touchedCriticalPathIds = [...new Set([
    ...metadata.criticalPaths.map((path) => path.id),
    ...errors.map((entry) => entry.criticalPathId),
    ...warnings.map((entry) => entry.criticalPathId),
  ])].sort();

  return {
    errors,
    warnings,
    touchedCriticalPathIds,
    durationMs: Math.max(0, now() - startedAt),
  };
}

export function assertCriticalPathValidation(result: CriticalPathValidationResult, options: Pick<CriticalPathValidationOptions, "blockWarnings"> = {}): void {
  if (result.errors.length > 0) throw new Error(result.errors.map((entry) => entry.message).join("; "));
  if (options.blockWarnings && result.warnings.length > 0) throw new Error(result.warnings.map((entry) => entry.message).join("; "));
}

