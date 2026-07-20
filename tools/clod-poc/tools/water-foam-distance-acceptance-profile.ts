export interface WaterFoamDistanceFadeRange {
  readonly valid: boolean;
  readonly startM: number;
  readonly endM: number;
}

export interface WaterFoamSyntheticDistances {
  readonly nearM: number;
  readonly midM: number;
  readonly farM: number;
}

export function deriveWaterFoamSyntheticDistances(
  fade: WaterFoamDistanceFadeRange,
): WaterFoamSyntheticDistances {
  if (!fade.valid || !Number.isFinite(fade.startM) || !Number.isFinite(fade.endM) || fade.endM <= fade.startM) {
    throw new Error(`invalid live foam distance fade: ${JSON.stringify(fade)}`);
  }
  const width = fade.endM - fade.startM;
  return {
    nearM: Math.max(0, fade.startM - width * 0.25),
    midM: (fade.startM + fade.endM) * 0.5,
    farM: fade.endM + width * 0.25,
  };
}
