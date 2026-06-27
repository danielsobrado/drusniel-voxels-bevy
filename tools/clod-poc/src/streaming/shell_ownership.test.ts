import { describe, expect, it } from "vitest";
import { applyShellOwnershipRange, resolveShellOwnership } from "./shell_ownership.js";

describe("shell ownership", () => {
  it("moves the shell start to the CLOD ownership boundary", () => {
    const ownership = resolveShellOwnership({
      streaming: { preload_seconds: 4, live_radius_m: 200, clod_radius_m: 2048 },
      targetVisibleM: 4096,
      targetFutureVisibleM: 8192,
      streamingScene: true,
    });
    const shell = { startMeters: 1950, endMeters: 4096 };

    applyShellOwnershipRange(shell, ownership);

    expect(shell.startMeters).toBe(2048);
    expect(shell.endMeters).toBe(8192);
  });

  it("leaves finite scenes unchanged", () => {
    const ownership = resolveShellOwnership({
      streaming: { preload_seconds: 4, live_radius_m: 200, clod_radius_m: 2048 },
      targetVisibleM: 4096,
      targetFutureVisibleM: 8192,
      streamingScene: false,
    });
    const shell = { startMeters: 1950, endMeters: 4096 };

    applyShellOwnershipRange(shell, ownership);

    expect(shell).toEqual({ startMeters: 1950, endMeters: 4096 });
  });
});
