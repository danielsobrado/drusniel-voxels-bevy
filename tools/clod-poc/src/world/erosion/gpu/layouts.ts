export const EROSION_COMMON_WGSL = /* wgsl */ `
struct StateA {
  height: i32,
  hardness: u32,
  water: u32,
  sediment: u32,
  deposition: i32,
  velocity_x: i32,
  velocity_z: i32,
};

struct StateB {
  flux_left: u32,
  flux_right: u32,
  flux_up: u32,
  flux_down: u32,
  capacity: u32,
  thermal_delta: atomic<i32>,
};

struct Params {
  grid: vec4<u32>,
  rain: vec4<u32>,
  water: vec4<u32>,
  sediment: vec4<u32>,
  geometry: vec4<u32>,
};

@group(0) @binding(0) var<storage, read_write> state_a: array<StateA>;
@group(0) @binding(1) var<storage, read_write> state_b: array<StateB>;
@group(0) @binding(2) var<storage, read_write> sediment_scratch: array<atomic<u32>>;
@group(0) @binding(3) var<uniform> params: Params;
@group(0) @binding(4) var<storage, read> talus_table: array<u32>;
@group(0) @binding(5) var<storage, read_write> output_data: array<vec4<u32>>;

const Q16_ONE: u32 = 65536u;
const VELOCITY_SCALE: i32 = 4096;
const HARDNESS_MAX: u32 = 65535u;

fn cell_index(x: u32, z: u32) -> u32 { return z * params.grid.x + x; }
fn in_grid(x: u32, z: u32) -> bool { return x < params.grid.x && z < params.grid.y; }
fn in_interior(x: u32, z: u32) -> bool {
  let border = params.grid.z;
  return x >= border && z >= border && x < params.grid.x - border && z < params.grid.y - border;
}

fn mul_wide(a: u32, b: u32) -> vec2<u32> {
  let a0 = a & 65535u;
  let a1 = a >> 16u;
  let b0 = b & 65535u;
  let b1 = b >> 16u;
  let p0 = a0 * b0;
  let p1 = a1 * b0 + a0 * b1;
  let p2 = a1 * b1;
  let carry = (p0 >> 16u) + (p1 & 65535u);
  let lo = (p0 & 65535u) | ((carry & 65535u) << 16u);
  let hi = p2 + (p1 >> 16u) + (carry >> 16u);
  return vec2<u32>(lo, hi);
}

fn mul_q16(value: u32, factor: u32) -> u32 {
  let product = mul_wide(value, factor);
  if ((product.y >> 16u) != 0u) { return 4294967295u; }
  return (product.y << 16u) | (product.x >> 16u);
}

fn add_sat_u32(a: u32, b: u32) -> u32 {
  let sum = a + b;
  return select(sum, 4294967295u, sum < a);
}

fn sum4_exceeds(a: u32, b: u32, c: u32, d: u32, limit: u32) -> bool {
  let ab = a + b;
  if (ab < a) { return true; }
  let cd = c + d;
  if (cd < c) { return true; }
  let total = ab + cd;
  return total < ab || total > limit;
}

fn ratio_q16_small(numerator: u32, denominator: u32) -> u32 {
  if (denominator == 0u) { return 4294967295u; }
  return (min(numerator, 65535u) * Q16_ONE) / denominator;
}

fn hash_u32(seed: u32, x: u32, z: u32, iteration: u32) -> u32 {
  var value = seed ^ (x * 0x9e3779b1u) ^ (z * 0x85ebca77u) ^ (iteration * 0xc2b2ae3du);
  value = value ^ (value >> 16u);
  value = value * 0x7feb352du;
  value = value ^ (value >> 15u);
  value = value * 0x846ca68bu;
  value = value ^ (value >> 16u);
  return value;
}

fn approximate_hypot(x: i32, z: i32) -> u32 {
  let ax = u32(abs(x));
  let az = u32(abs(z));
  let high = max(ax, az);
  let low = min(ax, az);
  return high + (low >> 1u);
}

fn bilinear_weight_q16(fx: u32, fz: u32, corner_x: u32, corner_z: u32) -> u32 {
  let wx = select(4096u - fx, fx, corner_x == 1u);
  let wz = select(4096u - fz, fz, corner_z == 1u);
  return (wx * wz) >> 8u;
}
`;

export function createErosionBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    label: "erosion-bind-group-layout",
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: 80 } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
    ],
  });
}
