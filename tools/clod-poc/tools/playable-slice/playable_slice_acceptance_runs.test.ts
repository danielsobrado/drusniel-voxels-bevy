import { afterEach, describe, expect, it, vi } from "vitest";
import { withTimeout } from "./playable_slice_acceptance_runs.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("playable slice timeout liveness", () => {
  it("rejects on schedule even when timeout cleanup never settles", async () => {
    vi.useFakeTimers();
    const cleanup = vi.fn(() => new Promise<void>(() => undefined));
    const pending = withTimeout(
      "continuous playable route",
      new Promise<void>(() => undefined),
      25,
      cleanup,
    );
    const rejection = expect(pending).rejects.toThrow(
      "continuous playable route timed out after 25ms",
    );

    await vi.advanceTimersByTimeAsync(25);

    await rejection;
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("still rejects when timeout cleanup throws synchronously", async () => {
    vi.useFakeTimers();
    const cleanup = vi.fn(() => {
      throw new Error("page close failed");
    });
    const pending = withTimeout(
      "diagnostic playable route",
      new Promise<void>(() => undefined),
      25,
      cleanup,
    );
    const rejection = expect(pending).rejects.toThrow(
      "diagnostic playable route timed out after 25ms",
    );

    await vi.advanceTimersByTimeAsync(25);

    await rejection;
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("cancels the timer when the operation completes first", async () => {
    vi.useFakeTimers();
    const cleanup = vi.fn();

    await expect(withTimeout("route", Promise.resolve("done"), 25, cleanup)).resolves.toBe("done");
    await vi.advanceTimersByTimeAsync(25);

    expect(cleanup).not.toHaveBeenCalled();
  });
});
