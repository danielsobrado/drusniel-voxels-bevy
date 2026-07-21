import { isRunningDeferredGpuDispose } from "./deferred_gpu_dispose.js";

/**
 * Opt-in diagnostic: log a stack trace for every UNSAFE GPUBuffer.destroy() call.
 *
 * Enable with `?gpuDestroyTrace=1`. Use it when the console shows
 * "[Buffer (unlabeled)] used in submit while destroyed" and the owning call site is not
 * obvious: reproduce the action, then read the last few `[gpu-destroy]` stacks logged
 * immediately before the validation errors — those are the frees that raced an in-flight
 * submit.
 *
 * Never installs unless the flag is present, so normal runs are untouched.
 */
interface PatchedGpuBufferPrototype {
  destroy: () => void;
  __drusnielDestroyTraced?: boolean;
}

export function installGpuBufferDestroyTrace(searchParams: URLSearchParams): boolean {
  const raw = searchParams.get("gpuDestroyTrace");
  const enabled = raw === "1" || raw === "true" || raw === "on";
  if (!enabled) return false;

  const ctor = (globalThis as { GPUBuffer?: { prototype: PatchedGpuBufferPrototype } }).GPUBuffer;
  const proto = ctor?.prototype;
  if (!proto || proto.__drusnielDestroyTraced) return false;

  const original = proto.destroy;
  let logged = 0;
  proto.destroy = function patchedDestroy(this: GPUBuffer): void {
    // Frees routed through disposeAfterGpuIdle() already waited for the queue to drain, so
    // they are safe by construction and only add noise. Report the rest: anything logged
    // here is a synchronous free that can still race an in-flight submit.
    if (!isRunningDeferredGpuDispose() && logged++ < 200) {
      const label = this.label ? `"${this.label}"` : "(unlabeled)";
      console.warn(`[gpu-destroy] UNSAFE ${label} size=${this.size}\n${new Error().stack ?? "(no stack)"}`);
    }
    original.call(this);
  };
  proto.__drusnielDestroyTraced = true;
  console.warn("[gpu-destroy] GPUBuffer.destroy tracing enabled (?gpuDestroyTrace=1)");
  return true;
}
