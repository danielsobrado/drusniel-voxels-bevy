import { describe, expect, it } from "vitest";
import {
  PooledGpuClodRootMesher,
  disabledGpuStats,
  type GpuClodRootBuildResult,
  type GpuClodRootMesher,
  type GpuClodRootMesherStats,
} from "./gpu_clod_root_mesher.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function fakeMesher(
  build: () => Promise<GpuClodRootBuildResult>,
  stats: Partial<GpuClodRootMesherStats> = {},
): GpuClodRootMesher {
  return {
    buildPages: build,
    stats: () => ({ ...disabledGpuStats(), enabled: 1, ...stats }),
    recordFallbackPages: () => undefined,
    recordWorkerFallbackPages: () => undefined,
    dispose: () => undefined,
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function withGlobalCounters(run: (counters: Record<string, number>) => Promise<void>): Promise<void> {
  type CounterWindow = { __drusnielClod?: { stats?: { counters?: Record<string, number> } } };
  const scope = globalThis as unknown as { window?: CounterWindow };
  const previousWindow = scope.window;
  const counters: Record<string, number> = {};
  scope.window = { __drusnielClod: { stats: { counters } } };
  try {
    await run(counters);
  } finally {
    if (previousWindow === undefined) delete scope.window;
    else scope.window = previousWindow;
  }
}

describe("pooled GPU CLOD root mesher", () => {
  it("runs one build per pool concurrently and queues overflow", async () => {
    const gates = [deferred(), deferred(), deferred()];
    let started = 0;
    let active = 0;
    const make = () => fakeMesher(async () => {
      const gate = gates[started++]!;
      active++;
      await gate.promise;
      active--;
      return { nodes: [], buildMs: 1, transferBytes: 0 };
    });
    const pool = new PooledGpuClodRootMesher([make(), make()]);

    const first = pool.buildPages([{ px: 0, pz: 0 }]);
    const second = pool.buildPages([{ px: 1, pz: 0 }]);
    const third = pool.buildPages([{ px: 2, pz: 0 }]);
    await flushPromises();

    expect(started).toBe(2);
    expect(active).toBe(2);
    expect(pool.poolStats()).toMatchObject({
      poolCount: 2,
      active: 2,
      maxActive: 2,
      overlapEventsTotal: 1,
      waiters: 1,
    });

    gates[0]!.resolve();
    await flushPromises();
    expect(started).toBe(3);

    gates[1]!.resolve();
    gates[2]!.resolve();
    await Promise.all([first, second, third]);
    expect(pool.poolStats()).toMatchObject({
      active: 0,
      maxActive: 2,
      overlapEventsTotal: 2,
      waiters: 0,
    });
  });

  it("publishes waiter changes while overflow work is queued", async () => {
    await withGlobalCounters(async (counters) => {
      const gates = [deferred(), deferred(), deferred()];
      let started = 0;
      const make = () => fakeMesher(async () => {
        const gate = gates[started++]!;
        await gate.promise;
        return { nodes: [], buildMs: 1, transferBytes: 0 };
      });
      const pool = new PooledGpuClodRootMesher([make(), make()]);

      const first = pool.buildPages([{ px: 0, pz: 0 }]);
      const second = pool.buildPages([{ px: 1, pz: 0 }]);
      const third = pool.buildPages([{ px: 2, pz: 0 }]);
      await flushPromises();

      expect(counters["live_clod_stream_gpu_pool_active"]).toBe(2);
      expect(counters["live_clod_stream_gpu_pool_waiters"]).toBe(1);
      expect(counters["live_clod_stream_gpu_pool_overlap_events_total"]).toBe(1);

      gates[0]!.resolve();
      await flushPromises();
      expect(counters["live_clod_stream_gpu_pool_waiters"]).toBe(0);

      gates[1]!.resolve();
      gates[2]!.resolve();
      await Promise.all([first, second, third]);
      expect(counters["live_clod_stream_gpu_pool_active"]).toBe(0);
      expect(counters["live_clod_stream_gpu_pool_waiters"]).toBe(0);
    });
  });

  it("does not record overlap for serial builds", async () => {
    const pool = new PooledGpuClodRootMesher([
      fakeMesher(async () => ({ nodes: [], buildMs: 1, transferBytes: 0 })),
    ]);

    await pool.buildPages([{ px: 0, pz: 0 }]);
    await pool.buildPages([{ px: 1, pz: 0 }]);

    expect(pool.poolStats()).toMatchObject({
      poolCount: 1,
      active: 0,
      maxActive: 1,
      overlapEventsTotal: 0,
      waiters: 0,
    });
  });

  it("aggregates child throughput and wrapper fallback counters", () => {
    const pool = new PooledGpuClodRootMesher([
      fakeMesher(async () => ({ nodes: [], buildMs: 1, transferBytes: 0 }), {
        batchesDispatched: 2,
        pagesDispatched: 5,
        buildMsP95: 7,
      }),
      fakeMesher(async () => ({ nodes: [], buildMs: 1, transferBytes: 0 }), {
        batchesDispatched: 3,
        pagesDispatched: 4,
        buildMsP95: 11,
      }),
    ]);
    pool.recordFallbackPages(2);
    pool.recordWorkerFallbackPages(3);

    expect(pool.stats()).toMatchObject({
      enabled: 1,
      batchesDispatched: 5,
      pagesDispatched: 9,
      buildMsP95: 11,
      fallbackPages: 2,
      workerFallbackPages: 3,
    });
  });
});
