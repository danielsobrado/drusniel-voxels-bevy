import { describe, expect, it, vi } from "vitest";
import { runReadinessGatedTeleport } from "./teleport_recovery.js";

describe("readiness-gated teleport recovery", () => {
  it("commits immediately when already ready and never primes into an unready cell", async () => {
    const commit = vi.fn();
    const primeStream = vi.fn();
    const recordReadyMs = vi.fn();

    const result = await runReadinessGatedTeleport({
      target: { x: 2_000, z: 0 },
      timeoutMs: 1_000,
      commit,
      primeStream,
      readyAt: () => true,
      waitFrame: async () => undefined,
      now: () => 100,
      recordReadyMs,
    });

    expect(primeStream).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledOnce();
    expect(result).toEqual({ timeToGameplayReadyMs: 0, readinessPolls: 1 });
    expect(recordReadyMs).toHaveBeenCalledWith(0);
  });

  it("primes stream first, waits on readiness, then commits arrival", async () => {
    let now = 100;
    let polls = 0;
    const commit = vi.fn();
    const primeStream = vi.fn();
    const recordReadyMs = vi.fn();
    const order: string[] = [];

    const result = await runReadinessGatedTeleport({
      target: { x: 2_000, z: 0 },
      timeoutMs: 1_000,
      commit: (target) => {
        order.push("commit");
        commit(target);
      },
      primeStream: (target) => {
        order.push("prime");
        primeStream(target);
      },
      readyAt: () => ++polls >= 3,
      waitFrame: async () => { now += 16; },
      now: () => now,
      recordReadyMs,
    });

    expect(primeStream).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledOnce();
    expect(order).toEqual(["prime", "commit"]);
    expect(result).toEqual({ timeToGameplayReadyMs: 16, readinessPolls: 3 });
    expect(recordReadyMs).toHaveBeenCalledWith(16);
  });

  it("fails loudly when the P1 predicate never becomes ready", async () => {
    let now = 0;
    const commit = vi.fn();
    await expect(runReadinessGatedTeleport({
      target: { x: 8_000, z: 0 },
      timeoutMs: 30,
      commit,
      primeStream: () => undefined,
      readyAt: () => false,
      waitFrame: async () => { now += 16; },
      now: () => now,
      recordReadyMs: () => undefined,
    })).rejects.toThrow("teleport readiness timed out");
    expect(commit).not.toHaveBeenCalled();
  });

  it("rejects non-finite targets before querying readiness", async () => {
    const readyAt = vi.fn(() => true);
    await expect(runReadinessGatedTeleport({
      target: { x: Number.NaN, z: 0 },
      timeoutMs: 30,
      commit: vi.fn(),
      readyAt,
      waitFrame: async () => undefined,
      now: () => 0,
      recordReadyMs: vi.fn(),
    })).rejects.toThrow(/target must be finite/);
    expect(readyAt).not.toHaveBeenCalled();
  });

  it("fails instead of polling forever when the readiness clock is invalid", async () => {
    const readyAt = vi.fn(() => false);
    await expect(runReadinessGatedTeleport({
      target: { x: 1, z: 2 },
      timeoutMs: 30,
      commit: vi.fn(),
      readyAt,
      waitFrame: async () => undefined,
      now: () => Number.NaN,
      recordReadyMs: vi.fn(),
    })).rejects.toThrow(/clock returned/);
    expect(readyAt).not.toHaveBeenCalled();
  });
});
