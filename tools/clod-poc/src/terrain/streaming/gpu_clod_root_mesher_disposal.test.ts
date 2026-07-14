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

describe("GPU CLOD root pool disposal", () => {
  it("reserves a slot before awaiting and destroys it only after the build exits", async () => {
    const gate = deferred();
    let disposals = 0;
    const child: GpuClodRootMesher = {
      async buildPages() {
        await gate.promise;
        return { nodes: [], buildMs: 1, transferBytes: 0 };
      },
      stats: () => ({ ...disabledGpuStats(), enabled: 1 }),
      recordFallbackPages: () => undefined,
      recordWorkerFallbackPages: () => undefined,
      dispose: () => { disposals++; },
    };
    const pool = new PooledGpuClodRootMesher([child]);

    const activeBuild = pool.buildPages([{ px: 0, pz: 0 }]);
    pool.dispose();

    expect(pool.poolStats().active).toBe(1);
    expect(disposals).toBe(0);
    await expect(pool.buildPages([{ px: 1, pz: 0 }])).rejects.toThrow("disposed");

    gate.resolve();
    await activeBuild;
    expect(pool.poolStats().active).toBe(0);
    expect(disposals).toBe(1);
  });
});
