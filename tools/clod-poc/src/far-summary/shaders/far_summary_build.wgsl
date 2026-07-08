const BIOME_MEADOWS: u32 = 0u;
const BIOME_FOREST: u32 = 1u;
const BIOME_SWAMP: u32 = 2u;
const BIOME_MOUNTAIN: u32 = 3u;
const BIOME_PLAINS: u32 = 4u;
const BIOME_COAST: u32 = 5u;
const BIOME_OCEAN: u32 = 6u;
const FAR_SUMMARY_FLAG_CELL_RECORDS: u32 = 1u;

const BIOME_REGION_CELL_M: f32 = 420.0;
const BIOME_OCEAN_HEIGHT_MARGIN_M: f32 = 1.5;
const BIOME_OCEAN_ISLAND_MASK_MAX: f32 = 0.08;
const BIOME_COAST_HEIGHT_BAND_M: f32 = 4.0;
const BIOME_COAST_SHORE_DISTANCE_M: f32 = 42.0;
const BIOME_MOUNTAIN_HEIGHT_ABOVE_SEA_M: f32 = 68.0;
const BIOME_SWAMP_HEIGHT_ABOVE_SEA_M: f32 = 8.0;
const BIOME_SWAMP_NOISE_MAX: f32 = 0.42;
const BIOME_PLAINS_DISTANCE_MIN: f32 = 0.72;
const BIOME_PLAINS_NOISE_MIN: f32 = 0.58;
const BIOME_FOREST_NOISE_MIN: f32 = 0.46;

fn mix32(value: u32) -> u32 {
  var mixed = value;
  mixed = mixed ^ (mixed >> 16u);
  mixed = mixed * 0x7feb352du;
  mixed = mixed ^ (mixed >> 15u);
  mixed = mixed * 0x846ca68bu;
  mixed = mixed ^ (mixed >> 16u);
  return mixed;
}

fn pcg2d_biome(x: i32, z: i32, seed: i32) -> f32 {
  let value = bitcast<u32>(seed) ^ (bitcast<u32>(x) * 0x1f123bb5u) ^ (bitcast<u32>(z) * 0x5f356495u);
  return f32(mix32(value)) / 4294967296.0;
}

