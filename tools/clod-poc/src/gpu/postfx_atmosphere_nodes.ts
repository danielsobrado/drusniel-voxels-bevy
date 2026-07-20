import {
  Fn,
  If,
  clamp,
  dot,
  exp,
  float,
  getViewPosition,
  log2,
  screenUV,
  smoothstep,
  time,
  vec2,
  vec3,
  vec4,
  texture3D,
} from "three/tsl";
import {
  RAYLEIGH_SPECTRAL_RATIO,
  type PostFxAtmosphereSettings,
  type PostFxFroxelDebugMode,
} from "./postfx_atmosphere.js";
import type { PostFxFroxelVolumeNodeInput } from "./postfx_froxel_volume.js";

type TslAny = any;

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
  const hillaireEnabled = hillaire.enabled;
  const maxAerialDistance = Math.max(1, hillaire.maxDistanceMeters);
  const maxFroxelDistance = Math.max(froxels.nearMeters, froxels.maxDistanceMeters);
  const froxelSteps = froxels.steps;
  const froxelDebugMode = input.froxelDebugMode ?? "off";
  const volume = input.froxelVolume;

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
        if (froxelDebugMode === "density") return vec3(clamp(float(1).sub(integrated.a), 0, 1));
        if (froxelDebugMode === "transmittance") return vec3(clamp(integrated.a, 0, 1));
        if (froxelDebugMode === "scatter") return clamp(integrated.rgb.mul(4), 0, 1);
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
        if (froxelDebugMode === "density") return vec3(clamp(opticalDepth.mul(0.6), 0, 1));
        if (froxelDebugMode === "transmittance") return vec3(clamp(transmittance, 0, 1));
        if (froxelDebugMode === "scatter") return clamp(scatter.mul(4), 0, 1);
        color.assign(color.mul(transmittance).add(scatter));
      }
    }

    if (hillaireEnabled) {
      const clampedDistance = distance.min(maxAerialDistance);
      const cameraHeight = input.cameraPosition.y.max(0);
      const rayleighDensity = densityAtHeight(cameraHeight, hillaire.rayleighScaleHeightMeters);
      const mieDensity = densityAtHeight(cameraHeight, hillaire.mieScaleHeightMeters);
      // Per-meter extinction; rayleighExtinction is the green-channel coefficient
      // spread over RGB by the spectral ratio so red survives farther than blue.
      const tauRayleigh = vec3(...RAYLEIGH_SPECTRAL_RATIO)
        .mul(rayleighDensity.mul(hillaire.rayleighExtinction).mul(clampedDistance));
      const tauMie = mieDensity.mul(hillaire.mieExtinction).mul(clampedDistance);
      const tauTotal = tauRayleigh.add(tauMie);
      const transmittance = vec3(
        exp(tauTotal.x.negate()),
        exp(tauTotal.y.negate()),
        exp(tauTotal.z.negate()),
      );
      const cosTheta = dirW.dot(sunDir);
      // 4pi-normalized phases (mean 1 over the sphere) keep in-scatter energy-conserving:
      // removed light is replaced by (1 - T) * inscatterColor, never darkened twice.
      const rayleighPhase = cosTheta.mul(cosTheta).add(1).mul(0.75);
      const miePhase = phaseHenyeyGreenstein(cosTheta, hillaire.mieG).mul(4 * Math.PI).min(4);
      const rayleighWeight = tauRayleigh.div(tauTotal.max(1e-5));
      const inscatter = vec3(...hillaire.rayleighColor).mul(rayleighPhase).mul(rayleighWeight)
        .add(vec3(...hillaire.mieColor).mul(miePhase).mul(float(1).sub(rayleighWeight)));
      const hazed = color.mul(transmittance)
        .add(inscatter.mul(float(1).sub(transmittance)).mul(hillaire.strength));
      color.assign(isSky.select(color, hazed));
    }

    return color;
  })();
}
