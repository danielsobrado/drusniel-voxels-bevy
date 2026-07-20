import type {
  HydrologyGravelBarsConfig,
  HydrologyGravelBedConfig,
} from "./hydrologyConfig.js";
import type { HydrologySample } from "./hydrologyGrid.js";
import {
  createGravelBarBedAuthority,
  type GravelBarBedAuthority,
} from "./gravel_bar_bed_authority.js";
import {
  readGravelBarSettings,
  readGravelBedSettings,
} from "./gravel_bar_runtime.js";
import type { TerrainHeightSampler } from "./water_field_types.js";

export interface RuntimeGravelBedSettingsSource {
  readField(): HydrologyGravelBarsConfig;
  readBed(): HydrologyGravelBedConfig;
}

const DEFAULT_SETTINGS_SOURCE: RuntimeGravelBedSettingsSource = {
  readField: readGravelBarSettings,
  readBed: readGravelBedSettings,
};

export function createRuntimeGravelBedTerrainResolver(
  terrain: TerrainHeightSampler,
  settings: RuntimeGravelBedSettingsSource = DEFAULT_SETTINGS_SOURCE,
): (x: number, z: number, sample: HydrologySample) => HydrologySample {
  let fieldConfig: HydrologyGravelBarsConfig | null = null;
  let bedConfig: HydrologyGravelBedConfig | null = null;
  let authority: GravelBarBedAuthority | null = null;

  return (x, z, sample) => {
    const nextFieldConfig = settings.readField();
    const nextBedConfig = settings.readBed();
    if (
      authority === null
      || nextFieldConfig !== fieldConfig
      || nextBedConfig !== bedConfig
    ) {
      fieldConfig = nextFieldConfig;
      bedConfig = nextBedConfig;
      authority = createGravelBarBedAuthority(fieldConfig, bedConfig, terrain);
    }
    return authority.apply(x, z, sample);
  };
}
