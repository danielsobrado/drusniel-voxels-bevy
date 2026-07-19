import { describe, expect, it } from "vitest";
import { DEFAULT_CUSTOM_PROPS_SETTINGS } from "../props/prop_config.js";
import { propGpuCpuFallbackReason, type PropControllerDeps } from "./prop_controller.js";

function deps(overrides: Partial<PropControllerDeps> = {}): PropControllerDeps {
  const settings = structuredClone(DEFAULT_CUSTOM_PROPS_SETTINGS);
  settings.enabled = true;
  settings.gpu.enabled = true;
  settings.gpu.fallbackToCpu = true;
  return {
    scene: {} as PropControllerDeps["scene"],
    settings,
    placementScene: { schemaVersion: 1, sceneId: "test", instances: [] },
    gpuDevice: null,
    gpuBackend: null,
    ...overrides,
  };
}

describe("propGpuCpuFallbackReason", () => {
  it("reports missing WebGPU dependencies when fallback is active", () => {
    expect(propGpuCpuFallbackReason(deps())).toBe("WebGPU device unavailable");
    expect(propGpuCpuFallbackReason(deps({ gpuDevice: deviceWithStorageLimit(16) }))).toBe(
      "WebGPU renderer backend unavailable",
    );
  });

  it("reports unsupported adapter limits", () => {
    expect(propGpuCpuFallbackReason(deps({
      gpuDevice: deviceWithStorageLimit(4),
      gpuBackend: {} as PropControllerDeps["gpuBackend"],
    }))).toContain("device limit is 4");
  });

  it("stays quiet for intentional CPU mode, disabled systems, or disabled fallback", () => {
    const forced = deps();
    forced.settings.gpu.debugForceCpu = true;
    expect(propGpuCpuFallbackReason(forced)).toBeNull();

    const disabledSystem = deps();
    disabledSystem.settings.enabled = false;
    expect(propGpuCpuFallbackReason(disabledSystem)).toBeNull();

    const disabledFallback = deps();
    disabledFallback.settings.gpu.fallbackToCpu = false;
    expect(propGpuCpuFallbackReason(disabledFallback)).toBeNull();
  });
});

function deviceWithStorageLimit(maxStorageBuffersPerShaderStage: number): GPUDevice {
  return { limits: { maxStorageBuffersPerShaderStage } } as GPUDevice;
}
