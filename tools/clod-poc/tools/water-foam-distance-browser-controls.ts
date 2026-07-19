import type { CdpPage } from "./water-harness.js";

export interface WaterFoamDistanceOverrideState {
  readonly enabled: boolean;
  readonly distanceM: number;
}

export interface WaterFoamTimeFreezeState {
  readonly frozen: boolean;
}

export interface WaterFoamDistanceResetState {
  readonly distance: WaterFoamDistanceOverrideState;
  readonly time: WaterFoamTimeFreezeState;
}

export async function setWaterFoamDistanceOverride(
  page: CdpPage,
  distanceM: number | null,
): Promise<WaterFoamDistanceOverrideState> {
  const state = await page.evaluate<WaterFoamDistanceOverrideState>(
    `window.setWaterFoamDistanceOverrideM(${distanceM === null ? "null" : JSON.stringify(distanceM)})`,
  );
  if (!state || typeof state.enabled !== "boolean" || !Number.isFinite(state.distanceM)) {
    throw new Error("foam distance override returned an invalid state");
  }
  return state;
}

export async function setWaterFoamTimeFrozen(
  page: CdpPage,
  frozen: boolean,
): Promise<WaterFoamTimeFreezeState> {
  const state = await page.evaluate<WaterFoamTimeFreezeState>(
    `window.setWaterFoamTimeFrozen(${JSON.stringify(frozen)})`,
  );
  if (!state || typeof state.frozen !== "boolean") {
    throw new Error("foam time freeze returned an invalid state");
  }
  return state;
}

export async function resetWaterFoamDistanceControls(
  page: CdpPage,
): Promise<WaterFoamDistanceResetState> {
  let distance: WaterFoamDistanceOverrideState | null = null;
  let time: WaterFoamTimeFreezeState | null = null;
  const failures: string[] = [];

  try {
    distance = await setWaterFoamDistanceOverride(page, null);
  } catch (error) {
    failures.push(`distance reset: ${message(error)}`);
  }
  try {
    time = await setWaterFoamTimeFrozen(page, false);
  } catch (error) {
    failures.push(`time reset: ${message(error)}`);
  }
  if (distance) {
    try {
      assertWaterFoamDistanceState(distance, null, "reset");
    } catch (error) {
      failures.push(message(error));
    }
  }
  if (time) {
    try {
      assertWaterFoamTimeState(time, false, "reset");
    } catch (error) {
      failures.push(message(error));
    }
  }
  if (failures.length > 0 || !distance || !time) {
    throw new Error(`foam distance control cleanup failed: ${failures.join("; ")}`);
  }
  return { distance, time };
}

export function assertWaterFoamDistanceState(
  state: WaterFoamDistanceOverrideState,
  expectedDistanceM: number | null,
  label: string,
): void {
  if (expectedDistanceM === null) {
    if (state.enabled || state.distanceM !== 0) throw new Error("foam distance override reset failed");
    return;
  }
  if (!state.enabled || state.distanceM !== expectedDistanceM) {
    throw new Error(`${label} foam distance override did not activate at ${expectedDistanceM} m`);
  }
}

export function assertWaterFoamTimeState(
  state: WaterFoamTimeFreezeState,
  expected: boolean,
  label: string,
): void {
  if (state.frozen !== expected) {
    throw new Error(`${label} foam time state did not equal ${String(expected)}`);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
