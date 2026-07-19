import type { CameraPoseArgs } from "./water-harness.js";

export interface WaterFoamAcceptancePoses {
  readonly rapid: CameraPoseArgs;
  readonly smoothRiver: CameraPoseArgs;
  readonly lakeShore: CameraPoseArgs;
}

const REQUIRED_POSE_KEYS = ["x", "z"] as const;
const OPTIONAL_POSE_KEYS = ["yaw", "y", "distance", "pitch"] as const;

export function extractWaterFoamAcceptancePoses(report: unknown): WaterFoamAcceptancePoses {
  const root = record(report, "foam acceptance report");
  const captures = record(root.captures, "foam acceptance captures");
  return {
    rapid: normalizePose(record(record(captures.rapid, "rapid capture").pose, "rapid pose"), "rapid"),
    smoothRiver: normalizePose(
      record(record(captures.smoothRiver, "smooth river capture").pose, "smooth river pose"),
      "smooth river",
    ),
    lakeShore: normalizePose(
      record(record(captures.lakeShore, "lake shore capture").pose, "lake shore pose"),
      "lake shore",
    ),
  };
}

export function waterFoamAcceptancePosesMatch(
  expected: WaterFoamAcceptancePoses,
  actual: WaterFoamAcceptancePoses,
  epsilon = 1e-9,
): boolean {
  return poseMatches(expected.rapid, actual.rapid, epsilon)
    && poseMatches(expected.smoothRiver, actual.smoothRiver, epsilon)
    && poseMatches(expected.lakeShore, actual.lakeShore, epsilon);
}

export function assertWaterFoamAcceptancePosesMatch(
  expected: WaterFoamAcceptancePoses,
  actual: WaterFoamAcceptancePoses,
  epsilon = 1e-9,
): void {
  const failures: string[] = [];
  comparePose("rapid", expected.rapid, actual.rapid, epsilon, failures);
  comparePose("smooth river", expected.smoothRiver, actual.smoothRiver, epsilon, failures);
  comparePose("lake shore", expected.lakeShore, actual.lakeShore, epsilon, failures);
  if (failures.length > 0) {
    throw new Error(`water foam acceptance pose drift:\n- ${failures.join("\n- ")}`);
  }
}

function normalizePose(input: Record<string, unknown>, label: string): CameraPoseArgs {
  const pose: CameraPoseArgs = {
    x: finite(input.x, `${label} pose x`),
    z: finite(input.z, `${label} pose z`),
  };
  for (const key of OPTIONAL_POSE_KEYS) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    pose[key] = finite(value, `${label} pose ${key}`);
  }
  return pose;
}

function poseMatches(expected: CameraPoseArgs, actual: CameraPoseArgs, epsilon: number): boolean {
  for (const key of REQUIRED_POSE_KEYS) {
    if (Math.abs(expected[key] - actual[key]) > epsilon) return false;
  }
  for (const key of OPTIONAL_POSE_KEYS) {
    const expectedValue = expected[key];
    const actualValue = actual[key];
    if (expectedValue === undefined && actualValue === undefined) continue;
    if (expectedValue === undefined || actualValue === undefined) return false;
    if (Math.abs(expectedValue - actualValue) > epsilon) return false;
  }
  return true;
}

function comparePose(
  label: string,
  expected: CameraPoseArgs,
  actual: CameraPoseArgs,
  epsilon: number,
  failures: string[],
): void {
  for (const key of [...REQUIRED_POSE_KEYS, ...OPTIONAL_POSE_KEYS] as const) {
    const expectedValue = expected[key];
    const actualValue = actual[key];
    if (expectedValue === undefined && actualValue === undefined) continue;
    if (expectedValue === undefined || actualValue === undefined) {
      failures.push(`${label}.${key} presence differs`);
      continue;
    }
    const delta = Math.abs(expectedValue - actualValue);
    if (delta > epsilon) failures.push(`${label}.${key} delta ${delta} exceeds ${epsilon}`);
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be finite`);
  }
  return value;
}
