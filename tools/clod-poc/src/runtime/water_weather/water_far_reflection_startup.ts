import farReflectionConfigText from "../../../config/water_far_reflection.yaml?raw";
import { configureFarReflectionSource } from "../../terrain/far_clipmap/far_reflection_source_config_runtime.js";
import {
  parseWaterFarReflectionConfig,
  resolveWaterFarReflectionConfig,
} from "../../water/water_far_reflection_config.js";
import { runWaterStartup, type WaterStartupInput, type WaterStartupResult } from "./water_startup.js";

export async function runWaterStartupWithFarReflection(
  input: WaterStartupInput,
): Promise<WaterStartupResult> {
  const defaults = input.waterConfig.visual.reflection.farSummary;
  const policy = resolveWaterFarReflectionConfig(
    parseWaterFarReflectionConfig(farReflectionConfigText, defaults),
    input.searchParams,
  );
  const releaseProducerConfig = configureFarReflectionSource(policy.enabled ? {
    enabled: true,
    resolution: policy.sourceResolution,
    spanM: policy.sourceSpanM,
    snapM: policy.sourceSnapM,
    buildCellsPerFrame: policy.sourceBuildCellsPerFrame,
  } : null);

  try {
    const result = await runWaterStartup({
      ...input,
      waterConfig: {
        ...input.waterConfig,
        visual: {
          ...input.waterConfig.visual,
          reflection: {
            ...input.waterConfig.visual.reflection,
            clipmapTiers: {
              ...input.waterConfig.visual.reflection.clipmapTiers,
              enabled: policy.enabled || input.waterConfig.visual.reflection.clipmapTiers.enabled,
            },
            farSummary: policy,
          },
        },
      },
    });
    const disposeWaterController = result.waterController.dispose.bind(result.waterController);
    let disposed = false;
    result.waterController.dispose = () => {
      if (disposed) return;
      disposed = true;
      try {
        disposeWaterController();
      } finally {
        releaseProducerConfig();
      }
    };
    return result;
  } catch (error) {
    releaseProducerConfig();
    throw error;
  }
}
