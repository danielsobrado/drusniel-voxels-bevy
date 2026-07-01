import {
  Fn,
  If,
  clamp,
  dot,
  exp,
  float,
  getViewPosition,
  log2,
  mix,
  screenUV,
  smoothstep,
  time,
  texture,
  vec2,
  vec3,
  vec4,
  texture3D,
} from "three/tsl";
import type { PostFxAtmosphereSettings, PostFxFroxelDebugMode } from "./postfx_atmosphere.js";
import type { PostFxFroxelVolumeNodeInput } from "./postfx_froxel_volume.js";
import type { PostFxHillaireLutNodeInput } from "./postfx_hillaire_luts.js";

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
  froxelDebugMode?: PostFxFroxelDebugMode;
  froxelVolume?: PostFxFroxelVolumeNodeInput | null;
  hillaireLuts?: PostFxHillaireLutNodeInput | null;
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
  const froxelDebugMode = input.froxelDebugMode ?? "off";
  const volume = input.froxelVolume;
  const hillaireLuts = input.hillaireLuts;

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
      if (volume) {
        const volumeNear = Math.max(0.0001, volume.nearMeters);
        const volumeFar = Math.max(volumeNear, volume.maxDistanceMeters);
        const volumeDepth = clamp(
          log2(fogDistance.max(volumeNear).div(volumeNear)).div(Math.log2(volumeFar / volumeNear)),
          0,
          1,
        );
        const integrated = texture3D(volume.integratedTexture, vec3(screenUV.x, screenUV.y, volumeDepth), 0) as TslAny;
        if (froxelDebugMode === "density") {
          return vec3(clamp(float(1).sub(integrated.a), 0, 1));
        }
        if (froxelDebugMode === "transmittance") {
          return vec3(clamp(integrated.a, 0, 1));
        }
        if (froxelDebugMode === "scatter") {
          return clamp(integrated.rgb.mul(4), 0, 1);
        }
        color.assign(color.mul(integrated.a).add(integrated.rgb));
      } else {
        const groundAnchor = input.cameraPosition.add(dirW.mul(fogDistance));
        const groundReferenceHeight = isSky.select(float(froxels.groundReferenceHeightMeters), groundAnchor.y);
        const transmittance = float(1).toVar();
        const scatter = vec3(0).toVar();
        const opticalDepth = float(0).toVar();
        const lowSun = float(1).sub(smoothstep(0.08, 0.65, sunDir.y));
        const densitySunScale = lowSun.mul(froxels.sunDensityBoost).add(froxels.ambientDensityFloor);
        for (let step = 0; step < froxelSteps; step++) {
          const a = step / froxelSteps;
          const b = (step + 1) / froxelSteps;
          const t0 = froxels.nearMeters * Math.pow(maxFroxelDistance / froxels.nearMeters, a);
          const t1 = froxels.nearMeters * Math.pow(maxFroxelDistance / froxels.nearMeters, b);
          If(fogDistance.greaterThan(t0), () => {
            const segmentEnd = fogDistance.min(t1);
            const segmentLength = segmentEnd.sub(t0).max(0.0001);
            const sliceJitter = hashNoise(screenUV
              .mul(vec2(911.3, 423.7))
              .add(vec2(float(step).mul(13.13), float(step).mul(71.71))))
              .mul(0.8)
              .add(0.1);
            const sampleDistance = float(t0).add(segmentLength.mul(sliceJitter));
            const worldPos = input.cameraPosition.add(dirW.mul(sampleDistance));
            const hGround = worldPos.y.sub(groundReferenceHeight).max(0);
            const rhoGround = densityAtHeight(hGround, froxels.groundFalloffMeters).mul(froxels.groundFogDensity);
            const rhoAlt = densityAtHeight(worldPos.y, froxels.altitudeFalloffMeters).mul(froxels.altitudeFogDensity);
            const noiseUv = worldPos.xz
              .mul(0.037)
              .add(vec2(time.mul(0.19), time.mul(0.11)))
              .add(vec2(float(step).mul(17.17), float(step).mul(31.31)));
            const noise = hashNoise(noiseUv)
              .mul(2)
              .sub(1)
              .mul(froxels.noiseStrength)
              .add(1)
              .max(0);
            const shaft = lowSun.mul(froxels.sunShaftsStrength).add(1);
            const density = rhoGround.add(rhoAlt).mul(noise).mul(densitySunScale).mul(froxels.strength);
            const sliceT = exp(density.mul(segmentLength.negate()));
            const phase = phaseHenyeyGreenstein(dirW.dot(sunDir), 0.5);
            const fogColor = vec3(...hillaire.mieColor).mul(phase.mul(18).mul(shaft)).add(vec3(...hillaire.rayleighColor).mul(0.035));
            opticalDepth.addAssign(density.mul(segmentLength));
            scatter.addAssign(fogColor.mul(float(1).sub(sliceT)).mul(transmittance));
            transmittance.mulAssign(sliceT);
          });
        }
        if (froxelDebugMode === "density") {
          return vec3(clamp(opticalDepth.mul(0.6), 0, 1));
        }
        if (froxelDebugMode === "transmittance") {
          return vec3(clamp(transmittance, 0, 1));
        }
        if (froxelDebugMode === "scatter") {
          return clamp(scatter.mul(4), 0, 1);
        }
        color.assign(color.mul(transmittance).add(scatter));
      }
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
      let transmittanceRgb: TslAny = vec3(transmittance);
      let lutInscatter: TslAny = vec3(0);
      if (hillaireLuts) {
        const heightUv = clamp(cameraHeight.div(40000), 0, 1);
        const sunUv = clamp(sunDir.y.mul(0.5).add(0.5), 0, 1);
        const viewUv = clamp(dirW.y.mul(0.5).add(0.5), 0, 1);
        transmittanceRgb = transmittanceRgb.mul((texture(hillaireLuts.transmittanceTexture, vec2(sunUv, heightUv)) as TslAny).rgb);
        lutInscatter = (texture(hillaireLuts.skyViewTexture, vec2(screenUV.x, viewUv)) as TslAny).rgb
          .add((texture(hillaireLuts.multiScatterTexture, vec2(sunUv, heightUv)) as TslAny).rgb);
      }
      const inscatter = vec3(...hillaire.rayleighColor)
        .mul(rayleighPhase)
        .mul(opticalRayleigh)
        .add(vec3(...hillaire.mieColor).mul(miePhase).mul(opticalMie).mul(6));
      const hazed = color.mul(transmittanceRgb)
        .add(inscatter.add(lutInscatter).mul(float(1).sub(transmittance)).mul(hillaire.strength));
      const distanceFade = smoothstep(0, maxAerialDistance, clampedDistance);
      color.assign(tslMix(color, hazed, clamp(distanceFade, 0, 1).mul(isSky.select(float(0), float(1)))));
    }

    return color;
  })();
}
