import type { CameraPoseArgs } from "./water-harness.js";

export interface WaterFoamAcceptancePoses {
  readonly rapid: CameraPoseArgs;
  readonly smoothRiver: CameraPoseArgs;
  readonly lakeShore: CameraPoseArgs;
}

export function extractWaterFoamAcceptancePoses(report: unknown): WaterFoamAcceptancePoses {
  const root = record(report, "foam acceptance report");
  const captures = record(root.captures, "foam acceptance captures");
  return {
    rapid: cameraPose(record(record(captures.rapid, "rapid capture").pose, "rapid pose"), "rapid"),
    smoothRiver: cameraPose(
      record(record(captures.smoothRiver, "smooth river capture").pose, "smooth river pose"),
      "smooth river",
    ),
    lakeShore: cameraPose(
      record(record(captures.lakeShore, "lake shore capture").pose, "lake shore pose"),
      "lake shore",
    ),
  };
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

function cameraPose(input: Record<string, unknown>, label: string): CameraPoseArgs {
  const y = optionalFinite(input.y, `${label} pose y`);
  const yaw = optionalFinite(input.yaw, `${label} pose yaw`);
  const distance = optionalFinite(input.distance, `${label} pose distance`);
  const pitch = optionalFinite(input.pitch, `${label} pose pitch`);
  return {
    x: finite(input.x, `${label} pose x`),
    z: finite(input.z, `${label} pose z`),
    ...(y === undefined ? {} : { y }),
    ...(yaw === undefined ? {} : { yaw }),
    ...(distance === undefined ? {} : { distance }),
    ...(pitch === undefined ? {} : { pitch }),
  };
}

function comparePose(
  label: string,
  expected: CameraPoseArgs,
  actual: CameraPoseArgs,
  epsilon: number,
  failures: string[],
): void {
  compareValue(label, "x", expected.x, actual.x, epsilon, failures);
  compareValue(label, "z", expected.z, actual.z, epsilon, failures);
  compareValue(label, "y", expected.y, actual.y, epsilon, failures);
  compareValue(label, "yaw", expected.yaw, actual.yaw, epsilon, failures);
  compareValue(label, "distance", expected.distance, actual.distance, epsilon, failures);
  compareValue(label, "pitch", expected.pitch, actual.pitch, epsilon, failures);
}

function compareValue(
  label: string,
  key: string,
  expected: number | undefined,
  actual: number | undefined,
  epsilon: number,
  failures: string[],
): void {
  if (expected === undefined && actual === undefined) return;
  if (expected === undefined || actual === undefined) {
    failures.push(`${label}.${key} presence differs`);
    return;
  }
  const delta = Math.abs(expected - actual);
  if (delta > epsilon) failures.push(`${label}.${key} delta ${delta} exceeds ${epsilon}`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

function optionalFinite(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return finite(value, label);
}
