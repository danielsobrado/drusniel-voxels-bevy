import * as THREE from "three";
import { uniform, wgslFn } from "three/tsl";
import type { BorderCoastOceanConfig } from "../config/borderCoastOceanConfig.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

export interface CoastOceanTransitionGpu {
  /** x=distance, y=sandy, z=rocky, w=cliff */
  primary: TslNode;
  /** x=cove, y=reef, z=noise, w=near-shore influence */
  secondary: TslNode;
}

export const COAST_OCEAN_TRANSITION_WGSL = `
fn coast_transition_hash(value_in: u32) -> f32 {
  var value = value_in;
  value = value ^ (value >> 16u);
  value = value * 2146121005u;
  value = value ^ (value >> 15u);
  value = value * 2221713035u;
  value = value ^ (value >> 16u);
  return f32(value) / 4294967296.0;
}

fn coast_transition_hash2(cell: vec2<i32>, seed: u32) -> f32 {
  return coast_transition_hash(
    seed
      ^ bitcast<u32>(cell.x * 521288629)
      ^ bitcast<u32>(cell.y * 1597334677),
  );
}

fn coast_transition_noise2(p: vec2<f32>, seed: u32) -> f32 {
  let cell = vec2<i32>(floor(p));
  let fraction = fract(p);
  let blend = fraction * fraction * (vec2<f32>(3.0) - 2.0 * fraction);
  let a = coast_transition_hash2(cell, seed);
  let b = coast_transition_hash2(cell + vec2<i32>(1, 0), seed);
  let c = coast_transition_hash2(cell + vec2<i32>(0, 1), seed);
  let d = coast_transition_hash2(cell + vec2<i32>(1, 1), seed);
  return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
}

fn coast_transition_border(
  world_xz: vec2<f32>,
  bounds: vec4<f32>,
  coast_params: vec4<f32>,
  seed_value: u32,
) -> vec3<f32> {
  let center = vec2<f32>((bounds.x + bounds.y) * 0.5, (bounds.z + bounds.w) * 0.5);
  let half_size = vec2<f32>((bounds.y - bounds.x) * 0.5, (bounds.w - bounds.z) * 0.5);
  let radius = min(max(coast_params.x, 0.0), min(half_size.x, half_size.y));
  let local = world_xz - center;
  let q = abs(local) - (half_size - vec2<f32>(radius));
  let outside = max(q, vec2<f32>(0.0));
  let rectangle_sdf = length(outside) + min(max(q.x, q.y), 0.0) - radius;
  var normal = vec2<f32>(0.0);
  if (q.x > 0.0 && q.y > 0.0) {
    normal = normalize(vec2<f32>(sign(local.x) * q.x, sign(local.y) * q.y));
  } else if (q.x >= q.y) {
    normal = vec2<f32>(select(-1.0, 1.0, local.x >= 0.0), 0.0);
  } else {
    normal = vec2<f32>(0.0, select(-1.0, 1.0, local.y >= 0.0));
  }
  let noise = coast_transition_noise2(world_xz * coast_params.y, seed_value);
  let distance = -rectangle_sdf + (noise * 2.0 - 1.0) * coast_params.z;
  return vec3<f32>(distance, normal);
}

fn coast_transition_perimeter(
  world_xz: vec2<f32>,
  bounds: vec4<f32>,
  normal: vec2<f32>,
) -> f32 {
  let width = bounds.y - bounds.x;
  let height = bounds.w - bounds.z;
  let x = clamp(world_xz.x - bounds.x, 0.0, width);
  let z = clamp(world_xz.y - bounds.z, 0.0, height);
  if (normal.y < 0.0 && abs(normal.y) >= abs(normal.x)) { return x; }
  if (normal.x > 0.0 && abs(normal.x) >= abs(normal.y)) { return width + z; }
  if (normal.y > 0.0 && abs(normal.y) >= abs(normal.x)) {
    return width + height + (width - x);
  }
  return width * 2.0 + height + (height - z);
}

fn coast_transition_type(
  segment_id: i32,
  seed_value: u32,
  configured: vec4<f32>,
  reef_weight: f32,
) -> vec4<f32> {
  let roll = coast_transition_hash(seed_value ^ (u32(segment_id + 1) * 2654435769u));
  let rocky_end = configured.x + configured.y;
  let cliff_end = rocky_end + configured.z;
  let cove_end = cliff_end + configured.w;
  if (roll < configured.x) { return vec4<f32>(1.0, 0.0, 0.0, 0.0); }
  if (roll < rocky_end) { return vec4<f32>(0.0, 1.0, 0.0, 0.0); }
  if (roll < cliff_end) { return vec4<f32>(0.0, 0.0, 1.0, 0.0); }
  if (roll < cove_end) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
  return vec4<f32>(0.0, 0.0, 0.0, select(0.0, 2.0, reef_weight > 0.0));
}

fn coast_transition_primary(
  world_xz: vec2<f32>,
  bounds: vec4<f32>,
  coast_params: vec4<f32>,
  type_weights: vec4<f32>,
  reef_weight: f32,
  seed_value: u32,
) -> vec4<f32> {
  let border = coast_transition_border(world_xz, bounds, coast_params, seed_value);
  let perimeter = 2.0 * ((bounds.y - bounds.x) + (bounds.w - bounds.z));
  let segment_count = max(4.0, round(perimeter / coast_params.w));
  let segment_t = coast_transition_perimeter(world_xz, bounds, border.yz)
    / (perimeter / segment_count) - 0.5;
  let first = i32(floor(segment_t));
  let blend_t = smoothstep(0.0, 1.0, fract(segment_t));
  let a = coast_transition_type(first, seed_value ^ 1831565813u, type_weights, reef_weight);
  let b = coast_transition_type(first + 1, seed_value ^ 1831565813u, type_weights, reef_weight);
  let weights = mix(a, b, blend_t);
  return vec4<f32>(border.x, weights.x, weights.y, weights.z);
}

fn coast_transition_secondary(
  world_xz: vec2<f32>,
  bounds: vec4<f32>,
  coast_params: vec4<f32>,
  type_weights: vec4<f32>,
  reef_weight: f32,
  seed_value: u32,
) -> vec4<f32> {
  let border = coast_transition_border(world_xz, bounds, coast_params, seed_value);
  let perimeter = 2.0 * ((bounds.y - bounds.x) + (bounds.w - bounds.z));
  let segment_count = max(4.0, round(perimeter / coast_params.w));
  let segment_t = coast_transition_perimeter(world_xz, bounds, border.yz)
    / (perimeter / segment_count) - 0.5;
  let first = i32(floor(segment_t));
  let blend_t = smoothstep(0.0, 1.0, fract(segment_t));
  let a = coast_transition_type(first, seed_value ^ 1831565813u, type_weights, reef_weight);
  let b = coast_transition_type(first + 1, seed_value ^ 1831565813u, type_weights, reef_weight);
  let weights = mix(a, b, blend_t);
  let cove = min(weights.w, 1.0);
  let reef = mix(
    select(0.0, 1.0, a.w > 1.0),
    select(0.0, 1.0, b.w > 1.0),
    blend_t,
  );
  let detail_noise = coast_transition_noise2(
    world_xz * (coast_params.y + 0.013),
    seed_value ^ 1374496523u,
  );
  let near_shore = 1.0 - smoothstep(0.0, max(coast_params.z, 1.0) * 2.5, abs(border.x));
  return vec4<f32>(cove, reef, detail_noise, near_shore);
}
`;

