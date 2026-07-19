import {
  clamp,
  dot,
  exp,
  float,
  max,
  mix,
  pow,
  reflect,
  smoothstep,
  vec3,
} from "three/tsl";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

export interface WaterScatterBodyNodes {
  readonly scatterColor: TslNode;
  readonly scatterExtinction: TslNode;
  readonly scatterStrength: TslNode;
  readonly scatterAmbient: TslNode;
}

export interface WaterGlitterNodes {
  readonly enabled: TslNode;
  readonly tightExponent: TslNode;
  readonly tightGain: TslNode;
  readonly broadExponent: TslNode;
  readonly broadGain: TslNode;
  readonly lowSunGain: TslNode;
}

export interface WaterSuspendedScatterNodes {
  readonly amount: TslNode;
  readonly color: TslNode;
}

export function buildWaterSuspendedScatter(
  depth: TslNode,
  ndotv: TslNode,
  sunDir: TslNode,
  body: WaterScatterBodyNodes,
): WaterSuspendedScatterNodes {
  const opticalThickness: TslNode = depth.div(max(ndotv, float(0.25)));
  const amount: TslNode = float(1)
    .sub(exp(opticalThickness.mul(max(body.scatterExtinction, float(0))).negate()))
    .mul(max(body.scatterStrength, float(0)));
  const skyAmbient: TslNode = mix(
    float(0.35),
    float(1),
    smoothstep(float(-0.05), float(0.35), sunDir.y),
  ).mul(max(body.scatterAmbient, float(0)));
  return {
    amount,
    color: body.scatterColor.mul(amount).mul(skyAmbient),
  };
}

export function buildWaterGlitter(
  normal: TslNode,
  viewDir: TslNode,
  sunDir: TslNode,
  glitter: WaterGlitterNodes,
): TslNode {
  const specDot: TslNode = max(dot(reflect(sunDir.negate(), normal), viewDir), float(0));
  const lowSun: TslNode = float(1).add(
    float(1)
      .sub(smoothstep(float(0.05), float(0.35), sunDir.y))
      .mul(max(glitter.lowSunGain, float(0))),
  );
  const tight: TslNode = pow(specDot, max(glitter.tightExponent, float(1)))
    .mul(max(glitter.tightGain, float(0)));
  const broad: TslNode = pow(specDot, max(glitter.broadExponent, float(1)))
    .mul(max(glitter.broadGain, float(0)));
  return vec3(1.0, 0.92, 0.76)
    .mul(clamp(glitter.enabled, float(0), float(1)))
    .mul(lowSun)
    .mul(tight.add(broad));
}
