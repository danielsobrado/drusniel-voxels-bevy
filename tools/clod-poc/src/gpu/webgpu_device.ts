export type WebGpuUnavailableReason =
  | "navigator-gpu-missing"
  | "adapter-unavailable"
  | "device-request-failed";

export interface WebGpuUnavailable {
  ok: false;
  reason: WebGpuUnavailableReason;
  message: string;
}

export interface WebGpuReady {
  ok: true;
  adapter: GPUAdapter;
  device: GPUDevice;
}

export type WebGpuDeviceResult = WebGpuReady | WebGpuUnavailable;

export async function requestWebGpuDevice(
  gpu: GPU | undefined = typeof navigator === "undefined" ? undefined : navigator.gpu,
): Promise<WebGpuDeviceResult> {
  if (!gpu) {
    return {
      ok: false,
      reason: "navigator-gpu-missing",
      message: "navigator.gpu is unavailable in this browser/context",
    };
  }

  const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) {
    return {
      ok: false,
      reason: "adapter-unavailable",
      message: "WebGPU adapter request returned null",
    };
  }

  try {
    const device = await adapter.requestDevice();
    return { ok: true, adapter, device };
  } catch (error) {
    return {
      ok: false,
      reason: "device-request-failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