const hashFn = wgslFn(functionSource("coast_transition_hash"));
const hash2Fn = wgslFn(functionSource("coast_transition_hash2"), [hashFn] as any);
const noiseFn = wgslFn(functionSource("coast_transition_noise2"), [hash2Fn] as any);
const borderFn = wgslFn(functionSource("coast_transition_border"), [noiseFn] as any);
const perimeterFn = wgslFn(functionSource("coast_transition_perimeter"));
const typeFn = wgslFn(functionSource("coast_transition_type"), [hashFn] as any);
const primaryFn = wgslFn(
  functionSource("coast_transition_primary"),
  [borderFn, perimeterFn, typeFn] as any,
);
const secondaryFn = wgslFn(
  functionSource("coast_transition_secondary"),
  [borderFn, perimeterFn, typeFn, noiseFn] as any,
);

export function createCoastOceanTransitionGpu(
  worldXZ: TslNode,
  config: BorderCoastOceanConfig,
  seed: number,
): CoastOceanTransitionGpu {
  const bounds = uniform(new THREE.Vector4(
    config.world.bounds.min_x,
    config.world.bounds.max_x,
    config.world.bounds.min_z,
    config.world.bounds.max_z,
  ));
  const coastParams = uniform(new THREE.Vector4(
    config.coast.band.corner_rounding_m,
    config.coast.band.coastline_noise_scale,
    config.coast.band.coastline_noise_strength_m,
    config.coast.band.segment_length_m,
  ));
  const typeWeights = uniform(new THREE.Vector4(
    config.coast.type_weights.sandy_beach,
    config.coast.type_weights.rocky_beach,
    config.coast.type_weights.cliff,
    config.coast.type_weights.cove,
  ));
  const transitionSeed = (seed ^ config.coast.seed_offset) >>> 0;
  const params = {
    world_xz: worldXZ,
    bounds,
    coast_params: coastParams,
    type_weights: typeWeights,
    reef_weight: config.coast.type_weights.reef,
    seed_value: transitionSeed,
  };
  return {
    primary: primaryFn(params),
    secondary: secondaryFn(params),
  };
}

function functionSource(name: string): string {
  const signature = `fn ${name}`;
  const start = COAST_OCEAN_TRANSITION_WGSL.indexOf(signature);
  if (start < 0) throw new Error(`Missing transition WGSL function '${name}'`);
  const bodyStart = COAST_OCEAN_TRANSITION_WGSL.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < COAST_OCEAN_TRANSITION_WGSL.length; index += 1) {
    if (COAST_OCEAN_TRANSITION_WGSL[index] === "{") depth += 1;
    else if (COAST_OCEAN_TRANSITION_WGSL[index] === "}") {
      depth -= 1;
      if (depth === 0) return COAST_OCEAN_TRANSITION_WGSL.slice(start, index + 1);
    }
  }
  throw new Error(`Unterminated transition WGSL function '${name}'`);
}
