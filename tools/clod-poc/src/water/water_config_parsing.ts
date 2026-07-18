import { load } from "js-yaml";
import { DEFAULT_CAUSTICS_CONFIG } from "./causticsConfig.js";
import { DEFAULT_HYDROLOGY_CONFIG } from "./hydrologyConfig.js";
import { setGravelBarSettings } from "./gravel_bar_runtime.js";
import { cloneWaterConfig } from "./water_config_clone.js";
import { DEFAULT_WATER_CONFIG, DEFAULT_WATER_VISUAL } from "./water_config_defaults.js";
import { readWaterDebugConfig } from "./water_config_debug_parsing.js";
import { readFakeBodiesConfig } from "./water_config_fake_bodies.js";
import { readHydrologyConfig } from "./water_config_hydrology_parsing.js";
import { readBoolean, readNumber, readNumberArray } from "./water_config_readers.js";
import { resolveNormalizedFakeBodies } from "./water_config_resolution.js";
import { applyRuntimeRiverOverrides } from "./water_config_runtime_overrides.js";
import type { WaterConfig } from "./water_config_types.js";
import { validateWaterConfig } from "./water_config_validation.js";
import { readWaterCausticsConfig, readWaterVisualConfig } from "./water_config_visual_parsing.js";

const WATER_RUNTIME_OVERRIDE_OPTIONS = {
  clone: cloneWaterConfig,
  defaultHydrology: DEFAULT_HYDROLOGY_CONFIG,
};

export function parseWaterConfigYaml(source: string): WaterConfig {
  const parsed = load(source) as Record<string, unknown> | undefined;
  const waterRecord = (parsed?.water ?? {}) as Record<string, unknown>;
  const fakeBodies = readFakeBodiesConfig(waterRecord.fake_bodies ?? waterRecord.fakeBodies, DEFAULT_WATER_CONFIG.fakeBodies);
  const hydrology = readHydrologyConfig(waterRecord.hydrology, DEFAULT_WATER_CONFIG.hydrology);

  return {
    enabled: readBoolean(waterRecord.enabled, DEFAULT_WATER_CONFIG.enabled),
    source: waterRecord.source === "fake_bodies" ? "fake_bodies" : "hydrology",
    cellsPerLevel: readNumber(waterRecord.cells_per_level ?? waterRecord.cellsPerLevel, DEFAULT_WATER_CONFIG.cellsPerLevel),
    cellSizes: readNumberArray(waterRecord.cell_sizes ?? waterRecord.cellSizes, DEFAULT_WATER_CONFIG.cellSizes),
    snapCells: readNumber(waterRecord.snap_cells ?? waterRecord.snapCells, DEFAULT_WATER_CONFIG.snapCells),
    staticTopology: readBoolean(waterRecord.static_topology ?? waterRecord.staticTopology, DEFAULT_WATER_CONFIG.staticTopology),
    drySentinelDepth: readNumber(waterRecord.dry_sentinel_depth ?? waterRecord.drySentinelDepth, DEFAULT_WATER_CONFIG.drySentinelDepth),
    fakeBodies,
    hydrology,
    visual: readWaterVisualConfig(waterRecord.visual, DEFAULT_WATER_VISUAL),
    caustics: readWaterCausticsConfig(waterRecord.caustics, DEFAULT_CAUSTICS_CONFIG),
    debug: readWaterDebugConfig(waterRecord.debug, DEFAULT_WATER_CONFIG.debug),
  };
}

function warnWater(message: string, warn?: ((message: string) => void) | null): void {
  warn?.(`[water-config] ${message}`);
}

export function parseWaterConfig(
  text: string | null | undefined,
  warn: ((message: string) => void) | null = console.warn,
): WaterConfig {
  const fallback = applyRuntimeRiverOverrides(cloneWaterConfig(DEFAULT_WATER_CONFIG), WATER_RUNTIME_OVERRIDE_OPTIONS);
  if (!text || text.trim() === "") {
    setGravelBarSettings(fallback.hydrology.gravelBars);
    return fallback;
  }

  let config: WaterConfig;
  try {
    config = applyRuntimeRiverOverrides(parseWaterConfigYaml(text), WATER_RUNTIME_OVERRIDE_OPTIONS);
  } catch (error) {
    warnWater(
      `failed to parse config/water.yaml; using defaults: ${error instanceof Error ? error.message : String(error)}`,
      warn ?? undefined,
    );
    setGravelBarSettings(fallback.hydrology.gravelBars);
    return fallback;
  }

  const validated = validateWaterConfig(config, DEFAULT_WATER_CONFIG.debug.mode, warn ?? null);
  setGravelBarSettings(validated.hydrology.gravelBars);
  return validated;
}

/** Resolves normalized fake bodies to absolute coordinate space. */
export function resolveWaterConfig(config: WaterConfig, worldCells: number): WaterConfig {
  return resolveNormalizedFakeBodies(config, worldCells, cloneWaterConfig);
}
