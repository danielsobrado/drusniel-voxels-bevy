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
  },
  balanced: {
    renderScale: 0.85,
    bloomEnabled: true,
    fxaaEnabled: true,
    taaEnabled: false,
    taaJitterEnabled: true,
    taaHistoryClampEnabled: true,
    contactShadowsEnabled: false,
    clarityEnabled: true,
    aerialPerspectiveEnabled: true,
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
}
