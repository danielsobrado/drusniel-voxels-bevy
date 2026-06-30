import { TimestampQuery } from "three";
import type { WebGPURenderer } from "three/webgpu";
import { GpuProfiler } from "./gpu_profiler.js";

/**
 * TP-1 main-app collector: resolves the WebGPU timestamp queries every frame
 * and aggregates real per-pass GPU ms into `passes` (label → ms). Inert (a
 * no-op `update()`, empty `passes`) when the adapter has no `timestamp-query`,
 * so it costs nothing in normal play / on backends without the feature.
 */
export class GpuPassTiming {
  readonly passes: Record<string, number> = {};
  private readonly profiler: GpuProfiler | null;
  private pending = false;

  constructor(
    private readonly renderer: WebGPURenderer,
    supported: boolean,
  ) {
    this.profiler = supported ? new GpuProfiler(renderer) : null;
  }

  get enabled(): boolean {
    return this.profiler !== null;
  }

  /** Kick a resolve for the last submitted frame; collects when it lands. */
  update(): void {
    if (!this.profiler || this.pending) return;
    this.pending = true;
    Promise.all([
      this.renderer.resolveTimestampsAsync(TimestampQuery.RENDER),
      this.renderer.resolveTimestampsAsync(TimestampQuery.COMPUTE),
    ])
      .then(() => {
        this.profiler?.collect(this.passes);
      })
      .catch(() => {
        /* timestamps unsupported mid-run — keep last good values */
      })
      .finally(() => {
        this.pending = false;
      });
  }
}
