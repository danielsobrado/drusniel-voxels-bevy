export interface TeleportRecoveryTarget {
  readonly x: number;
  readonly z: number;
}

export interface TeleportRecoveryEvidence {
  readonly timeToGameplayReadyMs: number;
  readonly readinessPolls: number;
}

function validateTeleportInput(target: TeleportRecoveryTarget, timeoutMs: number): void {
  if (!Number.isFinite(target.x) || !Number.isFinite(target.z)) {
    throw new RangeError(`teleport target must be finite, received (${target.x}, ${target.z})`);
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(`teleport timeout must be a positive finite number, received ${timeoutMs}`);
  }
}

/**
 * Hold-until-ready teleport (playable-world P1 / plan 1 LM5).
 *
 * Arrival (`commit`) runs only after `readyAt` is true. Optional `primeStream` may
 * nudge streaming/camera toward the target first without counting as gameplay arrival.
 * If the target is already ready, commit immediately and never prime into an unready cell.
 */
export async function runReadinessGatedTeleport(input: {
  readonly target: TeleportRecoveryTarget;
  readonly timeoutMs: number;
  /** Called only once the target is gameplay-ready. */
  readonly commit: (target: TeleportRecoveryTarget) => void;
  /** Optional streaming nudge before readiness (does not count as arrival). */
  readonly primeStream?: (target: TeleportRecoveryTarget) => void;
  readonly readyAt: (x: number, z: number) => boolean;
  readonly waitFrame: () => Promise<void>;
  readonly now: () => number;
  readonly recordReadyMs: (milliseconds: number) => void;
}): Promise<TeleportRecoveryEvidence> {
  validateTeleportInput(input.target, input.timeoutMs);
  const readNow = (): number => {
    const value = input.now();
    if (!Number.isFinite(value)) throw new Error(`teleport readiness clock returned ${value}`);
    return value;
  };
  const startedAt = readNow();
  let readinessPolls = 0;

  const finish = (polls: number): TeleportRecoveryEvidence => {
    input.commit(input.target);
    const timeToGameplayReadyMs = Math.max(0, readNow() - startedAt);
    input.recordReadyMs(timeToGameplayReadyMs);
    return { timeToGameplayReadyMs, readinessPolls: polls };
  };

  readinessPolls += 1;
  if (input.readyAt(input.target.x, input.target.z)) {
    return finish(readinessPolls);
  }

  input.primeStream?.(input.target);

  for (;;) {
    if (readNow() - startedAt > input.timeoutMs) {
      throw new Error(
        `teleport readiness timed out after ${input.timeoutMs}ms at (${input.target.x}, ${input.target.z})`,
      );
    }
    readinessPolls += 1;
    if (input.readyAt(input.target.x, input.target.z)) {
      return finish(readinessPolls);
    }
    await input.waitFrame();
  }
}
