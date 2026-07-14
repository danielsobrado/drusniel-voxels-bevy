const BIOME_MEADOWS : u32 = 0u;
const BIOME_FOREST : u32 = 1u;
const BIOME_SWAMP : u32 = 2u;
const BIOME_MOUNTAIN : u32 = 3u;
const BIOME_PLAINS : u32 = 4u;
const BIOME_COAST : u32 = 5u;
const BIOME_OCEAN : u32 = 6u;

struct BiomeRegionContract {
  regionCellM : f32,
  oceanHeightMarginM : f32,
  oceanIslandMaskMax : f32,
  coastHeightBandM : f32,
  coastShoreDistanceM : f32,
  mountainHeightAboveSeaM : f32,
  swampHeightAboveSeaM : f32,
  swampNoiseMax : f32,
  plainsDistanceMin : f32,
  plainsNoiseMin : f32,
  forestNoiseMin : f32,
};

fn defaultBiomeRegionContract() -> BiomeRegionContract {
  return BiomeRegionContract(
    420.0,
    1.5,
    0.08,
    4.0,
    42.0,
    48.0,
    8.0,
    0.42,
    0.72,
    0.58,
    0.46,
  );
}

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

fn biomeSmoothstepRange(edge0 : f32, edge1 : f32, value : f32) -> f32 {
  let denom = edge1 - edge0;
  if (abs(denom) <= 1.1920929e-7) {
    if (value >= edge1) { return 1.0; }
    return 0.0;
  }
  return biomeSmooth01((value - edge0) / denom);
}

fn biomeHashPositionSeeded(x : i32, z : i32, seed : i32) -> f32 {
  var n : i32 = x * 374761393 + z * 668265263 + seed * 1376312589;
  n = (n ^ (n >> 13u)) * 1274126177;
  let u : u32 = bitcast<u32>(n ^ (n >> 16u));
  return clamp(f32(u) / 4294967295.0, 0.0, 1.0);
}

fn biomeValueNoise2(x : f32, z : f32, seed : i32) -> f32 {
  let xi = i32(floor(x));
  let zi = i32(floor(z));
  let xf = biomeSmooth01(x - floor(x));
  let zf = biomeSmooth01(z - floor(z));
  let a = biomeHashPositionSeeded(xi, zi, seed);
  let b = biomeHashPositionSeeded(xi + 1, zi, seed);
  let c = biomeHashPositionSeeded(xi, zi + 1, seed);
  let d = biomeHashPositionSeeded(xi + 1, zi + 1, seed);
  return a + (b - a) * xf + (c - a) * zf + (a - b - c + d) * xf * zf;
}

fn biomeFbmConfigurable(x : f32, z : f32, scale : f32, octaves : i32, persistence : f32, lacunarity : f32, seed : i32) -> f32 {
  var value : f32 = 0.0;
  var amplitude : f32 = 1.0;
  var frequency : f32 = max(1e-8, scale);
  var maxValue : f32 = 0.0;
  for (var i : i32 = 0; i < octaves; i = i + 1) {
    value = value + amplitude * biomeValueNoise2(
      x * frequency + f32(i) * 37.17,
      z * frequency - f32(i) * 19.31,
      seed + i * 101,
    );
    maxValue = maxValue + amplitude;
    amplitude = amplitude * persistence;
    frequency = frequency * lacunarity;
  }
  return value / maxValue;
}

fn biomeDomainWarpedFbm(x : f32, z : f32, scale : f32, octaves : i32, persistence : f32, lacunarity : f32, warpScale : f32, warpStrength : f32, seed : i32) -> f32 {
  let wx = biomeFbmConfigurable(x + 137.5, z - 91.25, warpScale, min(3, max(1, octaves)), 0.5, 2.0, seed + 811) * 2.0 - 1.0;
  let wz = biomeFbmConfigurable(x - 233.75, z + 57.5, warpScale, min(3, max(1, octaves)), 0.5, 2.0, seed + 1451) * 2.0 - 1.0;
  return biomeFbmConfigurable(x + wx * warpStrength, z + wz * warpStrength, scale, octaves, persistence, lacunarity, seed);
}

fn biomeIslandCenter(cellX : i32, cellZ : i32, seed : i32, spacingM : f32, radiusM : f32) -> vec3<f32> {
  let ox = biomeHashPositionSeeded(cellX * 43, cellZ * 59, seed + 1709) - 0.5;
  let oz = biomeHashPositionSeeded(cellX * 71, cellZ * 37, seed + 2203) - 0.5;
  let radiusT = biomeHashPositionSeeded(cellX * 97, cellZ * 83, seed + 3251);
  return vec3<f32>(
    (f32(cellX) + 0.5 + ox * 0.58) * spacingM,
    (f32(cellZ) + 0.5 + oz * 0.58) * spacingM,
    radiusM * (0.78 + radiusT * 0.44),
  );
}

