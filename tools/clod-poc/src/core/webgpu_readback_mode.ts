// Readback mode for the WebGPU error_px CLOD compute path.
//
// "off"    – dispatch compute for timing/parity only; no MAP_READ/mapAsync per dispatch.
// "async"  – dispatch compute, read back when ready, CPU selectCut consumes latest map.
// "once"   – read back only until the first valid map has been consumed (re-armed per
//            node-version change), then stop.
//
// Normal gameplay must be readback-free by default — and it is: the compute only
// dispatches under webgpuSelection=1. When that flag IS set, the slot-ring async
// readback is the default so the dispatch has a consumer; webgpuReadback=off remains
// available to measure dispatch cost alone.

export type WebGpuReadbackMode = "async" | "off" | "once";

export function parseReadbackMode(search: string | URLSearchParams): WebGpuReadbackMode {
  const q = typeof search === "string" ? new URLSearchParams(search) : search;
  const raw = q.get("webgpuReadback");
  if (raw === "async") return "async";
  if (raw === "once") return "once";
  if (raw === "off") return "off";

  const broadMode = q.get("gpuReadbacks");
  if (broadMode === "debug" || broadMode === "acceptance") return "async";
  if (q.get("webgpuSelection") === "1") return "async";
  return "off";
}
