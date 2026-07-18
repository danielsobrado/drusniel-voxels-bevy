import { installStreamCursorPrimeTarget } from "../stream/stream_cursor.js";
import {
  runReadinessGatedTeleport,
  type TeleportRecoveryEvidence,
  type TeleportRecoveryTarget,
} from "./teleport_recovery.js";

export interface GameplayTeleportStreamPrimeInput {
  readonly target: TeleportRecoveryTarget;
  readonly timeoutMs: number;
  readonly commit: (target: TeleportRecoveryTarget) => void;
  readonly readyAt: (x: number, z: number) => boolean;
  readonly waitFrame: () => Promise<void>;
  readonly now: () => number;
  readonly recordReadyMs: (milliseconds: number) => void;
  /** Suspends gameplay simulation and returns an idempotent resume callback. */
  readonly suspendGameplay?: () => () => void;
}

/**
 * Loads a teleport destination through the canonical stream cursor while gameplay authority stays
 * at the source. The real player move occurs only after the full readiness envelope succeeds.
 */
export async function runStreamPrimedGameplayTeleport(
  input: GameplayTeleportStreamPrimeInput,
): Promise<TeleportRecoveryEvidence> {
  let releasePrime: (() => void) | null = null;
  const resumeGameplay = input.suspendGameplay?.() ?? (() => undefined);
  const clearPrime = (): void => {
    releasePrime?.();
    releasePrime = null;
  };

  try {
    return await runReadinessGatedTeleport({
      target: input.target,
      timeoutMs: input.timeoutMs,
      primeStream: ({ x, z }) => {
        clearPrime();
        releasePrime = installStreamCursorPrimeTarget({ x, z });
      },
      commit: (target) => {
        clearPrime();
        input.commit(target);
      },
      readyAt: input.readyAt,
      waitFrame: input.waitFrame,
      now: input.now,
      recordReadyMs: input.recordReadyMs,
    });
  } finally {
    clearPrime();
    resumeGameplay();
  }
}
