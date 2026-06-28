// Shared terrain SDF field for GPU compute shaders. Concrete digEdits and fieldParams
// bindings are supplied by small wrapper modules before this file is concatenated.
// Keep this as the mechanical WGSL transliteration of src/gpu/terrain_field_core.ts.

struct DigEdit {
  x : f32,
  y : f32,
  z : f32,
  r : f32,
  h : f32,        // vertical half-extent (editHeight)
  shape : i32,    // 0 sphere, 1 cube, 2 cylinder
  opAdd : i32,    // 1 = union solid, 0 = subtract air
  strength : f32,
  falloff : f32,
  material : i32,
};

struct FieldParams {
  editCount : u32,
  terrainSeed : i32,
  islandEnabled : u32,
  oceanRim : u32,
  seaLevel : f32,
  islandSpacingM : f32,
  islandRadiusM : f32,
  islandBlendM : f32,
  islandWarpStrengthM : f32,
  beachWidthM : f32,
  cliffWidthM : f32,
  worldRadiusM : f32,
  oceanRimDropM : f32,
  _pad0 : u32,
  _pad1 : u32,
  _pad2 : u32,
};

const BEDROCK_Y : f32 = 1.0;
const DIG_INFLUENCE_MARGIN : f32 = 4.0;

// TERRAIN_CONFIG (baked)
const CONTINENT_SCALE : f32 = 0.001;
const CONTINENT_AMP : f32 = 40.0;
const CONTINENT_OCT : i32 = 2;
const CONTINENT_PERS : f32 = 0.5;
const CONTINENT_LAC : f32 = 2.0;
const CONTINENT_WARP : f32 = 220.0;

const MTN_SCALE : f32 = 0.008;
const MTN_AMP : f32 = 120.0;
const MTN_OCT : i32 = 7;
const MTN_PERS : f32 = 0.48;
const MTN_LAC : f32 = 2.3;
const MTN_RIDGE_POWER : f32 = 1.8;
const MTN_MASSIF_SCALE : f32 = 0.0035;
const MTN_MASSIF_AMP : f32 = 38.0;
const MTN_MASSIF_THRESHOLD : f32 = 0.38;
const MTN_MASSIF_POWER : f32 = 1.65;
const MTN_WARP : f32 = 52.0;

const HILLS_SCALE : f32 = 0.025;
const HILLS_AMP : f32 = 25.0;
const HILLS_OCT : i32 = 4;
const HILLS_PERS : f32 = 0.5;
const HILLS_LAC : f32 = 2.0;
const HILLS_WARP : f32 = 19.0;

const DETAIL_SCALE : f32 = 0.1;
const DETAIL_AMP : f32 = 3.0;
const DETAIL_OCT : i32 = 3;
const DETAIL_PERS : f32 = 0.5;
const DETAIL_LAC : f32 = 2.0;
const DETAIL_WARP : f32 = 4.0;

const HEIGHT_MIN : f32 = 14.0;
const HEIGHT_MAX : f32 = 118.0;

// ---- noise ----------------------------------------------------------------
// Math.imul wraps to i32; WGSL i32 multiply wraps by spec. Inputs are integral.
fn hashPositionSeeded(x : i32, z : i32, seed : i32) -> f32 {
  var n : i32 = x * 374761393 + z * 668265263 + seed * 1376312589;
  n = (n ^ (n >> 13u)) * 1274126177;
  let u : u32 = bitcast<u32>(n ^ (n >> 16u));
  // f32(4294967295) rounds up to 2^32, so the raw quotient can land just above 1.0 — JS does this
  // in f64 and stays <= 1. A hash > 1 makes ridgedNoise's pow() take a negative base => NaN =>
  // empty/black chunks. Clamp to the JS range. (terrain_field_core stays unclamped; it's f64.)
  return clamp(f32(u) / 4294967295.0, 0.0, 1.0);
}

