import type { GodRaysMode } from "../../environment/postprocess.js";

export const POST_PROCESS_QUALITY_PRESET_VALUES = [
  "custom",
  "ultra",
  "balanced",
  "perf",
  "potato",
] as const;

export type PostProcessQualityPreset = typeof POST_PROCESS_QUALITY_PRESET_VALUES[number];

type AppliedPostProcessQualityPreset = Exclude<PostProcessQualityPreset, "custom">;

export interface PostProcessQualityPresetState {
  postProcessQualityPreset: PostProcessQualityPreset;
  postProcessEnabled: boolean;
  postProcessRenderScale: number;
  postProcessBloomEnabled: boolean;
  postProcessFxaaEnabled: boolean;
  postProcessTaaEnabled: boolean;
  postProcessTaaJitterEnabled: boolean;
  postProcessTaaHistoryClampEnabled: boolean;
  postProcessContactShadowsEnabled: boolean;
  postProcessClarityEnabled: boolean;
  postProcessAerialPerspectiveEnabled: boolean;
  postProcessCloudsEnabled: boolean;
  postProcessGtaoEnabled: boolean;
  postProcessFroxelsEnabled: boolean;
  postProcessBounceEnabled: boolean;
  godRaysMode: GodRaysMode;
}

interface PostProcessQualityPresetConfig {
  renderScale: number;
  bloomEnabled: boolean;
  fxaaEnabled: boolean;
  taaEnabled: boolean;
  taaJitterEnabled: boolean;
  taaHistoryClampEnabled: boolean;
  contactShadowsEnabled: boolean;
  clarityEnabled: boolean;
  aerialPerspectiveEnabled: boolean;
  cloudsEnabled: boolean;
  gtaoEnabled: boolean;
  froxelsEnabled: boolean;
  bounceEnabled: boolean;
  godRaysMode: GodRaysMode;
}

const POST_PROCESS_QUALITY_PRESETS: Record<AppliedPostProcessQualityPreset, PostProcessQualityPresetConfig> = {
  ultra: {
    renderScale: 1.0,
    bloomEnabled: true,
    fxaaEnabled: true,
    taaEnabled: true,
    taaJitterEnabled: true,
    taaHistoryClampEnabled: true,
    contactShadowsEnabled: true,
    clarityEnabled: true,
    aerialPerspectiveEnabled: true,
    cloudsEnabled: true,
    gtaoEnabled: true,
    froxelsEnabled: true,
    bounceEnabled: true,
    godRaysMode: "volumetric",
  },
  balanced: {
    renderScale: 0.85,
    bloomEnabled: true,
    fxaaEnabled: true,
    taaEnabled: true,
    taaJitterEnabled: true,
    taaHistoryClampEnabled: true,
    contactShadowsEnabled: true,
    clarityEnabled: true,
    aerialPerspectiveEnabled: true,
    cloudsEnabled: true,
    gtaoEnabled: true,
    froxelsEnabled: true,
    bounceEnabled: true,
    godRaysMode: "heavy",
  },
  perf: {
    renderScale: 0.75,
    bloomEnabled: false,
    fxaaEnabled: true,
    taaEnabled: false,
    taaJitterEnabled: false,
    taaHistoryClampEnabled: false,
    contactShadowsEnabled: false,
    clarityEnabled: true,
    aerialPerspectiveEnabled: true,
    cloudsEnabled: false,
    gtaoEnabled: false,
    froxelsEnabled: false,
    bounceEnabled: false,
    godRaysMode: "cheap",
  },
  potato: {
    renderScale: 0.5,
    bloomEnabled: false,
    fxaaEnabled: true,
    taaEnabled: false,
    taaJitterEnabled: false,
    taaHistoryClampEnabled: false,
    contactShadowsEnabled: false,
    clarityEnabled: false,
    aerialPerspectiveEnabled: false,
    cloudsEnabled: false,
    gtaoEnabled: false,
    froxelsEnabled: false,
    bounceEnabled: false,
    godRaysMode: "off",
  },
};

export function isPostProcessQualityPreset(value: string | null): value is PostProcessQualityPreset {
  return POST_PROCESS_QUALITY_PRESET_VALUES.includes(value as PostProcessQualityPreset);
}

export function applyPostProcessQualityPreset(
  state: PostProcessQualityPresetState,
  preset: PostProcessQualityPreset,
): void {
  state.postProcessQualityPreset = preset;
  if (preset === "custom") return;

  const config = POST_PROCESS_QUALITY_PRESETS[preset];
  state.postProcessEnabled = true;
  state.postProcessRenderScale = config.renderScale;
  state.postProcessBloomEnabled = config.bloomEnabled;
  state.postProcessFxaaEnabled = config.fxaaEnabled;
  state.postProcessTaaEnabled = config.taaEnabled;
  state.postProcessTaaJitterEnabled = config.taaJitterEnabled;
  state.postProcessTaaHistoryClampEnabled = config.taaHistoryClampEnabled;
  state.postProcessContactShadowsEnabled = config.contactShadowsEnabled;
  state.postProcessClarityEnabled = config.clarityEnabled;
  state.postProcessAerialPerspectiveEnabled = config.aerialPerspectiveEnabled;
  state.postProcessCloudsEnabled = config.cloudsEnabled;
  state.postProcessGtaoEnabled = config.gtaoEnabled;
  state.postProcessFroxelsEnabled = config.froxelsEnabled;
  state.postProcessBounceEnabled = config.bounceEnabled;
  state.godRaysMode = config.godRaysMode;
}
