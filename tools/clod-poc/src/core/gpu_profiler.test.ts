import { describe, expect, it } from "vitest";
import { GpuProfiler, tagGpu } from "./gpu_profiler.js";

// Minimal fake of the three WebGPU backend the profiler hooks into: it stores
// the per-context timestampUID returned by `get`, and exposes a
// `timestampQueryPool` whose `timestamps` map mirrors what three resolves.
interface FakeCtx {
  __uid?: string;
  isComputeNode?: boolean;
  name?: string;
  renderTarget?: { textures?: { name?: string }[] } | null;
}

function makeRenderer(): {
  renderer: { backend: unknown };
  registerCtx: (ctx: FakeCtx, uid: string) => void;
  setRenderTimestamps: (entries: Record<string, number>) => void;
} {
  const renderPool = { timestamps: new Map<string, number>() };
  const backend = {
    updateTimeStampUID(_ctx: object): void {
      /* three would assign a uid here; our test assigns it via registerCtx */
    },
    get(ctx: object): { timestampUID?: string } {
      return { timestampUID: (ctx as FakeCtx).__uid };
    },
    timestampQueryPool: { render: renderPool, compute: null } as Record<string, unknown>,
  };
  return {
    renderer: { backend },
    registerCtx(ctx, uid) {
      ctx.__uid = uid;
      backend.updateTimeStampUID(ctx);
    },
    setRenderTimestamps(entries) {
      renderPool.timestamps.clear();
      for (const [uid, ms] of Object.entries(entries)) renderPool.timestamps.set(uid, ms);
    },
  };
}

describe("GpuProfiler", () => {
  it("labels passes (screen / shadow cascades / tagged) and sums the newest frame", () => {
    const env = makeRenderer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const profiler = new GpuProfiler(env.renderer as any);

    const screen: FakeCtx = { renderTarget: null };
    const shadow0: FakeCtx = { renderTarget: { textures: [{ name: "ShadowMap" }] } };
    const shadow1: FakeCtx = { renderTarget: { textures: [{ name: "ShadowMap" }] } };
    const treeCompute: FakeCtx = { isComputeNode: true, name: "treeRingScatter" };
    env.registerCtx(screen, "screen:f5");
    env.registerCtx(shadow0, "s0:f5");
    env.registerCtx(shadow1, "s1:f5");
    env.registerCtx(treeCompute, "tc:f5");

    env.setRenderTimestamps({ "screen:f5": 4, "s0:f5": 1, "s1:f5": 0.5 });
    const out: Record<string, number> = {};
    profiler.collect(out);

    expect(out["r.screen"]).toBe(4);
    expect(out["r.shadow.c0"]).toBe(1);
    expect(out["r.shadow.c1"]).toBe(0.5);
    expect(out["render"]).toBe(5.5);
  });

  it("keeps only the newest frame's entries and prunes older ones", () => {
    const env = makeRenderer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const profiler = new GpuProfiler(env.renderer as any);
    env.registerCtx({ renderTarget: null }, "screen:f9");
    env.registerCtx({ renderTarget: null }, "screen:f10");
    // a stale (older) uid lingers in the pool alongside the newest frame
    env.setRenderTimestamps({ "screen:f9": 99, "screen:f10": 3 });

    const out: Record<string, number> = {};
    profiler.collect(out);
    expect(out["render"]).toBe(3);
    expect(out["r.screen"]).toBe(3);
  });

  it("honors explicit tagGpu labels", () => {
    const env = makeRenderer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const profiler = new GpuProfiler(env.renderer as any);
    const ctx: FakeCtx = { renderTarget: null };
    tagGpu(ctx, "treeMain");
    env.registerCtx(ctx, "x:f1");
    env.setRenderTimestamps({ "x:f1": 2 });

    const out: Record<string, number> = {};
    profiler.collect(out);
    expect(out["r.treeMain"]).toBe(2);
  });
});
