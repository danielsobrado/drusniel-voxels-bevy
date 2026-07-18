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
  time,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { PostFxCloudSettings } from "./postfx_clouds.js";
import { inverseSmoothstep } from "./postfx_mask_math.js";
import type { TslAny } from "./webgpu_postprocess_nodes.js";

export interface VolumetricCloudLayerInput {
  depthTex: TslAny;
  projectionInverse: TslAny;
  cameraWorld: TslAny;
  cameraPosition: TslAny;
  sunDirection: TslAny;
  settings: PostFxCloudSettings;
}

export interface VolumetricCloudCompositeInput {
  sourceRgb: TslAny;
  cloudTex: TslAny;
}

const CLOUD_NOISE_WEIGHTS = [0.52, 0.31, 0.17] as const;
const CLOUD_BLUE_NOISE_SCALE = [132.37, 77.17] as const;
const CLOUD_WIND_DIR = [0.821, 0.571] as const;
const CLOUD_MIN_STEP_METERS = 8.0;
const CLOUD_SUN_OCCLUSION_STEPS = 3;
const CLOUD_SUN_OCCLUSION_STEP_METERS = 160;
const CLOUD_POWDER_SCALE = 18;

const tslMix = mix as unknown as (a: TslAny, b: TslAny, amount: TslAny) => TslAny;

function hashNoise2(uv: TslAny): TslAny {
  return dot(uv, vec2(12.9898, 78.233)).sin().mul(43758.5453).fract();
}

function cloudNoise(worldPosition: TslAny, windOffset: TslAny): TslAny {
  const p = worldPosition.xz.sub(windOffset);
  const n0 = p.x.mul(0.0021).add(p.y.mul(0.0017)).add(worldPosition.y.mul(0.0031)).sin().mul(0.5).add(0.5);
  const n1 = p.x.mul(-0.0043).add(p.y.mul(0.0037)).add(worldPosition.y.mul(0.0053)).sin().mul(0.5).add(0.5);
  const n2 = p.x.mul(0.0089).add(p.y.mul(-0.0062)).add(worldPosition.y.mul(0.0091)).sin().mul(0.5).add(0.5);
  return n0.mul(CLOUD_NOISE_WEIGHTS[0]).add(n1.mul(CLOUD_NOISE_WEIGHTS[1])).add(n2.mul(CLOUD_NOISE_WEIGHTS[2]));
}

function cloudDensity(worldPosition: TslAny, windOffset: TslAny, settings: PostFxCloudSettings): TslAny {
  const height01 = clamp(
    worldPosition.y.sub(settings.bottomMeters).div(settings.topMeters - settings.bottomMeters),
    0,
    1,
  );
  const horizonFade = Math.max(0.001, settings.horizonFade);
  const layerMask = smoothstep(0, horizonFade, height01)
    .mul(inverseSmoothstep(1 - horizonFade, 1, height01));
  const weather = cloudNoise(worldPosition, windOffset);
  const coverage = smoothstep(settings.coverage, 1, weather).mul(1.35);
  const core = cloudNoise(worldPosition.mul(1.91).add(vec3(47.3, 13.1, 91.7)), windOffset.mul(1.35));
  const erosion = float(1).sub(core.mul(0.28));
  return clamp(coverage.mul(layerMask).mul(erosion).mul(settings.density), 0, 1);
}