fn biomeRegionNoiseField(x: f32, z: f32, seed: i32) -> f32 {
  let gx = x / BIOME_REGION_CELL_M;
  let gz = z / BIOME_REGION_CELL_M;
  let x0 = i32(floor(gx));
  let z0 = i32(floor(gz));
  let tx = smooth01(gx - floor(gx));
  let tz = smooth01(gz - floor(gz));
  let a = pcg2d_biome(x0, z0, seed);
  let b = pcg2d_biome(x0 + 1, z0, seed);
  let c = pcg2d_biome(x0, z0 + 1, seed);
  let d = pcg2d_biome(x0 + 1, z0 + 1, seed);
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

fn classifyBiomeMaterial(x: f32, z: f32, height: f32) -> u32 {
  let island = sampleIslandMaskField(x, z);
  if (height < fieldParams.seaLevel - BIOME_OCEAN_HEIGHT_MARGIN_M || island.x < BIOME_OCEAN_ISLAND_MASK_MAX) {
    return BIOME_OCEAN;
  }
  if (abs(height - fieldParams.seaLevel) < BIOME_COAST_HEIGHT_BAND_M || island.y < BIOME_COAST_SHORE_DISTANCE_M) {
    return BIOME_COAST;
  }

  let n = biomeRegionNoiseField(x, z, fieldParams.terrainSeed + 711);
  let centerDistance = distance(vec2<f32>(x, z), island.zw);
  let distanceT = clamp(centerDistance / max(1.0, fieldParams.islandRadiusM), 0.0, 1.0);

  if (height >= fieldParams.seaLevel + BIOME_MOUNTAIN_HEIGHT_ABOVE_SEA_M) { return BIOME_MOUNTAIN; }
  if (height <= fieldParams.seaLevel + BIOME_SWAMP_HEIGHT_ABOVE_SEA_M && n < BIOME_SWAMP_NOISE_MAX) { return BIOME_SWAMP; }
  if (distanceT > BIOME_PLAINS_DISTANCE_MIN && n > BIOME_PLAINS_NOISE_MIN) { return BIOME_PLAINS; }
  if (n > BIOME_FOREST_NOISE_MIN) { return BIOME_FOREST; }
  return BIOME_MEADOWS;
}

fn normalFromHeightsField(hL: f32, hR: f32, hD: f32, hU: f32, step: f32) -> vec3<f32> {
  let n = vec3<f32>(hL - hR, 2.0 * step, hD - hU);
  let len = length(n);
  if (len < 1e-10) { return vec3<f32>(0.0, 1.0, 0.0); }
  return n / len;
}

fn roughnessAtCell(originX: f32, originZ: f32, tileCells: u32, cellM: f32, sx: u32, sz: u32, centerHeight: f32) -> f32 {
  var sumSq: f32 = 0.0;
  var count: f32 = 0.0;
  for (var dz: i32 = -1; dz <= 1; dz = dz + 1) {
    for (var dx: i32 = -1; dx <= 1; dx = dx + 1) {
      if (dx == 0 && dz == 0) { continue; }
      let gx = clamp(i32(sx) + dx, -1, i32(tileCells));
      let gz = clamp(i32(sz) + dz, -1, i32(tileCells));
      let wx = originX + (f32(gx) + 0.5) * cellM;
      let wz = originZ + (f32(gz) + 0.5) * cellM;
      let h = surfaceHeightField(wx, wz);
      let diff = h - centerHeight;
      sumSq = sumSq + diff * diff;
      count = count + 1.0;
    }
  }
  if (count <= 0.0) { return 0.0; }
  return sqrt(sumSq / count);
}

fn addMaterialCount(material: u32, counts: ptr<function, array<u32, 7>>) {
  if (material <= 6u) {
    (*counts)[material] = (*counts)[material] + 1u;
  }
}

fn dominantMaterialFromCounts(counts: array<u32, 7>) -> vec2<u32> {
  var bestMaterial: u32 = 0u;
  var bestCount: u32 = counts[0];
  for (var i: u32 = 1u; i < 7u; i = i + 1u) {
    if (counts[i] > bestCount) {
      bestMaterial = i;
      bestCount = counts[i];
    }
  }
  return vec2<u32>(bestMaterial, bestCount);
}

fn makeFarSummaryRecord(
  heightMin: f32,
  heightMax: f32,
  heightAvg: f32,
  slopeMean: f32,
  normal: vec3<f32>,
  material: u32,
  materialVariance: f32,
  grassEligibility: f32,
  roughnessMean: f32,
  waterCoverage: f32,
  canopyCoverage: f32,
  slopeMax: f32,
  revision: u32,
  flags: u32,
  sampleCount: u32,
) -> FarSummaryGpuRecord {
  var record: FarSummaryGpuRecord;
  record.height_min_max = vec2<f32>(heightMin, heightMax);
  record.height_avg_slope = vec2<f32>(heightAvg, slopeMean);
  record.normal_avg = vec4<f32>(normal, 0.0);
  record.material_cover_a = vec4<f32>(f32(material), materialVariance, grassEligibility, roughnessMean);
  record.material_cover_b = vec4<f32>(waterCoverage, canopyCoverage, slopeMax, 0.0);
  record.canopy_occ = vec4<f32>(canopyCoverage, 0.0, 0.0, 0.0);
  record.record_meta = vec4<u32>(0u, revision, flags, sampleCount);
  record._pad0 = vec4<u32>(0u);
  record._pad1 = vec4<u32>(0u);
  return record;
}

@compute @workgroup_size(64)
fn build_far_summary(@builtin(global_invocation_id) id: vec3<u32>) {
  let tileIndex = id.x;
  if (tileIndex >= arrayLength(&descriptors)) {
    return;
  }

  let descriptor = descriptors[tileIndex];
  let tileCells = max(1u, descriptor.tile_cells);
  let cellM = descriptor.cell_size_m;
  let sampleCount = tileCells * tileCells;
  let writeCellRecords = (descriptor.flags & FAR_SUMMARY_FLAG_CELL_RECORDS) != 0u;

  var heightMin: f32 = 3.402823e38;
  var heightMax: f32 = -3.402823e38;
  var heightSum: f32 = 0.0;
  var slopeSum: f32 = 0.0;
  var slopeMax: f32 = 0.0;
  var normalSum: vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);
  var roughnessSum: f32 = 0.0;
  var waterSum: f32 = 0.0;
  var canopySum: f32 = 0.0;
  var materialCounts: array<u32, 7>;

  for (var sz: u32 = 0u; sz < tileCells; sz = sz + 1u) {
    for (var sx: u32 = 0u; sx < tileCells; sx = sx + 1u) {
      let wx = descriptor.origin_x + (f32(sx) + 0.5) * cellM;
      let wz = descriptor.origin_z + (f32(sz) + 0.5) * cellM;
      let h = surfaceHeightField(wx, wz);
      let hL = surfaceHeightField(descriptor.origin_x + (f32(max(i32(sx) - 1, -1)) + 0.5) * cellM, wz);
      let hR = surfaceHeightField(descriptor.origin_x + (f32(min(i32(sx) + 1, i32(tileCells))) + 0.5) * cellM, wz);
      let hD = surfaceHeightField(wx, descriptor.origin_z + (f32(max(i32(sz) - 1, -1)) + 0.5) * cellM);
      let hU = surfaceHeightField(wx, descriptor.origin_z + (f32(min(i32(sz) + 1, i32(tileCells))) + 0.5) * cellM);
      let sampleMin = min(h, min(hL, min(hR, min(hD, hU))));
      let sampleMax = max(h, max(hL, max(hR, max(hD, hU))));
      let normal = normalFromHeightsField(hL, hR, hD, hU, cellM);
      let slope = acos(clamp(normal.y, 0.0, 1.0));
      let roughness = roughnessAtCell(descriptor.origin_x, descriptor.origin_z, tileCells, cellM, sx, sz, h);
      let material = classifyBiomeMaterial(wx, wz, h);
      let water = select(0.0, 1.0, sampleMax < fieldParams.seaLevel);
      let grassEligibility = clamp((1.0 - water) * (1.0 - slope / 0.75), 0.0, 1.0);

      if (writeCellRecords) {
        let cellIndex = sz * tileCells + sx;
        cell_records[descriptor.cell_record_offset + cellIndex] = makeFarSummaryRecord(
          sampleMin,
          sampleMax,
          h,
          slope,
          normal,
          material,
          0.0,
          grassEligibility,
          roughness,
          water,
          0.0,
          slope,
          descriptor.revision,
          descriptor.flags,
          1u,
        );
      }

      heightMin = min(heightMin, sampleMin);
      heightMax = max(heightMax, sampleMax);
      heightSum = heightSum + h;
      normalSum = normalSum + normal;
      slopeSum = slopeSum + slope;
      slopeMax = max(slopeMax, slope);
      roughnessSum = roughnessSum + roughness;
      waterSum = waterSum + water;
      addMaterialCount(material, &materialCounts);
    }
  }

  let invCount = 1.0 / f32(sampleCount);
  let material = dominantMaterialFromCounts(materialCounts);
  let normalLen = length(normalSum);
  let avgNormal = select(vec3<f32>(0.0, 1.0, 0.0), normalSum / normalLen, normalLen > 1e-10);
  let materialVariance = 1.0 - f32(material.y) * invCount;
  let waterCoverage = waterSum * invCount;
  let slopeMean = slopeSum * invCount;
  let canopyCoverage = canopySum * invCount;
  let grassEligibility = clamp((1.0 - waterCoverage) * (1.0 - slopeMean / 0.75), 0.0, 1.0);

  records[tileIndex] = makeFarSummaryRecord(
    heightMin,
    heightMax,
    heightSum * invCount,
    slopeMean,
    avgNormal,
    material.x,
    materialVariance,
    grassEligibility,
    roughnessSum * invCount,
    waterCoverage,
    canopyCoverage,
    slopeMax,
    descriptor.revision,
    descriptor.flags,
    sampleCount,
  );
}
