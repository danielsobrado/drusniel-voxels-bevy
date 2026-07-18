export interface TeleportRecoveryTarget {
  readonly x: number;
  readonly z: number;
}

export interface TeleportRecoveryEvidence {
  readonly timeToGameplayReadyMs: number;
  readonly readinessPolls: number;
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
  const startedAt = input.now();
  let readinessPolls = 0;

  const finish = (polls: number): TeleportRecoveryEvidence => {
    input.commit(input.target);
    const timeToGameplayReadyMs = Math.max(0, input.now() - startedAt);
    input.recordReadyMs(timeToGameplayReadyMs);
    return { timeToGameplayReadyMs, readinessPolls: polls };
  };

  readinessPolls += 1;
  if (input.readyAt(input.target.x, input.target.z)) {
    return finish(readinessPolls);
  }

  input.primeStream?.(input.target);

  for (;;) {
    if (input.now() - startedAt > input.timeoutMs) {
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
