import {
  Fn,
  If,
  clamp,
  dot,
  exp,
  float,
  floor,
  fract,
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

const CLOUD_BASE_NOISE_SCALE = 0.00052;
const CLOUD_VERTICAL_SCALE_MULT = 1.6;
const CLOUD_LACUNARITY = 2.17;
const CLOUD_EROSION_SCALE_MULT = 5.9;
const CLOUD_EROSION_STRENGTH = 0.38;
const CLOUD_COVERAGE_SOFTNESS = 0.30;
const CLOUD_WARP_NOISE_SCALE = 0.00013;
const CLOUD_WARP_METERS = 520;
const CLOUD_WARP_DIR = [0.62, 0.31, 0.72] as const;
const CLOUD_BLUE_NOISE_SCALE = [132.37, 77.17] as const;
const CLOUD_WIND_DIR = [0.821, 0.571] as const;
const CLOUD_MIN_STEP_METERS = 8.0;
const CLOUD_SUN_OCCLUSION_STEPS = 3;
const CLOUD_SUN_OCCLUSION_STEP_METERS = 160;
const CLOUD_POWDER_SCALE = 18;

function hashNoise2(uv: TslAny): TslAny {
  return dot(uv, vec2(12.9898, 78.233)).sin().mul(43758.5453).fract();
}

const tslMix = mix as unknown as (a: TslAny, b: TslAny, amount: TslAny) => TslAny;

function hashNoise3(p: TslAny): TslAny {
  const q = fract(p.mul(vec3(0.1031, 0.103, 0.0973))) as TslAny;
  const mixed = q.add(dot(q, q.yzx.add(33.33))) as TslAny;
  return fract(mixed.x.add(mixed.y).mul(mixed.z));
}

function valueNoise3(p: TslAny): TslAny {
  const cell = floor(p) as TslAny;
  const offset = fract(p) as TslAny;
  const blend = offset.mul(offset).mul(float(3).sub(offset.mul(2))) as TslAny;
  const a = hashNoise3(cell);
  const b = hashNoise3(cell.add(vec3(1, 0, 0)));
  const c = hashNoise3(cell.add(vec3(0, 1, 0)));
  const d = hashNoise3(cell.add(vec3(1, 1, 0)));
  const e = hashNoise3(cell.add(vec3(0, 0, 1)));
  const f = hashNoise3(cell.add(vec3(1, 0, 1)));
  const g = hashNoise3(cell.add(vec3(0, 1, 1)));
  const h = hashNoise3(cell.add(vec3(1, 1, 1)));
  const low = tslMix(tslMix(a, b, blend.x), tslMix(c, d, blend.x), blend.y);
  const high = tslMix(tslMix(e, f, blend.x), tslMix(g, h, blend.x), blend.y);
  return tslMix(low, high, blend.z);
}

// Skewed rotations between octaves so no two octaves share aligned lattice axes;
// aligned axes are what exposed the value-noise cells as an egg-crate ceiling.
function rotateOctaveDomain(p: TslAny): TslAny {
  return vec3(
    p.x.mul(0.80).add(p.z.mul(0.60)).add(19.19),
    p.y.sub(p.x.mul(0.23)).add(7.71),
    p.z.mul(0.80).sub(p.x.mul(0.60)).add(5.31),
  );
}

function rotateErosionDomain(p: TslAny): TslAny {
  return vec3(
    p.x.mul(0.36).sub(p.y.mul(0.48)).add(p.z.mul(0.80)).add(31.7),
    p.x.mul(0.80).add(p.y.mul(0.60)).add(11.3),
    p.x.mul(0.48).sub(p.y.mul(0.64)).sub(p.z.mul(0.60)).add(3.9),
  );
}

function fbm3(p: TslAny): TslAny {
  const o1 = valueNoise3(p);
  const p2 = rotateOctaveDomain(p.mul(CLOUD_LACUNARITY));
  const o2 = valueNoise3(p2);
  const p3 = rotateOctaveDomain(p2.mul(CLOUD_LACUNARITY));
  const o3 = valueNoise3(p3);
  return o1.mul(0.5333).add(o2.mul(0.2667)).add(o3.mul(0.1333));
}

function fbm2(p: TslAny): TslAny {
  const o1 = valueNoise3(p);
  const o2 = valueNoise3(rotateOctaveDomain(p.mul(CLOUD_LACUNARITY)));
  return o1.mul(0.6667).add(o2.mul(0.3333));
}

function cloudLayerMask(worldPosition: TslAny, settings: PostFxCloudSettings): TslAny {
  const height01 = clamp(
    worldPosition.y.sub(settings.bottomMeters).div(settings.topMeters - settings.bottomMeters),
    0,
    1,
  );
  const horizonFade = Math.max(0.001, settings.horizonFade);
  return smoothstep(0, horizonFade, height01)
    .mul(inverseSmoothstep(1 - horizonFade, 1, height01));
}

function cloudBaseDomain(worldPosition: TslAny, windOffset: TslAny): TslAny {
  const advected = worldPosition.sub(vec3(windOffset.x, 0, windOffset.y));
  return advected.mul(vec3(
    CLOUD_BASE_NOISE_SCALE,
    CLOUD_BASE_NOISE_SCALE * CLOUD_VERTICAL_SCALE_MULT,
    CLOUD_BASE_NOISE_SCALE,
  ));
}

function cloudCoverageSignal(shape: TslAny, settings: PostFxCloudSettings): TslAny {
  return smoothstep(settings.coverage, Math.min(1, settings.coverage + CLOUD_COVERAGE_SOFTNESS), shape);
}

function cloudDensity(worldPosition: TslAny, windOffset: TslAny, settings: PostFxCloudSettings): TslAny {
  const layerMask = cloudLayerMask(worldPosition, settings);
  const advected = worldPosition.sub(vec3(windOffset.x, 0, windOffset.y));
  const warpNoise = valueNoise3(advected.mul(CLOUD_WARP_NOISE_SCALE).add(vec3(101.3, 57.7, 23.1)));
  const warped = advected
    .add(vec3(...CLOUD_WARP_DIR).mul(warpNoise.sub(0.5).mul(CLOUD_WARP_METERS)))
    .mul(vec3(
      CLOUD_BASE_NOISE_SCALE,
      CLOUD_BASE_NOISE_SCALE * CLOUD_VERTICAL_SCALE_MULT,
      CLOUD_BASE_NOISE_SCALE,
    ));
  const cover = cloudCoverageSignal(fbm3(warped), settings).mul(layerMask);
  const density = float(0).toVar();
  If(cover.greaterThan(0.002), () => {
    const erosion = fbm2(rotateErosionDomain(warped.mul(CLOUD_EROSION_SCALE_MULT)));
    const eroded = cover.sub(erosion.mul(CLOUD_EROSION_STRENGTH).mul(float(1).sub(cover))).max(0);
    density.assign(clamp(eroded.mul(settings.density), 0, 1));
  });
  return density;
}

// Two-octave, no-warp, no-erosion density for the sun occlusion march.
function cloudDensityCheap(worldPosition: TslAny, windOffset: TslAny, settings: PostFxCloudSettings): TslAny {
  const layerMask = cloudLayerMask(worldPosition, settings);
  const shape = fbm2(cloudBaseDomain(worldPosition, windOffset));
  return clamp(cloudCoverageSignal(shape, settings).mul(layerMask).mul(settings.density), 0, 1);
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
    // Static per-pixel jitter: a time-varying pattern here crawls visibly because
    // the cloud pass has no dedicated temporal reprojection.
    const jitter = hashNoise2(screenUV.mul(vec2(CLOUD_BLUE_NOISE_SCALE[0], CLOUD_BLUE_NOISE_SCALE[1])));
    const segmentLength = tExit.sub(tEnter).div(steps).max(CLOUD_MIN_STEP_METERS);
    const transmittance = float(1).toVar();
    const radiance = vec3(0).toVar();

    If(valid, () => {
      for (let step = 0; step < steps; step++) {
        const distance = tEnter.add(float(step).add(jitter).mul(segmentLength));
        If(distance.lessThan(tExit).and(transmittance.greaterThan(0.02)), () => {
          const samplePosition = camPos.add(dirW.mul(distance));
          const density = cloudDensity(samplePosition, windOffset, settings);
          If(density.greaterThan(0.002), () => {
            const lightTau = float(0).toVar();
            for (let lightStep = 1; lightStep <= CLOUD_SUN_OCCLUSION_STEPS; lightStep++) {
              const lightPosition = samplePosition.add(sunDir.mul(lightStep * CLOUD_SUN_OCCLUSION_STEP_METERS));
              lightTau.addAssign(cloudDensityCheap(lightPosition, windOffset, settings).mul(CLOUD_SUN_OCCLUSION_STEP_METERS));
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

export function compositePremultipliedCloudReference(
  sourceRgb: readonly [number, number, number],
  cloudRgb: readonly [number, number, number],
  alpha: number,
): [number, number, number] {
  const opacity = Math.max(0, Math.min(1, alpha));
  return [
    sourceRgb[0] * (1 - opacity) + cloudRgb[0],
    sourceRgb[1] * (1 - opacity) + cloudRgb[1],
    sourceRgb[2] * (1 - opacity) + cloudRgb[2],
  ];
}

export function createVolumetricCloudCompositeNode(input: VolumetricCloudCompositeInput): TslAny {
  return Fn((): TslAny => {
    const cloud = input.cloudTex;
    const alpha = clamp(cloud.a, 0, 1);
    return input.sourceRgb.mul(float(1).sub(alpha)).add(cloud.rgb);
  })();
}
