import * as THREE from "three";
import {
  clamp,
  float,
  fract,
  max,
  mix,
  smoothstep,
  tan,
  texture,
  texture3D,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import { readActiveEnvironmentQuery } from "../environment_query/runtime.js";
import { sampleActiveForestCanopyEcology } from "../forest_lighting/forest_lighting_texture.js";
import { readActiveProbeGiRuntime } from "../lighting/probe_gi/runtime.js";
import { surfaceHeight } from "../terrain/terrain.js";
import type { WaterMaterialParams } from "./water_material_types.js";
import type { WaterVisualConfig } from "./waterConfig.js";
import { encodeWaterHorizonSlope } from "./water_ssr_miss_route_math.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const HORIZON_RESOLUTION = 16;
const HORIZON_CELL_SIZE_M = 12;
const HORIZON_SAMPLE_DISTANCES_M = [16, 40, 80] as const;
const HORIZON_CELLS_PER_UPDATE = 8;
const HORIZON_REBUILD_DISTANCE_M = 12;
const PROBE_LAYER_UV = (2 + 0.5) / 8;

interface HorizonField {
  readonly texture: THREE.DataTexture;
  readonly data: Uint8Array;
  readonly origin: THREE.Vector2;
  readonly refs: { value: number };
  centerX: number;
  centerZ: number;
  cursor: number;
}

interface ProbeNodes {
  readonly r: TslNode;
  readonly g: TslNode;
  readonly b: TslNode;
  readonly bounds: TslNode;
  readonly meta: TslNode;
}

export interface WaterSsrMissRoute {
  sample(worldPosition: TslNode, reflectionDirection: TslNode): TslNode;
  updateCamera(position: THREE.Vector3): void;
  setDebugMode(mode: number): void;
  updateVisual(visual: WaterVisualConfig): void;
  dispose(): void;
}

let sharedHorizonField: HorizonField | null = null;

export function createWaterSsrMissRoute(params: WaterMaterialParams): WaterSsrMissRoute {
  const horizon = acquireHorizonField();
  const uHorizonOriginSpan = uniform(new THREE.Vector4(0, 0, 1, 1)) as TslNode;
  const uTerrainStrength = uniform(params.visual.reflection.terrainFallbackStrength) as TslNode;
  const uSkyStrength = uniform(params.visual.reflection.skyFallbackStrength) as TslNode;
  const uProbeConfidence = uniform(0) as TslNode;
  const uRouteEnabled = uniform(1) as TslNode;
  const probeFallback = createProbeFallbackTexture();
  const probes: ProbeNodes[] = Array.from({ length: 3 }, () => ({
    r: texture3D(probeFallback, vec3(0.5), 0) as TslNode,
    g: texture3D(probeFallback, vec3(0.5), 0) as TslNode,
    b: texture3D(probeFallback, vec3(0.5), 0) as TslNode,
    bounds: uniform(new THREE.Vector4()) as TslNode,
    meta: uniform(new THREE.Vector4()) as TslNode,
  }));

  publishMissRouteCounters(false);

  return {
    sample(worldPosition, reflectionDirection) {
      const horizontalLength: TslNode = max(reflectionDirection.xz.length(), float(0.0001));
      const reflectionSlope: TslNode = reflectionDirection.y.div(horizontalLength);
      const horizonUv: TslNode = worldPosition.xz.sub(uHorizonOriginSpan.xy).div(uHorizonOriginSpan.zw);
      const horizonSample: TslNode = texture(horizon.texture, clamp(horizonUv, vec2(0), vec2(1)));
      const absX: TslNode = reflectionDirection.x.abs();
      const absZ: TslNode = reflectionDirection.z.abs();
      const axisWeight: TslNode = absX.div(max(absX.add(absZ), float(0.0001)));
      const horizonX: TslNode = reflectionDirection.x.greaterThanEqual(0).select(horizonSample.r, horizonSample.g);
      const horizonZ: TslNode = reflectionDirection.z.greaterThanEqual(0).select(horizonSample.b, horizonSample.a);
      const horizonSlope: TslNode = tan(mix(horizonZ, horizonX, axisWeight).mul(1.2).sub(0.15));
      const openMask: TslNode = smoothstep(horizonSlope.add(0.02), horizonSlope.add(0.12), reflectionSlope)
        .mul(reflectionDirection.y.greaterThan(float(-0.02)).select(1, 0));
      const atmosphere: TslNode = directionalAtmosphere(reflectionDirection).mul(uSkyStrength);
      const probeGi: TslNode = sampleDirectionalProbeGi(worldPosition, reflectionDirection, probes);
      const terrainFallback: TslNode = vec3(0.07, 0.095, 0.065).mul(uTerrainStrength);
      const blocked: TslNode = mix(terrainFallback, probeGi, uProbeConfidence);
      return mix(vec3(0), mix(blocked, atmosphere, openMask), uRouteEnabled);
    },
    updateCamera(position) {
      updateSharedHorizonField(horizon, position.x, position.z);
      stepSharedHorizonField(horizon, HORIZON_CELLS_PER_UPDATE);
      const span = HORIZON_RESOLUTION * HORIZON_CELL_SIZE_M;
      uHorizonOriginSpan.value.set(horizon.origin.x, horizon.origin.y, span, span);
      const ready = syncProbeGi(probes);
      uProbeConfidence.value = ready ? 1 : 0;
      publishMissRouteCounters(ready);
    },
    setDebugMode(mode) {
      uRouteEnabled.value = mode === 0 ? 1 : 0;
    },
    updateVisual(visual) {
      uTerrainStrength.value = visual.reflection.terrainFallbackStrength;
      uSkyStrength.value = visual.reflection.skyFallbackStrength;
    },
    dispose() {
      releaseHorizonField(horizon);
      probeFallback.dispose();
    },
  };
}

function directionalAtmosphere(direction: TslNode): TslNode {
  const y: TslNode = clamp(direction.y, -1, 1);
  const horizon: TslNode = vec3(0.68, 0.58, 0.48);
  const zenith: TslNode = vec3(0.12, 0.32, 0.72);
  const ground: TslNode = vec3(0.035, 0.065, 0.12);
  return y.greaterThan(0).select(
    mix(horizon, zenith, smoothstep(0, 0.65, y)),
    mix(ground, horizon.mul(0.35), smoothstep(-0.6, 0, y)),
  );
}

function sampleDirectionalProbeGi(
  world: TslNode,
  direction: TslNode,
  cascades: readonly ProbeNodes[],
): TslNode {
  let result: TslNode = vec3(0.07, 0.09, 0.06);
  for (let index = cascades.length - 1; index >= 0; index--) {
    const cascade = cascades[index]!;
    const inside: TslNode = world.x.greaterThanEqual(cascade.bounds.x)
      .and(world.z.greaterThanEqual(cascade.bounds.y))
      .and(world.x.lessThan(cascade.bounds.x.add(cascade.bounds.z)))
      .and(world.z.lessThan(cascade.bounds.y.add(cascade.bounds.w)))
      .and(cascade.meta.w.greaterThan(0.5));
    const cellX: TslNode = world.x.div(cascade.meta.x);
    const cellZ: TslNode = world.z.div(cascade.meta.x);
    const uv: TslNode = vec3(
      fract(fract(cellX.add(0.5).div(cascade.meta.y)).add(1)),
      float(PROBE_LAYER_UV),
      fract(fract(cellZ.add(0.5).div(cascade.meta.z)).add(1)),
    );
    cascade.r.uvNode = uv;
    cascade.g.uvNode = uv;
    cascade.b.uvNode = uv;
    const evaluate = (coefficients: TslNode): TslNode => coefficients.x
      .add(coefficients.y.mul(direction.x))
      .add(coefficients.z.mul(direction.y))
      .add(coefficients.w.mul(direction.z));
    const irradiance: TslNode = max(
      vec3(evaluate(cascade.r), evaluate(cascade.g), evaluate(cascade.b)),
      vec3(0),
    );
    result = inside.select(irradiance, result);
  }
  return result;
}

function syncProbeGi(probes: readonly ProbeNodes[]): boolean {
  const runtime = readActiveProbeGiRuntime();
  if (!runtime) return false;
  runtime.cascades.forEach((cascade, index) => {
    const target = probes[index]!;
    const published = runtime.publication.read(cascade.config.id).active;
    target.r.value = published.shR;
    target.g.value = published.shG;
    target.b.value = published.shB;
    target.bounds.value.set(
      cascade.origin.worldX,
      cascade.origin.worldZ,
      cascade.config.dimensions[0] * cascade.config.spacingM,
      cascade.config.dimensions[2] * cascade.config.spacingM,
    );
    target.meta.value.set(
      cascade.config.spacingM,
      cascade.config.dimensions[0],
      cascade.config.dimensions[2],
      1,
    );
  });
  return readProbeGiRadianceReady();
}

function acquireHorizonField(): HorizonField {
  if (!sharedHorizonField) {
    const data = new Uint8Array(HORIZON_RESOLUTION * HORIZON_RESOLUTION * 4);
    const textureValue = new THREE.DataTexture(
      data,
      HORIZON_RESOLUTION,
      HORIZON_RESOLUTION,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    textureValue.name = "water-reflection-directional-horizon";
    textureValue.wrapS = THREE.ClampToEdgeWrapping;
    textureValue.wrapT = THREE.ClampToEdgeWrapping;
    textureValue.minFilter = THREE.LinearFilter;
    textureValue.magFilter = THREE.LinearFilter;
    textureValue.colorSpace = THREE.NoColorSpace;
    textureValue.needsUpdate = true;
    sharedHorizonField = {
      texture: textureValue,
      data,
      origin: new THREE.Vector2(),
      refs: { value: 0 },
      centerX: Number.NaN,
      centerZ: Number.NaN,
      cursor: data.length / 4,
    };
  }
  sharedHorizonField.refs.value++;
  return sharedHorizonField;
}

function releaseHorizonField(field: HorizonField): void {
  field.refs.value = Math.max(0, field.refs.value - 1);
  if (field.refs.value > 0 || sharedHorizonField !== field) return;
  field.texture.dispose();
  sharedHorizonField = null;
}

function updateSharedHorizonField(field: HorizonField, centerX: number, centerZ: number): void {
  if (Math.hypot(centerX - field.centerX, centerZ - field.centerZ) < HORIZON_REBUILD_DISTANCE_M) return;
  const span = HORIZON_RESOLUTION * HORIZON_CELL_SIZE_M;
  field.centerX = centerX;
  field.centerZ = centerZ;
  field.origin.set(
    Math.floor(centerX / HORIZON_CELL_SIZE_M) * HORIZON_CELL_SIZE_M - span * 0.5,
    Math.floor(centerZ / HORIZON_CELL_SIZE_M) * HORIZON_CELL_SIZE_M - span * 0.5,
  );
  field.data.fill(0);
  field.texture.needsUpdate = true;
  field.cursor = 0;
}

function stepSharedHorizonField(field: HorizonField, maximumCells: number): void {
  const query = readActiveEnvironmentQuery();
  let processed = 0;
  while (field.cursor < HORIZON_RESOLUTION * HORIZON_RESOLUTION && processed < maximumCells) {
    const cell = field.cursor++;
    const xIndex = cell % HORIZON_RESOLUTION;
    const zIndex = Math.floor(cell / HORIZON_RESOLUTION);
    const x = field.origin.x + (xIndex + 0.5) * HORIZON_CELL_SIZE_M;
    const z = field.origin.y + (zIndex + 0.5) * HORIZON_CELL_SIZE_M;
    const terrainHeight = query?.surfaceHeightBestEffort(x, z, HORIZON_CELL_SIZE_M).height ?? surfaceHeight(x, z);
    const water = query?.water(x, z, HORIZON_CELL_SIZE_M);
    const baseHeight = water?.meta.valid && water.depth > 0.01 ? water.waterY : terrainHeight;
    const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
    for (let channel = 0; channel < directions.length; channel++) {
      const [dx, dz] = directions[channel]!;
      let maximumSlope = -0.1;
      for (const distanceM of HORIZON_SAMPLE_DISTANCES_M) {
        const sampleX = x + dx * distanceM;
        const sampleZ = z + dz * distanceM;
        const terrain = query?.surfaceHeightBestEffort(sampleX, sampleZ, distanceM).height ?? surfaceHeight(sampleX, sampleZ);
        const canopy = sampleActiveForestCanopyEcology(sampleX, sampleZ);
        const canopyTop = (canopy?.canopyHeightM ?? 0) * (canopy?.canopyDensity ?? 0);
        maximumSlope = Math.max(maximumSlope, (terrain + canopyTop - baseHeight) / distanceM);
      }
      field.data[cell * 4 + channel] = Math.round(encodeWaterHorizonSlope(maximumSlope) * 255);
    }
    processed++;
  }
  if (processed > 0) field.texture.needsUpdate = true;
}

function createProbeFallbackTexture(): THREE.Data3DTexture {
  const textureValue = new THREE.Data3DTexture(new Uint16Array(4), 1, 1, 1);
  textureValue.format = THREE.RGBAFormat;
  textureValue.type = THREE.HalfFloatType;
  textureValue.minFilter = THREE.LinearFilter;
  textureValue.magFilter = THREE.LinearFilter;
  textureValue.needsUpdate = true;
  return textureValue;
}

function readProbeGiRadianceReady(): boolean {
  const counters = (globalThis as typeof globalThis & {
    window?: { __drusnielClod?: { stats?: { counters?: Record<string, number> } } };
  }).window?.__drusnielClod?.stats?.counters;
  return (counters?.["probe_gi_radiance_ready"] ?? 0) > 0;
}

function publishMissRouteCounters(probeReady: boolean): void {
  const counters = (globalThis as typeof globalThis & {
    window?: { __drusnielClod?: { stats?: { counters?: Record<string, number> } } };
  }).window?.__drusnielClod?.stats?.counters;
  if (!counters) return;
  counters["water_ssr_miss_constant_blend"] = 0;
  counters["water_ssr_miss_horizon_test"] = 1;
  counters["water_ssr_miss_atmosphere_open"] = 1;
  counters["water_ssr_miss_directional_probe_gi"] = 1;
  counters["water_ssr_miss_probe_gi_ready"] = probeReady ? 1 : 0;
  counters["water_ssr_miss_exact_hit_authority"] = 1;
  counters["water_ssr_miss_duplicate_depth_trace"] = 0;
}
