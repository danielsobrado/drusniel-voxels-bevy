const VEGETATION_DOMAIN_CHANNEL: u32 = 0x1001u;
const VEGETATION_IDENTITY_CHANNEL: u32 = 0x1003u;

fn treePcg2dU32(cell_x: i32, cell_z: i32, salt: u32) -> vec2<u32> {
  let m = 1664525u;
  let c = 1013904223u;
  let a0 = bitcast<u32>(cell_x + 40000) + (salt & 0x3fffu);
  let b0 = bitcast<u32>(cell_z + 40000) + ((salt >> 14u) & 0x3fffu);
  let a1 = a0 * m + c;
  let b1 = b0 * m + c;
  let a2 = a1 + b1 * m;
  let b2 = b1 + a2 * m;
  let a3 = a2 ^ (a2 >> 16u);
  let b3 = b2 ^ (b2 >> 16u);
  let a4 = a3 + b3 * m;
  let b4 = b3 + a4 * m;
  return vec2<u32>(a4 ^ (a4 >> 16u), b4 ^ (b4 >> 16u));
}

fn treePcg2d01(cell_x: i32, cell_z: i32, salt: u32) -> vec2<f32> {
  let words = treePcg2dU32(cell_x, cell_z, salt);
  let inv = 1.0 / 16777216.0;
  return vec2<f32>(f32(words.x & 0xffffffu), f32(words.y & 0xffffffu)) * inv;
}

fn vegetationStableIdentity(world_seed: u32, category: u32, schema_version: u32, cell: vec2<i32>, class_id: u32) -> vec2<u32> {
  let seed_hash = treePcg2dU32(
    bitcast<i32>(world_seed),
    bitcast<i32>(rotateLeft(world_seed, 16u) ^ schema_version),
    VEGETATION_DOMAIN_CHANNEL ^ category,
  );
  let cell_hash = treePcg2dU32(cell.x, cell.y, seed_hash.x ^ seed_hash.y);
  let identity_channel = VEGETATION_IDENTITY_CHANNEL ^ (class_id * 0x9e3779b9u);
  return treePcg2dU32(bitcast<i32>(cell_hash.x), bitcast<i32>(cell_hash.y), identity_channel ^ seed_hash.y);
}

fn rotateLeft(value: u32, bits: u32) -> u32 {
  let shift = bits & 31u;
  return (value << shift) | (value >> ((32u - shift) & 31u));
}