fn smooth01(t_in : f32) -> f32 {
  let t = clamp(t_in, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn smoothstepRange(edge0 : f32, edge1 : f32, value : f32) -> f32 {
  let denom = edge1 - edge0;
  if (abs(denom) <= 1.1920929e-7) {  // ~f32 epsilon; CPU uses Number.EPSILON (f64), see core note
    if (value >= edge1) { return 1.0; }
    return 0.0;
  }
  return smooth01((value - edge0) / denom);
}

fn valueNoise2(x : f32, z : f32, seed : i32) -> f32 {
  let xi = i32(floor(x));
  let zi = i32(floor(z));
  let xf = smooth01(x - floor(x));
  let zf = smooth01(z - floor(z));
  let a = hashPositionSeeded(xi, zi, seed);
  let b = hashPositionSeeded(xi + 1, zi, seed);
  let c = hashPositionSeeded(xi, zi + 1, seed);
  let d = hashPositionSeeded(xi + 1, zi + 1, seed);
  return a + (b - a) * xf + (c - a) * zf + (a - b - c + d) * xf * zf;
}

fn fbmConfigurable(x : f32, z : f32, scale : f32, octaves : i32, persistence : f32, lacunarity : f32, seed : i32) -> f32 {
  var value : f32 = 0.0;
  var amplitude : f32 = 1.0;
  var frequency : f32 = max(1e-8, scale);
  var maxValue : f32 = 0.0;
  for (var i : i32 = 0; i < octaves; i = i + 1) {
    value = value + amplitude * valueNoise2(
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

fn ridgedFbmConfigurable(x : f32, z : f32, scale : f32, octaves : i32, persistence : f32, lacunarity : f32, power : f32, seed : i32) -> f32 {
  var value : f32 = 0.0;
  var amplitude : f32 = 1.0;
  var frequency : f32 = max(1e-8, scale);
  var maxValue : f32 = 0.0;
  for (var i : i32 = 0; i < octaves; i = i + 1) {
    let sample = valueNoise2(
      x * frequency + f32(i) * 83.9,
      z * frequency - f32(i) * 47.3,
      seed + i * 131,
    );
    let ridge = pow(max(0.0, 1.0 - abs(sample * 2.0 - 1.0)), power);
    value = value + amplitude * ridge;
    maxValue = maxValue + amplitude;
    amplitude = amplitude * persistence;
    frequency = frequency * lacunarity;
  }
  return value / maxValue;
}

fn ridgedNoise(x : f32, z : f32, seed : i32) -> f32 {
  return ridgedFbmConfigurable(x, z, MTN_SCALE, MTN_OCT, MTN_PERS, MTN_LAC, MTN_RIDGE_POWER, seed + 37) * MTN_AMP;
}

fn domainWarpedFbmConfigurable(x : f32, z : f32, scale : f32, octaves : i32, persistence : f32, lacunarity : f32, warpStrength : f32, seed : i32) -> f32 {
  let warpScale = scale * 0.31;
  let warpOctaves = min(3, max(1, octaves));
  let wx = fbmConfigurable(x + 137.5, z - 91.25, warpScale, warpOctaves, 0.5, 2.0, seed + 811) * 2.0 - 1.0;
  let wz = fbmConfigurable(x - 233.75, z + 57.5, warpScale, warpOctaves, 0.5, 2.0, seed + 1451) * 2.0 - 1.0;
  return fbmConfigurable(x + wx * warpStrength, z + wz * warpStrength, scale, octaves, persistence, lacunarity, seed);
}

fn massifCellMask(x : f32, z : f32, seed : i32) -> f32 {
  let spacing = min(384.0, max(128.0, 1.0 / max(0.001, MTN_MASSIF_SCALE)));
  let cellX = i32(floor(x / spacing));
  let cellZ = i32(floor(z / spacing));
  var strongest : f32 = 0.0;
  for (var dz : i32 = -1; dz <= 1; dz = dz + 1) {
    for (var dx : i32 = -1; dx <= 1; dx = dx + 1) {
      let cx = cellX + dx;
      let cz = cellZ + dz;
      let offsetX = hashPositionSeeded(cx * 43, cz * 59, seed) - 0.5;
      let offsetZ = hashPositionSeeded(cx * 71, cz * 37, seed) - 0.5;
      let heightT = 0.55 + hashPositionSeeded(cx * 97, cz * 83, seed) * 0.45;
      let radiusT = hashPositionSeeded(cx * 113, cz * 131, seed);
      let centerX = (f32(cx) + 0.5 + offsetX * 0.55) * spacing;
      let centerZ = (f32(cz) + 0.5 + offsetZ * 0.55) * spacing;
      let radius = spacing * (0.42 + radiusT * 0.22);
      let dist = sqrt((x - centerX) * (x - centerX) + (z - centerZ) * (z - centerZ));
      let falloff = clamp(1.0 - dist / max(1.0, radius), 0.0, 1.0);
      let mask = pow(smooth01(falloff), max(0.25, MTN_MASSIF_POWER));
      strongest = max(strongest, mask * heightT);
    }
  }
  return strongest;
}

fn islandCenter(cellX : i32, cellZ : i32) -> vec3<f32> {
  let seed = fieldParams.terrainSeed;
  let ox = hashPositionSeeded(cellX * 43, cellZ * 59, seed + 1709) - 0.5;
  let oz = hashPositionSeeded(cellX * 71, cellZ * 37, seed + 2203) - 0.5;
  let radiusT = hashPositionSeeded(cellX * 97, cellZ * 83, seed + 3251);
  return vec3<f32>(
    (f32(cellX) + 0.5 + ox * 0.58) * fieldParams.islandSpacingM,
    (f32(cellZ) + 0.5 + oz * 0.58) * fieldParams.islandSpacingM,
    fieldParams.islandRadiusM * (0.78 + radiusT * 0.44),
  );
}

fn sampleIslandMaskField(x : f32, z : f32) -> vec4<f32> {
  if (fieldParams.islandEnabled == 0u) {
    return vec4<f32>(1.0, fieldParams.islandRadiusM, 0.0, 0.0);
  }

  let warpX = (domainWarpedFbmConfigurable(x + 913.0, z - 311.0, 0.0007, 3, 0.52, 2.0, fieldParams.islandWarpStrengthM * 1.2, fieldParams.terrainSeed + 4441) * 2.0 - 1.0) * fieldParams.islandWarpStrengthM;
  let warpZ = (domainWarpedFbmConfigurable(x - 577.0, z + 1217.0, 0.0007, 3, 0.52, 2.0, fieldParams.islandWarpStrengthM * 1.2, fieldParams.terrainSeed + 5059) * 2.0 - 1.0) * fieldParams.islandWarpStrengthM;
  let sx = x + warpX;
  let sz = z + warpZ;
  let cellX = i32(floor(sx / fieldParams.islandSpacingM));
  let cellZ = i32(floor(sz / fieldParams.islandSpacingM));
  var bestMask : f32 = 0.0;
  var bestShore : f32 = -3.402823e38;
  var nearestX : f32 = 0.0;
  var nearestZ : f32 = 0.0;

  for (var dz : i32 = -2; dz <= 2; dz = dz + 1) {
    for (var dx : i32 = -2; dx <= 2; dx = dx + 1) {
      let center = islandCenter(cellX + dx, cellZ + dz);
      let d = distance(vec2<f32>(sx, sz), center.xy);
      let shore = center.z - d;
      let outer = center.z + fieldParams.islandBlendM;
      let mask = smooth01(1.0 - clamp((d - center.z) / max(1.0, fieldParams.islandBlendM), 0.0, 1.0));
      var islandMask = mask;
      if (d <= center.z) { islandMask = 1.0; }
      if (d >= outer) { islandMask = 0.0; }
      if (islandMask > bestMask || shore > bestShore) {
        bestMask = islandMask;
        bestShore = shore;
        nearestX = center.x;
        nearestZ = center.y;
      }
    }
  }

  return vec4<f32>(clamp(bestMask, 0.0, 1.0), bestShore, nearestX, nearestZ);
}

fn islandCliffWeightField(x : f32, z : f32) -> f32 {
  let cliffNoise = domainWarpedFbmConfigurable(x + 193.0, z - 877.0, 0.006, 3, 0.5, 2.1, 46.0, fieldParams.terrainSeed + 6427);
  return smoothstepRange(0.58, 0.84, cliffNoise);
}

fn applyIslandShapeField(x : f32, z : f32, inlandHeight : f32) -> f32 {
  if (fieldParams.islandEnabled == 0u && fieldParams.oceanRim == 0u) {
    return inlandHeight;
  }

  var height = inlandHeight;
  if (fieldParams.islandEnabled != 0u) {
    let sample = sampleIslandMaskField(x, z);
    let islandMask = sample.x;
    let shoreDistance = sample.y;
    let cliffWeight = islandCliffWeightField(x, z);
    let oceanFloor = fieldParams.seaLevel - 18.0;
    let cliffTarget = max(inlandHeight, fieldParams.seaLevel + 7.0 + cliffWeight * 18.0);
    let beachTarget = fieldParams.seaLevel + smooth01(max(0.0, shoreDistance) / fieldParams.beachWidthM) * 3.5;
    let coastT = smooth01(max(0.0, shoreDistance) / (fieldParams.beachWidthM + fieldParams.cliffWidthM));
    let coastHeight = beachTarget + (cliffTarget - beachTarget) * cliffWeight * coastT;
    var islandHeight = inlandHeight;
    if (shoreDistance < fieldParams.beachWidthM + fieldParams.cliffWidthM) {
      islandHeight = min(inlandHeight, coastHeight);
    }
    height = oceanFloor + (islandHeight - oceanFloor) * islandMask;
  }

  if (fieldParams.oceanRim != 0u) {
    let d = length(vec2<f32>(x, z));
    let rimT = smoothstepRange(fieldParams.worldRadiusM * 0.9, fieldParams.worldRadiusM, d);
    if (rimT > 0.0) {
      let rimHeight = fieldParams.seaLevel - 2.0 - fieldParams.oceanRimDropM * rimT;
      height = min(height, rimHeight);
    }
  }

  return height;
}

fn softenHeightCap(height : f32, minHeight : f32, maxHeight : f32) -> f32 {
  let ceilingStart = max(maxHeight - 18.0, minHeight);
  let ceiling = maxHeight - 0.5;
  if (height <= ceilingStart || ceiling <= ceilingStart) { return height; }
  let rangeV = ceiling - ceilingStart;
  let excess = height - ceilingStart;
  return ceilingStart + (rangeV * excess) / (excess + rangeV);
}

fn surfaceHeightField(x : f32, z : f32) -> f32 {
  let seed = fieldParams.terrainSeed;
  let minNormalTerrainSurfaceY = fieldParams.seaLevel - 4.0;
  let baseTerrainElevation = minNormalTerrainSurfaceY;
  let continentNoise = domainWarpedFbmConfigurable(x, z, CONTINENT_SCALE, CONTINENT_OCT, CONTINENT_PERS, CONTINENT_LAC, CONTINENT_WARP, seed + 101);
  let continent = continentNoise * CONTINENT_AMP * 0.55;

  let mountainSignal = domainWarpedFbmConfigurable(x, z, MTN_SCALE * 0.25, 2, 0.5, 2.0, MTN_WARP, seed + 211);
  let massifSignal = domainWarpedFbmConfigurable(x + 4096.0, z - 2048.0, MTN_MASSIF_SCALE, 3, 0.52, 2.0, MTN_WARP * 1.6, seed + 307);
  let massifMask = max(
    pow(smoothstepRange(MTN_MASSIF_THRESHOLD, 1.0, massifSignal), max(0.25, MTN_MASSIF_POWER)),
    massifCellMask(x, z, seed),
  );
  let mountainRegionBase = pow(clamp(mountainSignal, 0.0, 1.0), 1.35);
  let mountainRegion = clamp(mountainRegionBase * 0.55 + massifMask * 0.8, 0.0, 1.0);
  let mountains = ridgedNoise(x, z, seed) * mountainRegion * (1.0 + massifMask * 0.55);
  let mountainUplift = MTN_AMP * 0.18 * mountainRegion + MTN_MASSIF_AMP * massifMask;

  let valleySignal = domainWarpedFbmConfigurable(x + 1375.0, z - 911.0, CONTINENT_SCALE * 2.2, 3, 0.55, 2.0, 120.0, seed + 409);
  let valleyMask = smoothstepRange(0.22, 0.08, valleySignal);
  let valleyCarve = valleyMask * 14.0 * (1.0 - mountainRegion * 0.75);

  let hillNoise = domainWarpedFbmConfigurable(x, z, HILLS_SCALE, HILLS_OCT, HILLS_PERS, HILLS_LAC, HILLS_WARP, seed + 503);
  let hills = hillNoise * HILLS_AMP * 0.45;

  let detailFbm = fbmConfigurable(x, z, DETAIL_SCALE, DETAIL_OCT, DETAIL_PERS, DETAIL_LAC, seed + 607);
  let detailWarp = domainWarpedFbmConfigurable(x, z, DETAIL_SCALE * 0.8, 2, 0.5, 2.0, DETAIL_WARP, seed + 701);
  let detailNoise = detailFbm * 0.65 + detailWarp * 0.35;
  let detail = detailNoise * DETAIL_AMP;

  let minSurface = max(HEIGHT_MIN, minNormalTerrainSurfaceY);
  let height = baseTerrainElevation + continent + mountains + mountainUplift + hills + detail - valleyCarve;
  let capped = min(HEIGHT_MAX - 0.5, max(minSurface, softenHeightCap(height, minSurface, HEIGHT_MAX)));
  return applyIslandShapeField(x, z, capped);
}

// ---- dig edits ------------------------------------------------------------
fn brushSdf(shape : i32, dx : f32, dy : f32, dz : f32, r : f32, h : f32) -> f32 {
  if (shape == 1) { // cube
    let qx = abs(dx) - r;
    let qy = abs(dy) - h;
    let qz = abs(dz) - r;
    let ox = max(qx, 0.0);
    let oy = max(qy, 0.0);
    let oz = max(qz, 0.0);
    let outside = sqrt(ox * ox + oy * oy + oz * oz);
    return outside + min(max(qx, max(qy, qz)), 0.0);
  }
  if (shape == 2) { // cylinder
    let dRadial = sqrt(dx * dx + dz * dz) - r;
    let dAxial = abs(dy) - h;
    let or_ = max(dRadial, 0.0);
    let oa = max(dAxial, 0.0);
    let outside = sqrt(or_ * or_ + oa * oa);
    return outside + min(max(dRadial, dAxial), 0.0);
  }
  // sphere -> ellipsoid when h != r
  let ey = (dy * r) / h;
  return sqrt(dx * dx + ey * ey + dz * dz) - r;
}

fn densityField(x : f32, y : f32, z : f32) -> f32 {
  var d : f32 = surfaceHeightField(x, z) - y;
  let count = fieldParams.editCount;
  if (count > 0u && y > BEDROCK_Y) {
    for (var i : u32 = 0u; i < count; i = i + 1u) {
      let e = digEdits[i];
      let reachXZ = e.r + DIG_INFLUENCE_MARGIN;
      let reachY = e.h + DIG_INFLUENCE_MARGIN;
      let dx = x - e.x;
      let dy = y - e.y;
      let dz = z - e.z;
      if (abs(dx) > reachXZ || abs(dy) > reachY || abs(dz) > reachXZ) { continue; }
      let sdf = brushSdf(e.shape, dx, dy, dz, e.r, e.h);
      var full : f32;
      if (e.opAdd == 1) { full = max(d, -sdf); } else { full = min(d, sdf); }
      let feather = max(1e-3, e.falloff * e.r);
      let weight = clamp(-sdf / feather, 0.0, 1.0) * e.strength;
      d = d + (full - d) * weight;
    }
  }
  return d;
}

fn densityGradient(x : f32, y : f32, z : f32) -> vec3<f32> {
  let e = 0.5;
  let gx = densityField(x + e, y, z) - densityField(x - e, y, z);
  let gy = densityField(x, y + e, z) - densityField(x, y - e, z);
  let gz = densityField(x, y, z + e) - densityField(x, y, z - e);
  let n = vec3<f32>(-gx, -gy, -gz);
  let lenRaw = length(n);
  let len = select(lenRaw, 1.0, lenRaw == 0.0); // CPU: `Math.hypot(...) || 1`
  return n / len;
}
