import { describe, expect, it } from "vitest";
import {
  PooledGpuClodRootMesher,
  disabledGpuStats,
  type GpuClodRootMesher,
} from "./gpu_clod_root_mesher.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function childMesher(
  buildPages: GpuClodRootMesher["buildPages"],
  onDispose: () => void,
): GpuClodRootMesher {
  return {
    buildPages,
    stats: () => ({ ...disabledGpuStats(), enabled: 1 }),
    recordFallbackPages: () => undefined,
    recordWorkerFallbackPages: () => undefined,
    dispose: onDispose,
  };
}

describe("GPU CLOD root pool failure policy", () => {
  it("disables the runtime after a child build failure", async () => {
    let disposals = 0;
    const pool = new PooledGpuClodRootMesher([
      childMesher(async () => { throw new Error("GPU validation failed"); }, () => { disposals++; }),
    ]);

    await expect(pool.buildPages([{ px: 0, pz: 0 }])).rejects.toThrow("GPU validation failed");

    expect(pool.stats().enabled).toBe(0);
    expect(disposals).toBe(1);
    await expect(pool.buildPages([{ px: 1, pz: 0 }])).rejects.toThrow("disabled after a build failure");

    pool.dispose();
    expect(disposals).toBe(1);
  });

  it("rejects queued work and waits for concurrent builds before cleanup", async () => {
    const slowGate = deferred();
    const failingGate = deferred();
    let disposals = 0;
    const pool = new PooledGpuClodRootMesher([
      childMesher(async () => {
        await slowGate.promise;
        return { nodes: [], buildMs: 1, transferBytes: 0 };
      }, () => { disposals++; }),
      childMesher(async () => {
        await failingGate.promise;
        throw new Error("device lost");
      }, () => { disposals++; }),
    ]);

    const slow = pool.buildPages([{ px: 0, pz: 0 }]);
    const failing = pool.buildPages([{ px: 1, pz: 0 }]);
    const queued = pool.buildPages([{ px: 2, pz: 0 }]);

    failingGate.resolve();
    await expect(failing).rejects.toThrow("device lost");
    await expect(queued).rejects.toThrow("disabled after a build failure");
    expect(disposals).toBe(0);

    slowGate.resolve();
    await slow;
    expect(disposals).toBe(2);
  });
});
