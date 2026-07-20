import type { ForestCanopyEcologySample } from "../../forest_lighting/forest_lighting_texture.js";

export interface DressingCanopyEcologyFallback {
  readonly forest: number;
  readonly forestEdge: number;
  readonly snowWeight: number;
}

export interface DressingCanopyEcology {
  readonly forest: number;
  readonly forestEdge: number;
  readonly moistureFloor: number;
  readonly broadleafCoverage: number;
  readonly coniferCoverage: number;
  readonly skyExposure: number;
  readonly sunExposure: number;
}

export function resolveDressingCanopyEcology(
  canonical: ForestCanopyEcologySample | null,
  fallback: DressingCanopyEcologyFallback,
): DressingCanopyEcology {
  const forest = clamp01(canonical?.canopyDensity ?? fallback.forest);
  const competition = clamp01(canonical?.competition ?? forest);
  const forestEdge = clamp01(canonical?.forestEdge ?? fallback.forestEdge);
  const broadleafCoverage = clamp01(
    canonical?.broadleafCoverage ?? forest * (fallback.snowWeight < 0.3 ? 0.7 : 0.2),
  );
  const coniferCoverage = clamp01(
    canonical?.coniferCoverage ?? forest * (fallback.snowWeight >= 0.18 ? 0.75 : 0.3),
  );

  return {
    forest,
    forestEdge,
    moistureFloor: competition * 0.45,
    broadleafCoverage,
    coniferCoverage,
    skyExposure: clamp01(1 - competition * 0.75),
    sunExposure: clamp01(1 - competition * 0.7),
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