export function createVolumetricCloudLayerNode(input: VolumetricCloudLayerInput): TslAny {
  const settings = input.settings;
  const steps = settings.steps;
  return Fn((): TslAny => {
    const sceneDepth = input.depthTex.x;
    const isSky = sceneDepth.lessThanEqual(1e-7).or(sceneDepth.greaterThanEqual(0.9999999));
    const sceneViewPosition = getViewPosition(screenUV, sceneDepth, input.projectionInverse) as TslAny;
    const sceneDistance = sceneViewPosition.length();
    const maxDistance = isSky.select(float(settings.maxDistanceMeters), sceneDistance.min(settings.maxDistanceMeters));
    const viewDirV = getViewPosition(screenUV, float(0.5), input.projectionInverse).normalize() as TslAny;
    const dirW = input.cameraWorld.mul(vec4(viewDirV, 0)).xyz.normalize();
    const sunDir = input.sunDirection.normalize();
    const camPos = input.cameraPosition;
    const windOffset = vec2(CLOUD_WIND_DIR[0], CLOUD_WIND_DIR[1]).mul(time.mul(settings.windSpeedMetersPerSecond));

    const tBottom = float(settings.bottomMeters).sub(camPos.y).div(dirW.y);
    const tTop = float(settings.topMeters).sub(camPos.y).div(dirW.y);
    const tEnterRaw = tBottom.min(tTop);
    const tExitRaw = tBottom.max(tTop);
    const insideLayer = camPos.y.greaterThan(settings.bottomMeters).and(camPos.y.lessThan(settings.topMeters));
    const tEnter = insideLayer.select(float(0), tEnterRaw.max(0));
    const tExit = tExitRaw.min(maxDistance).min(settings.maxDistanceMeters);
    const valid = tExit.greaterThan(tEnter).and(dirW.y.abs().greaterThan(1e-4));
    const jitter = hashNoise2(screenUV.mul(vec2(CLOUD_BLUE_NOISE_SCALE[0], CLOUD_BLUE_NOISE_SCALE[1])).add(vec2(time.mul(0.037), time.mul(0.019))));
    const segmentLength = tExit.sub(tEnter).div(steps).max(CLOUD_MIN_STEP_METERS);
    const transmittance = float(1).toVar();
    const radiance = vec3(0).toVar();

    If(valid, () => {
      for (let step = 0; step < steps; step++) {
        const distance = tEnter.add(float(step).add(jitter).mul(segmentLength));
        If(distance.lessThan(tExit), () => {
          const samplePosition = camPos.add(dirW.mul(distance));
          const density = cloudDensity(samplePosition, windOffset, settings);
          If(density.greaterThan(0.002), () => {
            const lightTau = float(0).toVar();
            for (let lightStep = 1; lightStep <= CLOUD_SUN_OCCLUSION_STEPS; lightStep++) {
              const lightPosition = samplePosition.add(sunDir.mul(lightStep * CLOUD_SUN_OCCLUSION_STEP_METERS));
              lightTau.addAssign(cloudDensity(lightPosition, windOffset, settings).mul(CLOUD_SUN_OCCLUSION_STEP_METERS));
            }
            const sunVisibility = exp(lightTau.mul(-settings.absorption));
            const phaseForward = dirW.dot(sunDir).max(0).pow(2.2).mul(0.75).add(0.25);
            const powder = float(1).sub(exp(density.mul(-CLOUD_POWDER_SCALE)));
            const height01 = clamp(
              samplePosition.y.sub(settings.bottomMeters).div(settings.topMeters - settings.bottomMeters),
              0,
              1,
            );
            const skyAmbient = vec3(0.48, 0.62, 0.86).mul(settings.ambientStrength).mul(height01.mul(0.45).add(0.65));
            const sunLight = vec3(1.0, 0.86, 0.62)
              .mul(settings.sunStrength)
              .mul(sunVisibility)
              .mul(phaseForward);
            const source = sunLight.add(skyAmbient).mul(powder.mul(0.75).add(0.25));
            const stepTransmittance = exp(density.mul(segmentLength).mul(-settings.absorption));
            radiance.addAssign(source.mul(transmittance).mul(float(1).sub(stepTransmittance)));
            transmittance.mulAssign(stepTransmittance);
          });
        });
      }
    });

    return vec4(radiance, float(1).sub(transmittance));
  })();
}

export function createVolumetricCloudCompositeNode(input: VolumetricCloudCompositeInput): TslAny {
  return Fn((): TslAny => {
    const cloud = input.cloudTex;
    const alpha = clamp(cloud.a, 0, 1);
    return tslMix(input.sourceRgb, cloud.rgb, alpha);
  })();
}
