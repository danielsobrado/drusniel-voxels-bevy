const VEGETATION_SCHEMA_VERSION: u32 = 1u;
const VEGETATION_TREE_CATEGORY: u32 = 1u;
const VEGETATION_GRASS_CATEGORY: u32 = 2u;
const VEGETATION_UNDERSTORY_CATEGORY: u32 = 3u;
const VEGETATION_STONE_CATEGORY: u32 = 4u;
const VEGETATION_DRESSING_CATEGORY: u32 = 5u;

const VEGETATION_DOMAIN_CHANNEL: u32 = 0x1001u;
const VEGETATION_CLUSTER_ID_CHANNEL: u32 = 0x1002u;
const VEGETATION_IDENTITY_CHANNEL: u32 = 0x1003u;
const VEGETATION_JITTER_CHANNEL: u32 = 0x1004u;
const VEGETATION_CLASS_CHANNEL: u32 = 0x1005u;
const VEGETATION_SCALE_CHANNEL: u32 = 0x1006u;
const VEGETATION_ROTATION_CHANNEL: u32 = 0x1007u;
const VEGETATION_WIND_CHANNEL: u32 = 0x1008u;
const VEGETATION_AGE_CHANNEL: u32 = 0x1009u;
const VEGETATION_HEALTH_CHANNEL: u32 = 0x100au;

fn vegetationValueHash(
  world_seed: u32,
  category: u32,
  schema_version: u32,
  cell: vec2<i32>,
  channel: u32,
) -> vec2<u32> {
  let seed_hash = treePcg2dU32(
    bitcast<i32>(world_seed),
    bitcast<i32>(rotateLeft(world_seed, 16u) ^ schema_version),
    VEGETATION_DOMAIN_CHANNEL ^ category,
  );
  let cell_hash = treePcg2dU32(cell.x, cell.y, seed_hash.x ^ seed_hash.y);
  return treePcg2dU32(bitcast<i32>(cell_hash.x), bitcast<i32>(cell_hash.y), channel ^ seed_hash.y);
}

fn vegetationStableIdentity(
  world_seed: u32,
  category: u32,
  schema_version: u32,
  cell: vec2<i32>,
  class_id: u32,
) -> vec2<u32> {
  let identity_channel = VEGETATION_IDENTITY_CHANNEL ^ (class_id * 0x9e3779b9u);
  return vegetationValueHash(world_seed, category, schema_version, cell, identity_channel);
}

fn vegetationClusterId(
  world_seed: u32,
  category: u32,
  schema_version: u32,
  cluster: vec2<i32>,
) -> vec2<u32> {
  return vegetationValueHash(world_seed, category, schema_version, cluster, VEGETATION_CLUSTER_ID_CHANNEL);
}
