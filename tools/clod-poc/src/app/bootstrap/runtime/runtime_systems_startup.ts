import {
  createCanonicalProbeGiProviders,
  createProbeGiIntegration,
  disposeActiveProbeGiIntegration,
  type ProbeGiIntegration,
} from "../../../lighting/probe_gi/index.js";
import {
  runRuntimeSystemsStartup as runRuntimeSystemsStartupBase,
  type RuntimeSystemsStartupInput,
  type RuntimeSystemsStartupResult as RuntimeSystemsStartupBaseResult,
} from "./runtime_systems_startup_base.js";

export type {
  RuntimeSystemsStartupInput,
  VegetationStatControllerRefs,
} from "./runtime_systems_startup_base.js";

export interface RuntimeSystemsStartupResult extends RuntimeSystemsStartupBaseResult {
  probeGiIntegration: ProbeGiIntegration | null;
}

export async function runRuntimeSystemsStartup(
  input: RuntimeSystemsStartupInput,
): Promise<RuntimeSystemsStartupResult> {
  const result = await runRuntimeSystemsStartupBase(input);
  let probeGiIntegration: ProbeGiIntegration | null = null;
  if (!input.isWebGpu) {
    disposeActiveProbeGiIntegration();
    const requested = input.searchParams.get("probeGi");
    if (requested === "1" || requested === "true") {
      console.warn("[probe-gi] probeGi=1 ignored because WebGPU is unavailable");
    }
  }
  try {
    if (input.isWebGpu) {
      probeGiIntegration = createProbeGiIntegration({
        scene: input.scene,
        camera: input.camera,
        searchParams: input.searchParams,
        providers: createCanonicalProbeGiProviders(result.environmentQuery),
        device: input.rendererWebGpuDevice,
      });
    }
  } catch (error) {
    result.weatherController.dispose();
    result.waterController.dispose();
    throw error;
  }

  if (probeGiIntegration) {
    const disposeWater = result.waterController.dispose.bind(result.waterController);
    let disposed = false;
    result.waterController.dispose = () => {
      if (disposed) return;
      disposed = true;
      try {
        probeGiIntegration?.dispose();
      } finally {
        disposeWater();
      }
    };
  }

  return {
    ...result,
    probeGiIntegration,
  };
}
