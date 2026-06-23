// Readback mode for the WebGPU error_px CLOD compute path.
//
// "async"  – dispatch compute, read back when ready, CPU selectCut consumes latest map.
// "off"    – dispatch compute for timing/parity only; no MAP_READ/mapAsync per dispatch.
// "once"   – read back only until the first valid map has been consumed, then stop.

export type WebGpuReadbackMode = "async" | "off" | "once";

export function parseReadbackMode(search: string | URLSearchParams): WebGpuReadbackMode {
  const q = typeof search === "string" ? new URLSearchParams(search) : search;
  const raw = q.get("webgpuReadback");
  if (raw === "off") return "off";
  if (raw === "once") return "once";
  return "async";
}
