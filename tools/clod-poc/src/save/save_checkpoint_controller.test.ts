import { describe, expect, it, vi } from "vitest";
import { createSaveCheckpointController, type SaveCheckpointCounters } from "./save_checkpoint_controller.js";

class FakeWindow extends EventTarget {
  dispatchKey(event: KeyboardEvent): void {
    this.dispatchEvent(event);
  }
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

  it("binds Ctrl+S to the public checkpoint route", async () => {
    const flush = vi.fn(async () => undefined);
    const target = new FakeWindow();
    const controller = createSaveCheckpointController({ flush });
    const dispose = controller.bindShortcut(target as unknown as Window);
    const event = new KeyboardEvent("keydown", { code: "KeyS", ctrlKey: true, cancelable: true });

    target.dispatchKey(event);
    await Promise.resolve();
    await Promise.resolve();

    expect(event.defaultPrevented).toBe(true);
    expect(flush).toHaveBeenCalledOnce();
    dispose();
  });

  it("surfaces flush failures and clears the in-flight state", async () => {
    const counters: SaveCheckpointCounters = {};
    const controller = createSaveCheckpointController({
      flush: async () => { throw new Error("disk full"); },
      getCounters: () => counters,
      nowMs: () => 10,
    });

    await expect(controller.requestCheckpoint()).rejects.toThrow("disk full");
    expect(counters.save_checkpoint_failed).toBe(1);
    expect(counters.save_checkpoint_in_flight).toBe(0);
  });
});
