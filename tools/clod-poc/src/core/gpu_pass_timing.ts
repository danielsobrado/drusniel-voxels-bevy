import { TimestampQuery } from "three";
import type { WebGPURenderer } from "three/webgpu";
import { GpuProfiler } from "./gpu_profiler.js";

/**
 * Drains WebGPU timestamp queries whenever renderer timestamp tracking is on.
 * Named pass collection is optional and only enabled for perf captures.
 */
export class GpuPassTiming {
  readonly passes: Record<string, number> = {};
  private readonly profiler: GpuProfiler | null;
  private pending = false;

  constructor(
    private readonly renderer: WebGPURenderer,
    private readonly canResolve: boolean,
    collectPasses = canResolve,
  ) {
    this.profiler = collectPasses ? new GpuProfiler(renderer) : null;
  }

  get enabled(): boolean {
    return this.profiler !== null;
  }

  /** Kick a resolve for submitted timestamp queries; collects when enabled. */
  update(): void {
    if (!this.canResolve || this.pending) return;
    this.pending = true;
    Promise.all([
      this.renderer.resolveTimestampsAsync(TimestampQuery.RENDER),
      this.renderer.resolveTimestampsAsync(TimestampQuery.COMPUTE),
    ])
      .then(() => {
        this.profiler?.collect(this.passes);
      })
      .catch(() => {
        /* timestamps unsupported mid-run or resolve failed; keep last good values */
      })
      .finally(() => {
        this.pending = false;
      });
  }
}
