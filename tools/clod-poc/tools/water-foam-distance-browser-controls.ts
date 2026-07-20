import type { CdpPage } from "./water-harness.js";

export interface WaterFoamDistanceOverrideState {
  readonly enabled: boolean;
  readonly distanceM: number;
}

export interface WaterFoamTimeFreezeState {
  readonly frozen: boolean;
}

export interface WaterFoamAuxiliaryVisibilityState {
  readonly hidden: boolean;
  readonly matched: number;
}

export interface WaterFoamDistanceResetState {
  readonly distance: WaterFoamDistanceOverrideState;
  readonly time: WaterFoamTimeFreezeState;
  readonly auxiliary: WaterFoamAuxiliaryVisibilityState;
}

export interface WaterFoamDistanceCaptureResult<T> {
  readonly value: T;
  readonly reset: WaterFoamDistanceResetState;
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

export async function setWaterFoamAuxiliaryOverlaysHidden(
  page: CdpPage,
  hidden: boolean,
): Promise<WaterFoamAuxiliaryVisibilityState> {
  const state = await page.evaluate<WaterFoamAuxiliaryVisibilityState>(
    `window.setWaterFoamAuxiliaryOverlaysHidden(${JSON.stringify(hidden)})`,
  );
  if (!state || typeof state.hidden !== "boolean" || !Number.isInteger(state.matched) || state.matched < 0) {
    throw new Error("foam auxiliary visibility returned an invalid state");
  }
  return state;
}

export async function runWaterFoamDistanceCapture<T>(
  page: CdpPage,
  capture: () => Promise<T>,
): Promise<WaterFoamDistanceCaptureResult<T>> {
  const captureOutcome = await captureResult(capture);
  const cleanupOutcome = await captureResult(() => resetWaterFoamDistanceControls(page));

  if (!captureOutcome.ok && !cleanupOutcome.ok) {
    throw new Error(
      `foam distance capture failed: ${message(captureOutcome.error)}; cleanup failed: ${message(cleanupOutcome.error)}`,
    );
  }
  if (!captureOutcome.ok) throw captureOutcome.error;
  if (!cleanupOutcome.ok) throw cleanupOutcome.error;
  return { value: captureOutcome.value, reset: cleanupOutcome.value };
}

export async function resetWaterFoamDistanceControls(
  page: CdpPage,
): Promise<WaterFoamDistanceResetState> {
  let distance: WaterFoamDistanceOverrideState | null = null;
  let time: WaterFoamTimeFreezeState | null = null;
  let auxiliary: WaterFoamAuxiliaryVisibilityState | null = null;
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
  try {
    auxiliary = await setWaterFoamAuxiliaryOverlaysHidden(page, false);
  } catch (error) {
    failures.push(`auxiliary reset: ${message(error)}`);
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
  if (auxiliary) {
    try {
      assertWaterFoamAuxiliaryState(auxiliary, false, "reset");
    } catch (error) {
      failures.push(message(error));
    }
  }
  if (failures.length > 0 || !distance || !time || !auxiliary) {
    throw new Error(`foam distance control cleanup failed: ${failures.join("; ")}`);
  }
  return { distance, time, auxiliary };
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

export function assertWaterFoamAuxiliaryState(
  state: WaterFoamAuxiliaryVisibilityState,
  expectedHidden: boolean,
  label: string,
): void {
  if (state.hidden !== expectedHidden) {
    throw new Error(`${label} foam auxiliary hidden state did not equal ${String(expectedHidden)}`);
  }
  if (expectedHidden && state.matched < 2) {
    throw new Error(`${label} foam auxiliary isolation matched only ${state.matched} overlays`);
  }
  if (!expectedHidden && state.matched !== 0) {
    throw new Error(`${label} foam auxiliary reset retained ${state.matched} snapshots`);
  }
}

async function captureResult<T>(
  operation: () => Promise<T>,
): Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown }> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    return { ok: false, error };
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
