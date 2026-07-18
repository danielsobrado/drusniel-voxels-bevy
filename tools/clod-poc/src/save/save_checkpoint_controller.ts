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

  const counters = (): SaveCheckpointCounters | null => deps.getCounters?.() ?? null;
  const increment = (key: keyof SaveCheckpointCounters): void => {
    const target = counters();
    if (!target) return;
    target[key] = (target[key] ?? 0) + 1;
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
      // Call flush immediately so concurrent requestCheckpoint() coalescing can observe
      // an in-flight flush before the next microtask. Do not defer through Promise.then.
      await deps.flush();
      if (deps.isConverged?.() ?? true) return;
    }
    throw new Error(`checkpoint did not converge after ${maxFlushPasses} flush passes`);
  };

  const requestCheckpoint = async (): Promise<void> => {
    if (inFlight) return inFlight;
    const startedAt = nowMs();
    increment("save_checkpoint_requests");
    const target = counters();
    if (target) target.save_checkpoint_in_flight = 1;
    publishStatus("saving checkpoint");

    inFlight = flushToConvergence()
      .then(() => {
        increment("save_checkpoint_completed");
        publishStatus("checkpoint saved");
      })
      .catch((error) => {
        increment("save_checkpoint_failed");
        publishStatus(`checkpoint failed: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      })
      .finally(() => {
        const latest = counters();
        if (latest) {
          latest.save_checkpoint_in_flight = 0;
          latest.save_checkpoint_last_ms = Math.max(0, nowMs() - startedAt);
        }
        inFlight = null;
      });

    return inFlight;
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
