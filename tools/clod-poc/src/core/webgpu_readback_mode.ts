// Readback mode for the WebGPU error_px CLOD compute path.
//
// "off"    – dispatch compute for timing/parity only; no MAP_READ/mapAsync per dispatch.
// "async"  – dispatch compute, read back when ready, CPU selectCut consumes latest map.
// "once"   – read back only until the first valid map has been consumed, then stop.
//
// Normal gameplay must be readback-free by default. Use an explicit query param
// for debug/parity sessions that need CPU-visible GPU results.

export type WebGpuReadbackMode = "async" | "off" | "once";

export function parseReadbackMode(search: string | URLSearchParams): WebGpuReadbackMode {
  const q = typeof search === "string" ? new URLSearchParams(search) : search;
  const raw = q.get("webgpuReadback");
  if (raw === "async") return "async";
  if (raw === "once") return "once";
  if (raw === "off") return "off";

  const broadMode = q.get("gpuReadbacks");
  if (broadMode === "debug" || broadMode === "acceptance") return "async";
  return "off";
}
