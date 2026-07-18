import { describe, expect, it, vi } from "vitest";
import { createSaveCheckpointController, type SaveCheckpointCounters } from "./save_checkpoint_controller.js";

type KeyListener = EventListenerOrEventListenerObject;

class FakeWindow {
  private readonly captureListeners: KeyListener[] = [];
  private readonly bubbleListeners: KeyListener[] = [];

  addEventListener(type: string, listener: KeyListener, options?: boolean | AddEventListenerOptions): void {
    if (type !== "keydown") return;
    const capture = typeof options === "boolean" ? options : options?.capture === true;
    (capture ? this.captureListeners : this.bubbleListeners).push(listener);
  }

  removeEventListener(type: string, listener: KeyListener, options?: boolean | EventListenerOptions): void {
    if (type !== "keydown") return;
    const capture = typeof options === "boolean" ? options : options?.capture === true;
    const listeners = capture ? this.captureListeners : this.bubbleListeners;
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  }

  dispatchKey(event: KeyboardEvent): void {
    this.dispatchPhase(this.captureListeners, event);
    if (!event.cancelBubble) this.dispatchPhase(this.bubbleListeners, event);
  }

  private dispatchPhase(listeners: readonly KeyListener[], event: KeyboardEvent): void {
    for (const listener of [...listeners]) {
      if (typeof listener === "function") listener(event);
      else listener.handleEvent(event);
      if (event.cancelBubble) break;
    }
  }
}

function ctrlSaveEvent(repeat = false): KeyboardEvent {
  let defaultPrevented = false;
  let propagationStopped = false;
  return {
    code: "KeyS",
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    repeat,
    target: null,
    get defaultPrevented() { return defaultPrevented; },
    get cancelBubble() { return propagationStopped; },
    preventDefault: () => { defaultPrevented = true; },
    stopImmediatePropagation: () => { propagationStopped = true; },
  } as unknown as KeyboardEvent;
}

describe("save checkpoint controller", () => {
  it("coalesces concurrent checkpoint requests and publishes counters", async () => {
    let resolveFlush: () => void = () => undefined;
    const flush = vi.fn(() => new Promise<void>((resolve) => { resolveFlush = resolve; }));
    const counters: SaveCheckpointCounters = {};
    let now = 100;
    const controller = createSaveCheckpointController({
      flush,
      getCounters: () => counters,
      nowMs: () => now,
    });

    const first = controller.requestCheckpoint();
    const second = controller.requestCheckpoint();
    expect(flush).toHaveBeenCalledOnce();
    expect(counters.save_checkpoint_requests).toBe(1);
    expect(counters.save_checkpoint_in_flight).toBe(1);

    now = 145;
    resolveFlush();
    await Promise.all([first, second]);

    expect(counters.save_checkpoint_completed).toBe(1);
    expect(counters.save_checkpoint_failed ?? 0).toBe(0);
    expect(counters.save_checkpoint_in_flight).toBe(0);
    expect(counters.save_checkpoint_last_ms).toBe(45);
  });

  it("establishes the in-flight guard before callbacks can re-enter", async () => {
    let controller!: ReturnType<typeof createSaveCheckpointController>;
    let nestedFromStatus: Promise<void> | null = null;
    let nestedFromFlush: Promise<void> | null = null;
    let statusReentered = false;
    let flushReentered = false;
    const counters: SaveCheckpointCounters = {};
    const flush = vi.fn(() => {
      if (!flushReentered) {
        flushReentered = true;
        nestedFromFlush = controller.requestCheckpoint();
      }
      return Promise.resolve();
    });
    controller = createSaveCheckpointController({
      flush,
      getCounters: () => counters,
      onStatus: (status) => {
        if (status !== "saving checkpoint" || statusReentered) return;
        statusReentered = true;
        nestedFromStatus = controller.requestCheckpoint();
      },
    });

    const first = controller.requestCheckpoint();
    expect(nestedFromStatus).not.toBeNull();
    expect(nestedFromFlush).not.toBeNull();
    await Promise.all([first, nestedFromStatus!, nestedFromFlush!]);

    expect(flush).toHaveBeenCalledOnce();
    expect(counters.save_checkpoint_requests).toBe(1);
    expect(counters.save_checkpoint_completed).toBe(1);
  });

  it("repeats flush passes until the checkpoint is clean", async () => {
    let remainingDirtyPasses = 2;
    const flush = vi.fn(async () => { remainingDirtyPasses -= 1; });
    const controller = createSaveCheckpointController({
      flush,
      isConverged: () => remainingDirtyPasses <= 0,
    });

    await controller.requestCheckpoint();

    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("fails when checkpoint state never converges", async () => {
    const counters: SaveCheckpointCounters = {};
    const flush = vi.fn(async () => undefined);
    const controller = createSaveCheckpointController({
      flush,
      isConverged: () => false,
      maxFlushPasses: 2,
      getCounters: () => counters,
    });

    await expect(controller.requestCheckpoint()).rejects.toThrow("did not converge after 2 flush passes");
    expect(flush).toHaveBeenCalledTimes(2);
    expect(counters.save_checkpoint_failed).toBe(1);
    expect(counters.save_checkpoint_in_flight).toBe(0);
  });

  it("captures Ctrl+S before an earlier gameplay listener and suppresses repeats", async () => {
    const flush = vi.fn(async () => undefined);
    const target = new FakeWindow();
    const downstream = vi.fn();
    target.addEventListener("keydown", downstream);
    const controller = createSaveCheckpointController({ flush });
    const dispose = controller.bindShortcut(target as unknown as Window);

    const first = ctrlSaveEvent();
    target.dispatchKey(first);
    target.dispatchKey(ctrlSaveEvent(true));
    await Promise.resolve();
    await Promise.resolve();

    expect(first.defaultPrevented).toBe(true);
    expect(downstream).not.toHaveBeenCalled();
    expect(flush).toHaveBeenCalledOnce();
    dispose();
  });

  it("surfaces synchronous flush failures and clears the in-flight state", async () => {
    const counters: SaveCheckpointCounters = {};
    const controller = createSaveCheckpointController({
      flush: () => { throw new Error("disk full"); },
      getCounters: () => counters,
      nowMs: () => 10,
    });

    await expect(controller.requestCheckpoint()).rejects.toThrow("disk full");
    expect(counters.save_checkpoint_failed).toBe(1);
    expect(counters.save_checkpoint_in_flight).toBe(0);
  });

  it("does not let a status callback break a successful checkpoint", async () => {
    const status = vi.fn(() => { throw new Error("ui unavailable"); });
    const controller = createSaveCheckpointController({
      flush: async () => undefined,
      onStatus: status,
    });

    await expect(controller.requestCheckpoint()).resolves.toBeUndefined();
    expect(status).toHaveBeenCalledTimes(2);
  });
});
