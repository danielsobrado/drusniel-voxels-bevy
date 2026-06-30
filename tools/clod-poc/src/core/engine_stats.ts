import { TimestampQuery } from "three";
import type { WebGPURenderer } from "three/webgpu";
import { PHASE0 } from "./constants.js";
import { GpuProfiler } from "./gpu_profiler.js";
import type { ClodHooks, EngineStats } from "./hooks.js";

interface RenderInfo {
  render: { drawCalls?: number; triangles?: number; timestamp?: number };
  compute?: { timestamp?: number };
}

export class EngineStatsTracker {
  readonly stats: EngineStats = {
    fps: 0,
    frameMs: 0,
    frameMsP95: 0,
    drawCalls: 0,
    triangles: 0,
    frame: 0,
    counters: {},
    gpuPasses: {},
  };

  private readonly frameMs: number[] = [];
  private fpsEma = 0;
  private timestampPending = false;
  private readonly profiler: GpuProfiler | null;

  constructor(
    private readonly renderer: WebGPURenderer,
    hooks: ClodHooks,
    private readonly timestampsSupported: boolean,
  ) {
    hooks.stats = this.stats;
    this.stats.counters["phase0.timestampQuerySupported"] = timestampsSupported ? 1 : 0;
    // TP-1: real per-pass attribution. `info.render.timestamp` is the pool SUM
    // and under-reports once the query pool wraps; the profiler reads the
    // resolved per-uid durations directly and labels them per pass.
    this.profiler = timestampsSupported ? new GpuProfiler(renderer) : null;
  }

  update(rawDt: number): void {
    const ms = rawDt * 1000;
    this.frameMs.push(ms);
    if (this.frameMs.length > PHASE0.p95Window) this.frameMs.shift();
    const sorted = [...this.frameMs].sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? ms;
    const fpsNow = rawDt > 0 ? 1 / rawDt : 0;
    this.fpsEma = this.fpsEma === 0 ? fpsNow : this.fpsEma * 0.95 + fpsNow * 0.05;

    const info = this.renderer.info as unknown as RenderInfo;
    this.stats.fps = this.fpsEma;
    this.stats.frameMs = ms;
    this.stats.frameMsP95 = p95;
    this.stats.drawCalls = info.render.drawCalls ?? 0;
    this.stats.triangles = info.render.triangles ?? 0;
    this.stats.frame++;

    if (this.timestampsSupported && !this.timestampPending) {
      this.timestampPending = true;
      Promise.all([
        this.renderer.resolveTimestampsAsync(TimestampQuery.RENDER),
        this.renderer.resolveTimestampsAsync(TimestampQuery.COMPUTE),
      ])
        .then(() => {
          if (this.profiler) {
            this.profiler.collect(this.stats.gpuPasses);
          } else {
            this.stats.gpuPasses["render"] = info.render.timestamp ?? 0;
            this.stats.gpuPasses["compute"] = info.compute?.timestamp ?? 0;
          }
        })
        .catch(() => {
          for (const key of Object.keys(this.stats.gpuPasses)) delete this.stats.gpuPasses[key];
        })
        .finally(() => {
          this.timestampPending = false;
        });
    }
  }
}
