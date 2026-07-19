import { clamp, float, max, mix, smoothstep, texture, vec2 } from "three/tsl";
import {
  WATER_FOAM_BANK_DROP_BASE,
  WATER_FOAM_BANK_DROP_GAIN,
  WATER_FOAM_BASE_WEIGHT,
  WATER_FOAM_DETAIL_WEIGHT,
  WATER_FOAM_MAX_COVERAGE,
  WATER_FOAM_PATTERN_END,
  WATER_FOAM_PATTERN_START,
  WATER_FOAM_SHORE_DISTANCE_WEIGHT,
} from "./water_foam_model.js";
import { getWaterFoamNoiseTexture } from "./water_foam_texture.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

export interface WaterFoamNodeInputs {
  readonly worldXZ: TslNode;
  readonly advectA: TslNode;
  readonly advectB: TslNode;
  readonly phaseBlend: TslNode;
  readonly noiseScale: TslNode;
  readonly depth: TslNode;
  readonly shoreDistance: TslNode;
  readonly bodyMask: TslNode;
  readonly riverWeight: TslNode;
  readonly rapidSpeed: TslNode;
  readonly rapidDrop: TslNode;
  readonly shoreFoamStart: TslNode;
  readonly shoreFoamEnd: TslNode;
  readonly shoreDistanceStart: TslNode;
  readonly shoreDistanceEnd: TslNode;
  readonly shoreStrength: TslNode;
  readonly riverStrength: TslNode;
  readonly bankStrength: TslNode;
  readonly rapidStrength: TslNode;
}

export interface WaterFoamNodes {
  readonly coverage: TslNode;
  readonly pattern: TslNode;
  readonly rapid: TslNode;
  readonly bankContact: TslNode;
}

export function buildWaterFoamNodes(input: WaterFoamNodeInputs): WaterFoamNodes {
  const noise = getWaterFoamNoiseTexture();
  const sample = (worldOffset: TslNode, scale: number, channel: "r" | "g"): TslNode => {
    const uv = input.worldXZ.sub(worldOffset).mul(input.noiseScale.mul(scale));
    const value = texture(noise, uv) as TslNode;
    return channel === "r" ? value.r : value.g;
  };

  const baseA = sample(input.advectA.mul(0.7), 1.0, "r");
  const baseB = sample(input.advectB.mul(0.7).sub(vec2(3.71, 1.13)), 1.0, "r");
  const detailA = sample(input.advectA.mul(0.41).sub(vec2(5.17, -3.29)), 2.37, "g");
  const detailB = sample(input.advectB.mul(0.41).sub(vec2(7.43, 2.81)), 2.37, "g");
  const oneMinusBlend = float(1).sub(input.phaseBlend);
  const variance = input.phaseBlend.mul(input.phaseBlend)
    .add(oneMinusBlend.mul(oneMinusBlend))
    .sqrt()
    .max(0.01);
  const base = mix(baseA, baseB, input.phaseBlend).sub(0.5).div(variance).add(0.5);
  const detail = mix(detailA, detailB, input.phaseBlend).sub(0.5).div(variance).add(0.5);
  const pattern = smoothstep(
    WATER_FOAM_PATTERN_START,
    WATER_FOAM_PATTERN_END,
    base.mul(WATER_FOAM_BASE_WEIGHT).add(detail.mul(WATER_FOAM_DETAIL_WEIGHT)),
  );

  const wetFade = smoothstep(0.005, 0.05, input.depth).mul(input.bodyMask);
  const depthContact = float(1).sub(smoothstep(input.shoreFoamStart, input.shoreFoamEnd, input.depth));
  const distanceContact = float(1).sub(
    smoothstep(input.shoreDistanceStart, input.shoreDistanceEnd, input.shoreDistance),
  );
  const bankContact = max(
    depthContact,
    distanceContact.mul(WATER_FOAM_SHORE_DISTANCE_WEIGHT),
  );
  const rapidEligibility = input.rapidSpeed.mul(input.rapidDrop).mul(input.riverWeight);
  const rapid = rapidEligibility.mul(input.rapidStrength);
  const bank = bankContact
    .mul(input.riverWeight)
    .mul(input.bankStrength)
    .mul(float(WATER_FOAM_BANK_DROP_BASE).add(input.rapidDrop.mul(WATER_FOAM_BANK_DROP_GAIN)));
  const source = bankContact
    .mul(input.shoreStrength)
    .add(rapid.add(bank).mul(input.riverStrength));
  const coverage = clamp(
    source.mul(pattern).mul(wetFade),
    0.0,
    WATER_FOAM_MAX_COVERAGE,
  );

  return { coverage, pattern, rapid, bankContact };
}
