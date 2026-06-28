const BIOME_MEADOWS : u32 = 0u;
const BIOME_FOREST : u32 = 1u;
const BIOME_SWAMP : u32 = 2u;
const BIOME_MOUNTAIN : u32 = 3u;
const BIOME_PLAINS : u32 = 4u;
const BIOME_COAST : u32 = 5u;
const BIOME_OCEAN : u32 = 6u;

fn biomeMix32(value_in : u32) -> u32 {
  var mixed = value_in;
  mixed = mixed ^ (mixed >> 16u);
  mixed = mixed * 0x7feb352du;
  mixed = mixed ^ (mixed >> 15u);
  mixed = mixed * 0x846ca68bu;
  mixed = mixed ^ (mixed >> 16u);
  return mixed;
}

fn biomePcg2d(x : i32, z : i32, seed : i32) -> f32 {
  let value = bitcast<u32>(seed)
    ^ bitcast<u32>(x * 0x1f123bb5)
    ^ bitcast<u32>(z * 0x5f356495);
  return f32(biomeMix32(value)) / 4294967296.0;
}

fn biomeSmooth01(value : f32) -> f32 {
  let t = clamp(value, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn biomeRegionNoise(x : f32, z : f32, cellM : f32, seed : i32) -> f32 {
  let gx = x / cellM;
  let gz = z / cellM;
  let x0 = i32(floor(gx));
  let z0 = i32(floor(gz));
  let tx = biomeSmooth01(gx - floor(gx));
  let tz = biomeSmooth01(gz - floor(gz));
  let a = biomePcg2d(x0, z0, seed);
  let b = biomePcg2d(x0 + 1, z0, seed);
  let c = biomePcg2d(x0, z0 + 1, seed);
  let d = biomePcg2d(x0 + 1, z0 + 1, seed);
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

fn classifyBiomeRegion(
  worldX : f32,
  worldZ : f32,
  height : f32,
  seaLevel : f32,
  seed : i32,
  islandMask : f32,
  shoreDistanceM : f32,
  nearestCenterX : f32,
  nearestCenterZ : f32,
  islandRadiusM : f32,
) -> u32 {
  if (height < seaLevel - 1.5 || islandMask < 0.08) { return BIOME_OCEAN; }
  if (abs(height - seaLevel) < 4.0 || shoreDistanceM < 42.0) { return BIOME_COAST; }
  let n = biomeRegionNoise(worldX, worldZ, 420.0, seed + 711);
  let islandDistanceT = clamp(
    distance(vec2<f32>(worldX, worldZ), vec2<f32>(nearestCenterX, nearestCenterZ)) / max(1.0, islandRadiusM),
    0.0,
    1.0,
  );
  if (height >= seaLevel + 68.0) { return BIOME_MOUNTAIN; }
  if (height <= seaLevel + 8.0 && n < 0.42) { return BIOME_SWAMP; }
  if (islandDistanceT > 0.72 && n > 0.58) { return BIOME_PLAINS; }
  if (n > 0.46) { return BIOME_FOREST; }
  return BIOME_MEADOWS;
}
