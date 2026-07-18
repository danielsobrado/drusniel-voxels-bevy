import type { PlayableSliceSnapshot } from "../../src/qa/playable_slice_snapshot.js";
import {
  finalizePlayableSliceRun,
  type PlayableSliceActionRecord,
  type PlayableSliceMode,
  type PlayableSliceRunReport,
  type PlayableSliceStep,
  type PlayableSliceStepEvidence,
} from "./playable_slice_contract.js";

const STEP_TIMEOUT_MS = 30_000;
const DIG_TIMEOUT_MS = 60_000;
const SPELL_TIMEOUT_MS = 60_000;
const CHECKPOINT_TIMEOUT_MS = 60_000;

export interface PublicPlayableSliceDriver {
  readonly actions: readonly PlayableSliceActionRecord[];
  readonly evidence: readonly PlayableSliceStepEvidence[];
  readonly maxFrameMs: number;
  readonly maxFrameP95Ms: number;
  nowMs(): number;
  snapshot(): Promise<PlayableSliceSnapshot>;
  recordEvidence(evidence: PlayableSliceStepEvidence): void;
  keyDown(key: string): Promise<void>;
  keyUp(key: string): Promise<void>;
  press(key: string, modifiers?: readonly string[]): Promise<void>;
  pointerMoveToCenter(): Promise<void>;
  pointerClick(button: "left" | "right"): Promise<void>;
  waitForPointerLock(locked: boolean): Promise<void>;
  reload(): Promise<void>;
  waitUntil(
    label: string,
    predicate: (snapshot: PlayableSliceSnapshot) => boolean,
    timeoutMs?: number,
  ): Promise<PlayableSliceSnapshot>;
}

export interface DiagnosticPlayableSliceDriver extends PublicPlayableSliceDriver {
  diagnosticBarrier(label: string): Promise<void>;
}

export interface PlayableSliceRunOptions {
  readonly mode: PlayableSliceMode;
  readonly runIndex: number;
  readonly freshProfile: boolean;
  readonly expectedWaterBodyId: string;
  readonly startedAt?: Date;
}

