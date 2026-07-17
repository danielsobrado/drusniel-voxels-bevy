export interface SaveCheckpointCounters {
  save_checkpoint_requests?: number;
  save_checkpoint_completed?: number;
  save_checkpoint_failed?: number;
  save_checkpoint_in_flight?: number;
  save_checkpoint_last_ms?: number;
}

export interface SaveCheckpointControllerDeps {
  flush: () => Promise<void>;
  getCounters?: () => SaveCheckpointCounters | null;
  nowMs?: () => number;
  onStatus?: (status: string) => void;
}

export interface SaveCheckpointController {
  requestCheckpoint(): Promise<void>;
  bindShortcut(target?: Window): () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

export function createSaveCheckpointController(
  deps: SaveCheckpointControllerDeps,
): SaveCheckpointController {
  const nowMs = deps.nowMs ?? (() => performance.now());
  let inFlight: Promise<void> | null = null;

  const counters = (): SaveCheckpointCounters | null => deps.getCounters?.() ?? null;
  const increment = (key: keyof SaveCheckpointCounters): void => {
    const target = counters();
    if (!target) return;
    target[key] = (target[key] ?? 0) + 1;
  };

  const requestCheckpoint = async (): Promise<void> => {
    if (inFlight) return inFlight;
    const startedAt = nowMs();
    increment("save_checkpoint_requests");
    const target = counters();
    if (target) target.save_checkpoint_in_flight = 1;
    deps.onStatus?.("saving checkpoint");

    inFlight = deps.flush()
      .then(() => {
        increment("save_checkpoint_completed");
        deps.onStatus?.("checkpoint saved");
      })
      .catch((error) => {
        increment("save_checkpoint_failed");
        deps.onStatus?.(`checkpoint failed: ${error instanceof Error ? error.message : String(error)}`);
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
      void requestCheckpoint().catch((error) => {
        console.error("[save-checkpoint] checkpoint failed", error);
      });
    };
    target.addEventListener("keydown", onKeyDown);
    return () => target.removeEventListener("keydown", onKeyDown);
  };

  return { requestCheckpoint, bindShortcut };
}