fn sampleBiomeIslandMask(worldX : f32, worldZ : f32, seed : i32, enabled : bool, spacingM : f32, radiusM : f32, blendM : f32, warpStrengthM : f32) -> vec4<f32> {
  if (!enabled) {
    return vec4<f32>(1.0, radiusM, 0.0, 0.0);
  }

  let warpX = (biomeDomainWarpedFbm(worldX + 913.0, worldZ - 311.0, 0.0007, 3, 0.52, 2.0, 0.00021, warpStrengthM * 1.2, seed + 4441) * 2.0 - 1.0) * warpStrengthM;
  let warpZ = (biomeDomainWarpedFbm(worldX - 577.0, worldZ + 1217.0, 0.0007, 3, 0.52, 2.0, 0.00021, warpStrengthM * 1.2, seed + 5059) * 2.0 - 1.0) * warpStrengthM;
  let sx = worldX + warpX;
  let sz = worldZ + warpZ;
  let cellX = i32(floor(sx / spacingM));
  let cellZ = i32(floor(sz / spacingM));
  var bestMask : f32 = 0.0;
  var bestShore : f32 = -3.402823e38;
  var nearestX : f32 = 0.0;
  var nearestZ : f32 = 0.0;

  for (var dz : i32 = -2; dz <= 2; dz = dz + 1) {
    for (var dx : i32 = -2; dx <= 2; dx = dx + 1) {
      let center = biomeIslandCenter(cellX + dx, cellZ + dz, seed, spacingM, radiusM);
      let d = distance(vec2<f32>(sx, sz), center.xy);
      let shore = center.z - d;
      let outer = center.z + blendM;
      let mask = biomeSmooth01(1.0 - clamp((d - center.z) / max(1.0, blendM), 0.0, 1.0));
      var islandMask = mask;
      if (d <= center.z) { islandMask = 1.0; }
      if (d >= outer) { islandMask = 0.0; }
      if (islandMask > bestMask) {
        bestMask = islandMask;
      }
      if (shore > bestShore) {
        bestShore = shore;
        nearestX = center.x;
        nearestZ = center.y;
      }
    }
  }

  return vec4<f32>(clamp(bestMask, 0.0, 1.0), bestShore, nearestX, nearestZ);
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
  contract : BiomeRegionContract,
) -> u32 {
  if (height < seaLevel - contract.oceanHeightMarginM || islandMask < contract.oceanIslandMaskMax) { return BIOME_OCEAN; }
  if (abs(height - seaLevel) < contract.coastHeightBandM || shoreDistanceM < contract.coastShoreDistanceM) { return BIOME_COAST; }
  let n = biomeRegionNoise(worldX, worldZ, contract.regionCellM, seed + 711);
  let islandDistanceT = clamp(
    distance(vec2<f32>(worldX, worldZ), vec2<f32>(nearestCenterX, nearestCenterZ)) / max(1.0, islandRadiusM),
    0.0,
    1.0,
  );
  if (height >= seaLevel + contract.mountainHeightAboveSeaM) { return BIOME_MOUNTAIN; }
  if (height <= seaLevel + contract.swampHeightAboveSeaM && n < contract.swampNoiseMax) { return BIOME_SWAMP; }
  if (islandDistanceT > contract.plainsDistanceMin && n > contract.plainsNoiseMin) { return BIOME_PLAINS; }
  if (n > contract.forestNoiseMin) { return BIOME_FOREST; }
  return BIOME_MEADOWS;
}

fn classifyBiomeRegionIslandAware(
  worldX : f32,
  worldZ : f32,
  height : f32,
  seaLevel : f32,
  seed : i32,
  islandEnabled : bool,
  islandSpacingM : f32,
  islandRadiusM : f32,
  islandBlendM : f32,
  islandWarpStrengthM : f32,
) -> u32 {
  let island = sampleBiomeIslandMask(
    worldX,
    worldZ,
    seed,
    islandEnabled,
    islandSpacingM,
    islandRadiusM,
    islandBlendM,
    islandWarpStrengthM,
  );
  return classifyBiomeRegion(
    worldX,
    worldZ,
    height,
    seaLevel,
    seed,
    island.x,
    island.y,
    island.z,
    island.w,
    islandRadiusM,
    defaultBiomeRegionContract(),
  );
}
