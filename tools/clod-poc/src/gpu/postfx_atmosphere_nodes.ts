import {
  Fn,
  If,
  clamp,
  dot,
  exp,
  float,
  getViewPosition,
  mix,
  screenUV,
  smoothstep,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { PostFxAtmosphereSettings } from "./postfx_atmosphere.js";

type TslAny = any;
const tslMix = mix as unknown as (a: TslAny, b: TslAny, amount: TslAny) => TslAny;

export interface HillaireFroxelAerialNodeInput {
  sourceRgb: TslAny;
  depthTex: TslAny;
  projectionInverse: TslAny;
  cameraWorld: TslAny;
  cameraPosition: TslAny;
  sunDirection: TslAny;
  settings: PostFxAtmosphereSettings;
}

function phaseHenyeyGreenstein(cosTheta: TslAny, g: number): TslAny {
  const gg = g * g;
  return float((1 - gg) / (4 * Math.PI)).div(float(1 + gg).sub(cosTheta.mul(2 * g)).pow(1.5));
}

function densityAtHeight(heightMeters: TslAny, scaleHeightMeters: number): TslAny {
  return exp(heightMeters.max(0).div(-Math.max(0.0001, scaleHeightMeters)));
}

function hashNoise(uv: TslAny): TslAny {
  const p = dot(uv, vec2(12.9898, 78.233));
  return p.sin().mul(43758.5453).fract();
}

export function createHillaireFroxelAerialNode(input: HillaireFroxelAerialNodeInput): TslAny {
  const { hillaire, froxels } = input.settings;
  const maxAerialDistance = Math.max(1, hillaire.maxDistanceMeters);
  const maxFroxelDistance = Math.max(froxels.nearMeters, froxels.maxDistanceMeters);
  const froxelSteps = froxels.steps;

  return Fn((): TslAny => {
    const depth = input.depthTex.x;
    const isSky = depth.lessThanEqual(1e-7).or(depth.greaterThanEqual(0.9999999));
    const viewPosition = getViewPosition(screenUV, depth, input.projectionInverse) as TslAny;
    const distance = viewPosition.length();
    const viewDirV = getViewPosition(screenUV, float(0.5), input.projectionInverse).normalize() as TslAny;
    const dirW = input.cameraWorld.mul(vec4(viewDirV, 0)).xyz.normalize();
    const sunDir = input.sunDirection.normalize();
    const color = input.sourceRgb.toVar();

    if (froxels.enabled) {
      const fogDistance = isSky.select(float(maxFroxelDistance), distance.min(maxFroxelDistance));
      const transmittance = float(1).toVar();
      const scatter = vec3(0).toVar();
      for (let step = 0; step < froxelSteps; step++) {
        const a = step / froxelSteps;
        const b = (step + 1) / froxelSteps;
        const t0 = froxels.nearMeters * Math.pow(maxFroxelDistance / froxels.nearMeters, a);
        const t1 = froxels.nearMeters * Math.pow(maxFroxelDistance / froxels.nearMeters, b);
        const mid = (t0 + t1) * 0.5;
        const dz = Math.max(0.0001, t1 - t0);
        If(fogDistance.greaterThan(t0), () => {
          const worldPos = input.cameraPosition.add(dirW.mul(mid));
          const hGround = worldPos.y.sub(input.cameraPosition.y).max(0);
          const rhoGround = densityAtHeight(hGround, froxels.groundFalloffMeters).mul(froxels.groundFogDensity);
          const rhoAlt = densityAtHeight(worldPos.y, froxels.altitudeFalloffMeters).mul(froxels.altitudeFogDensity);
          const noise = hashNoise(screenUV.mul(911.3).add(float(step).mul(17.17)))
            .mul(2)
            .sub(1)
            .mul(froxels.noiseStrength)
            .add(1)
            .max(0);
          const shaft = smoothstep(0.02, 0.65, sunDir.y).mul(froxels.sunShaftsStrength).add(1);
          const density = rhoGround.add(rhoAlt).mul(noise).mul(shaft).mul(froxels.strength);
          const sliceT = exp(density.mul(-dz));
          const phase = phaseHenyeyGreenstein(dirW.dot(sunDir), 0.5);
          const fogColor = vec3(...hillaire.mieColor).mul(phase.mul(18)).add(vec3(...hillaire.rayleighColor).mul(0.035));
          scatter.addAssign(fogColor.mul(float(1).sub(sliceT)).mul(transmittance));
          transmittance.mulAssign(sliceT);
        });
      }
      color.assign(color.mul(transmittance).add(scatter.mul(isSky.select(float(0), float(1)))));
    }

    if (hillaire.enabled) {
      const clampedDistance = isSky.select(float(maxAerialDistance), distance.min(maxAerialDistance));
      const cameraHeight = input.cameraPosition.y.max(0);
      const rayleighDensity = densityAtHeight(cameraHeight, hillaire.rayleighScaleHeightMeters);
      const mieDensity = densityAtHeight(cameraHeight, hillaire.mieScaleHeightMeters);
      const opticalRayleigh = rayleighDensity.mul(hillaire.rayleighExtinction).mul(clampedDistance);
      const opticalMie = mieDensity.mul(hillaire.mieExtinction).mul(clampedDistance);
      const transmittance = exp(opticalRayleigh.add(opticalMie).mul(-1));
      const cosTheta = dirW.dot(sunDir);
      const rayleighPhase = cosTheta.mul(cosTheta).add(1).mul(3 / (16 * Math.PI));
      const miePhase = phaseHenyeyGreenstein(cosTheta, hillaire.mieG);
      const inscatter = vec3(...hillaire.rayleighColor)
        .mul(rayleighPhase)
        .mul(opticalRayleigh)
        .add(vec3(...hillaire.mieColor).mul(miePhase).mul(opticalMie).mul(6));
      const hazed = color.mul(transmittance).add(inscatter.mul(float(1).sub(transmittance)).mul(hillaire.strength));
      const distanceFade = smoothstep(0, maxAerialDistance, clampedDistance);
      color.assign(tslMix(color, hazed, clamp(distanceFade, 0, 1).mul(isSky.select(float(0), float(1)))));
    }

    return color;
  })();
}
