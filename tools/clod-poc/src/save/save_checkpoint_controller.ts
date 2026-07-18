const DEFAULT_MAX_FLUSH_PASSES = 8;
const SHORTCUT_CAPTURE = true;

export interface SaveCheckpointCounters {
  save_checkpoint_requests?: number;
  save_checkpoint_completed?: number;
  save_checkpoint_failed?: number;
  save_checkpoint_in_flight?: number;
  save_checkpoint_last_ms?: number;
}

export interface SaveCheckpointControllerDeps {
  flush: () => Promise<void>;
  isConverged?: () => boolean;
  maxFlushPasses?: number;
  getCounters?: () => SaveCheckpointCounters | null;
  nowMs?: () => number;
  onStatus?: (status: string) => void;
}

export interface SaveCheckpointController {
  requestCheckpoint(): Promise<void>;
  bindShortcut(target?: Window): () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

function normalizedPassCount(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_FLUSH_PASSES;
  return Math.max(1, Math.floor(value!));
}

export function createSaveCheckpointController(
  deps: SaveCheckpointControllerDeps,
): SaveCheckpointController {
  const nowMs = deps.nowMs ?? (() => performance.now());
  const maxFlushPasses = normalizedPassCount(deps.maxFlushPasses);
  let inFlight: Promise<void> | null = null;

  const counters = (): SaveCheckpointCounters | null => {
    try {
      return deps.getCounters?.() ?? null;
    } catch (error) {
      console.error("[save-checkpoint] counter provider failed", error);
      return null;
    }
  };
  const setCounter = (key: keyof SaveCheckpointCounters, value: number): void => {
    const target = counters();
    if (!target) return;
    try {
      target[key] = value;
    } catch (error) {
      console.error(`[save-checkpoint] counter write failed: ${key}`, error);
    }
  };
  const increment = (key: keyof SaveCheckpointCounters): void => {
    const target = counters();
    if (!target) return;
    try {
      target[key] = (target[key] ?? 0) + 1;
    } catch (error) {
      console.error(`[save-checkpoint] counter increment failed: ${key}`, error);
    }
  };
  const readClock = (phase: string): number | null => {
    try {
      const value = nowMs();
      if (Number.isFinite(value)) return value;
      console.error(`[save-checkpoint] clock returned a non-finite value during ${phase}`);
    } catch (error) {
      console.error(`[save-checkpoint] clock failed during ${phase}`, error);
    }
    return null;
  };
  const publishStatus = (status: string): void => {
    try {
      deps.onStatus?.(status);
    } catch (error) {
      console.error("[save-checkpoint] status callback failed", error);
    }
  };
  const flushToConvergence = async (): Promise<void> => {
    for (let pass = 1; pass <= maxFlushPasses; pass += 1) {
      await deps.flush();
      if (deps.isConverged?.() ?? true) return;
    }
    throw new Error(`checkpoint did not converge after ${maxFlushPasses} flush passes`);
  };

  const requestCheckpoint = (): Promise<void> => {
    if (inFlight) return inFlight;

    let resolveCheckpoint!: () => void;
    let rejectCheckpoint!: (reason: unknown) => void;
    const current = new Promise<void>((resolve, reject) => {
      resolveCheckpoint = resolve;
      rejectCheckpoint = reject;
    });
    inFlight = current;

    const runCheckpoint = async (): Promise<void> => {
      const startedAt = readClock("start");
      try {
        increment("save_checkpoint_requests");
        setCounter("save_checkpoint_in_flight", 1);
        publishStatus("saving checkpoint");

        await flushToConvergence();
        increment("save_checkpoint_completed");
        publishStatus("checkpoint saved");
      } catch (error) {
        increment("save_checkpoint_failed");
        publishStatus(`checkpoint failed: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      } finally {
        // Keep the guard active through cleanup so re-entrant instrumentation coalesces.
        try {
          setCounter("save_checkpoint_in_flight", 0);
          const finishedAt = readClock("cleanup");
          if (startedAt !== null && finishedAt !== null) {
            setCounter("save_checkpoint_last_ms", Math.max(0, finishedAt - startedAt));
          }
        } finally {
          if (inFlight === current) inFlight = null;
        }
      }
    };

    void runCheckpoint().then(resolveCheckpoint, rejectCheckpoint);
    return current;
  };

  const bindShortcut = (target: Window = window): (() => void) => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isEditableTarget(event.target)) return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.code !== "KeyS") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      void requestCheckpoint().catch((error) => {
        console.error("[save-checkpoint] checkpoint failed", error);
      });
    };
    target.addEventListener("keydown", onKeyDown, SHORTCUT_CAPTURE);
    return () => target.removeEventListener("keydown", onKeyDown, SHORTCUT_CAPTURE);
  };

  return { requestCheckpoint, bindShortcut };
}
