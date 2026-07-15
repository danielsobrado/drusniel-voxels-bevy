import { buildRequiredLimits } from "../core/diagnostics.js";
import type { GpuDiagnostics } from "../core/hooks.js";

const DIAGNOSTIC_LIMITS: readonly (keyof GPUSupportedLimits & string)[] = [
  "maxTextureDimension2D",
  "maxTextureDimension3D",
  "maxBindGroups",
  "maxStorageBufferBindingSize",
  "maxBufferSize",
  "maxComputeWorkgroupSizeX",
  "maxComputeWorkgroupsPerDimension",
  "maxComputeInvocationsPerWorkgroup",
  "maxStorageBuffersPerShaderStage",
  "maxStorageTexturesPerShaderStage",
  "maxSampledTexturesPerShaderStage",
  "maxUniformBuffersPerShaderStage",
];

export interface SharedWebGpuDevice {
  readonly adapter: GPUAdapter;
  readonly device: GPUDevice;
  readonly diagnostics: GpuDiagnostics;
  readonly requiredLimits: Record<string, number>;
}

let sharedPromise: Promise<SharedWebGpuDevice> | null = null;
let sharedValue: SharedWebGpuDevice | null = null;

function diagnosticsFromAdapter(adapter: GPUAdapter): GpuDiagnostics {
  const limits: Record<string, number> = {};
  for (const key of DIAGNOSTIC_LIMITS) {
    const value = adapter.limits[key];
    if (typeof value === "number") limits[key] = value;
  }
  const info = adapter.info;
  return {
    ok: true,
    vendor: info?.vendor ?? "unknown",
    architecture: info?.architecture ?? "unknown",
    device: info?.device ?? "unknown",
    description: info?.description ?? "",
    features: [...adapter.features].map(String).sort(),
    limits,
  };
}

export function getSharedWebGpuDevice(): SharedWebGpuDevice | null {
  return sharedValue;
}

export function requestSharedWebGpuDevice(): Promise<SharedWebGpuDevice> {
  if (sharedValue) return Promise.resolve(sharedValue);
  if (!sharedPromise) {
    sharedPromise = (async () => {
      if (!navigator.gpu) throw new Error("WebGPU is unavailable");
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter) throw new Error("WebGPU adapter request returned null");
      const diagnostics = diagnosticsFromAdapter(adapter);
      const requiredLimits = buildRequiredLimits(diagnostics);
      const device = await adapter.requestDevice({ requiredLimits });
      const value = Object.freeze({ adapter, device, diagnostics, requiredLimits });
      sharedValue = value;
      void device.lost.then(() => {
        if (sharedValue?.device === device) sharedValue = null;
        sharedPromise = null;
      });
      return value;
    })().catch((error) => {
      sharedPromise = null;
      throw error;
    });
  }
  return sharedPromise;
}