function distanceXZ(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

async function evidence(
  driver: PublicPlayableSliceDriver,
  steps: PlayableSliceStepEvidence[],
  step: PlayableSliceStep,
  snapshot?: PlayableSliceSnapshot,
): Promise<PlayableSliceSnapshot> {
  const captured = snapshot ?? await driver.snapshot();
  const item = { step, snapshot: captured, atMs: driver.nowMs() } satisfies PlayableSliceStepEvidence;
  steps.push(item);
  driver.recordEvidence(item);
  return captured;
}

async function barrier(
  driver: PublicPlayableSliceDriver,
  mode: PlayableSliceMode,
  label: string,
): Promise<void> {
  if (mode === "diagnostic") await (driver as DiagnosticPlayableSliceDriver).diagnosticBarrier(label);
}

async function withHeldKeys<T>(
  driver: PublicPlayableSliceDriver,
  keys: readonly string[],
  operation: () => Promise<T>,
): Promise<T> {
  const held: string[] = [];
  let primaryError: unknown = null;
  try {
    for (const key of keys) {
      await driver.keyDown(key);
      held.push(key);
    }
    return await operation();
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    let cleanupError: unknown = null;
    for (const key of [...held].reverse()) {
      try {
        await driver.keyUp(key);
      } catch (error) {
        cleanupError ??= error;
      }
    }
    if (!primaryError && cleanupError) throw cleanupError;
  }
}

async function restorePlayerAfterConstruction(driver: PublicPlayableSliceDriver): Promise<void> {
  let cleanupError: unknown = null;
  try {
    const current = await driver.snapshot();
    if (current.construction.active) await driver.press("b");
  } catch (error) {
    cleanupError = error;
  }
  try {
    await driver.keyUp("Tab");
  } catch (error) {
    cleanupError ??= error;
  }
  try {
    await driver.waitForPointerLock(true);
  } catch (error) {
    cleanupError ??= error;
  }
  if (cleanupError) throw cleanupError;
}

async function runRoute(
  driver: PublicPlayableSliceDriver,
  options: PlayableSliceRunOptions,
): Promise<Omit<PlayableSliceRunReport, "passed" | "failures">> {
  const startedAt = options.startedAt ?? new Date();
  const startedAtMs = driver.nowMs();
  const steps: PlayableSliceStepEvidence[] = [];

  await barrier(driver, options.mode, "spawn readiness");
  const start = await evidence(driver, steps, "spawn_ready");

  const boundary = await withHeldKeys(driver, ["Shift", "w"], () => driver.waitUntil(
    "terrain page boundary",
    (snapshot) => snapshot.page[0] !== start.page[0] || snapshot.page[1] !== start.page[1],
    STEP_TIMEOUT_MS,
  ));
  await evidence(driver, steps, "boundary_crossed", boundary);
  await barrier(driver, options.mode, "boundary readiness");

  await driver.pointerClick("left");
  const dug = await driver.waitUntil(
    "terrain edit commit",
    (snapshot) => snapshot.terrain.revision > boundary.terrain.revision
      && snapshot.terrain.voxelDeltaCount > boundary.terrain.voxelDeltaCount,
    DIG_TIMEOUT_MS,
  );
  await evidence(driver, steps, "terrain_dug", dug);

  let constructionFailure: unknown = null;
  try {
    await driver.keyDown("Tab");
    await driver.waitForPointerLock(false);
    await driver.press("b");
    await driver.pointerMoveToCenter();
    const buildReady = await driver.waitUntil(
      "construction preview",
      (snapshot) => snapshot.construction.active
        && snapshot.construction.currentValid
        && !snapshot.construction.transactionInFlight,
      STEP_TIMEOUT_MS,
    );
    await driver.pointerClick("left");
    const placed = await driver.waitUntil(
      "construction placement",
      (snapshot) => snapshot.construction.placedPieces > buildReady.construction.placedPieces
        && snapshot.construction.colliders >= snapshot.construction.placedPieces
        && snapshot.construction.unsupportedPieces === 0
        && snapshot.construction.pendingCollapses === 0
        && !snapshot.construction.transactionInFlight,
      STEP_TIMEOUT_MS,
    );
    await evidence(driver, steps, "construction_placed", placed);
    await barrier(driver, options.mode, "construction placement convergence");

    await driver.pointerClick("right");
    const broken = await driver.waitUntil(
      "construction break",
      (snapshot) => snapshot.construction.placedPieces < placed.construction.placedPieces
        && snapshot.construction.colliders === snapshot.construction.placedPieces
        && !snapshot.construction.transactionInFlight,
      STEP_TIMEOUT_MS,
    );
    await evidence(driver, steps, "construction_broken", broken);
    await driver.press("b");
  } catch (error) {
    constructionFailure = error;
    throw error;
  } finally {
    try {
      await restorePlayerAfterConstruction(driver);
    } catch (error) {
      if (!constructionFailure) throw error;
    }
  }

  const water = await withHeldKeys(driver, ["Shift", "w"], () => driver.waitUntil(
    "authoritative water entry",
    (snapshot) => snapshot.swim.mode === "surface" || snapshot.swim.mode === "submerged",
    STEP_TIMEOUT_MS,
  ));
  await evidence(driver, steps, "water_entered", water);
  await barrier(driver, options.mode, "water authority convergence");

  await driver.press("4");
  const spell = await driver.waitUntil(
    "earth spell runtime convergence",
    (snapshot) => snapshot.spell.denied > water.spell.denied
      || snapshot.spell.runtimeConvergenceCompleted > water.spell.runtimeConvergenceCompleted
      || snapshot.spell.runtimeConvergenceFailed > water.spell.runtimeConvergenceFailed,
    SPELL_TIMEOUT_MS,
  );
  await evidence(driver, steps, "earth_cast_converged", spell);
  await barrier(driver, options.mode, "spell derived convergence");

  await driver.press("s", ["Control"]);
  const checkpoint = await driver.waitUntil(
    "save checkpoint",
    (snapshot) => snapshot.persistence.checkpointCompleted > spell.persistence.checkpointCompleted
      || snapshot.persistence.checkpointFailed > spell.persistence.checkpointFailed,
    CHECKPOINT_TIMEOUT_MS,
  );
  await evidence(driver, steps, "checkpoint_saved", checkpoint);

  await driver.reload();
  const reloaded = await driver.waitUntil(
    "saved world reload",
    (snapshot) => snapshot.persistence.loaded
      && snapshot.persistence.lastError === 0
      && snapshot.persistence.voxelDeltaCount >= checkpoint.persistence.voxelDeltaCount
      && snapshot.terrain.voxelDeltaCount >= checkpoint.persistence.voxelDeltaCount,
    CHECKPOINT_TIMEOUT_MS,
  );
  await evidence(driver, steps, "world_reloaded", reloaded);
  await barrier(driver, options.mode, "post-reload readiness");

  const continued = await withHeldKeys(driver, ["w"], () => driver.waitUntil(
    "continued gameplay",
    (snapshot) => distanceXZ(snapshot.pose, reloaded.pose) >= 1,
    STEP_TIMEOUT_MS,
  ));
  await evidence(driver, steps, "gameplay_continued", continued);

  return {
    schemaVersion: 1,
    mode: options.mode,
    runIndex: options.runIndex,
    freshProfile: options.freshProfile,
    expectedWaterBodyId: options.expectedWaterBodyId,
    startedAt: startedAt.toISOString(),
    wallClockMs: Math.max(0, driver.nowMs() - startedAtMs),
    actions: [...driver.actions],
    steps,
    maxFrameMs: driver.maxFrameMs,
    maxFrameP95Ms: driver.maxFrameP95Ms,
    travelledAfterReloadM: distanceXZ(continued.pose, reloaded.pose),
  };
}

export async function runDiagnosticPlayableSlice(
  driver: DiagnosticPlayableSliceDriver,
  options: Omit<PlayableSliceRunOptions, "mode">,
): Promise<PlayableSliceRunReport> {
  return finalizePlayableSliceRun(await runRoute(driver, { ...options, mode: "diagnostic" }));
}

export async function runContinuousPlayableSlice(
  driver: PublicPlayableSliceDriver,
  options: Omit<PlayableSliceRunOptions, "mode">,
): Promise<PlayableSliceRunReport> {
  return finalizePlayableSliceRun(await runRoute(driver, { ...options, mode: "continuous" }));
}
