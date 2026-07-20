export const WATER_NORMAL_MODEL_OPTIONS = {
  "Fable5 FBM": "fable5",
  "Glacial Valley noise": "glacial",
  "Legacy analytic waves": "legacy",
} as const;

export type WaterNormalModel = typeof WATER_NORMAL_MODEL_OPTIONS[keyof typeof WATER_NORMAL_MODEL_OPTIONS];

const WATER_NORMAL_MODEL_IDS: Record<WaterNormalModel, number> = {
  fable5: 0,
  glacial: 1,
  legacy: 2,
};

export function waterNormalModelId(model: WaterNormalModel): number {
  return WATER_NORMAL_MODEL_IDS[model];
}

export function parseWaterNormalModel(value: unknown, fallback: WaterNormalModel): WaterNormalModel {
  return value === "fable5" || value === "glacial" || value === "legacy" ? value : fallback;
}
