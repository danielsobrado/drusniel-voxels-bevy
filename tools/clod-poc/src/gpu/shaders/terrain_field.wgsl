// Terrain SDF field for the GPU compute mesher. Mechanical transliteration of
// src/gpu/terrain_field_core.ts, which is pinned bit-for-bit to the canonical CPU field
// (src/terrain.ts) by terrain_field_core.test.ts. Logic is verified there; the only expected
// divergence is precision (f32 here vs f64 on CPU) and sqrt-of-dot vs Math.hypot. All GPU-meshed
// chunks share THIS field, so they remain mutually consistent and weld cleanly by construction.
//
// Bindings owned by this module (the mesher shader, concatenated after this file, must use
// group(0) bindings >= 2 or a separate group):
//   @group(0) @binding(0) digEdits : storage array<DigEdit>   (stride 40 bytes, see core)
//   @group(0) @binding(1) fieldParams : uniform               (editCount in .x)

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
  _pad0 : u32,
  _pad1 : u32,
  _pad2 : u32,
};

@group(0) @binding(0) var<storage, read> digEdits : array<DigEdit>;
@group(0) @binding(1) var<uniform> fieldParams : FieldParams;

const WATER_LEVEL : f32 = 18.0;
const MIN_NORMAL_TERRAIN_SURFACE_Y : f32 = 14.0;   // WATER_LEVEL - 4
const BASE_TERRAIN_ELEVATION : f32 = 14.0;
const BEDROCK_Y : f32 = 1.0;
const DIG_INFLUENCE_MARGIN : f32 = 4.0;

// TERRAIN_CONFIG (baked)
const CONTINENT_SCALE : f32 = 0.001;
const CONTINENT_AMP : f32 = 40.0;
const CONTINENT_OCT : i32 = 2;
const CONTINENT_PERS : f32 = 0.5;
const CONTINENT_LAC : f32 = 2.0;

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

const HILLS_SCALE : f32 = 0.025;
const HILLS_AMP : f32 = 25.0;
const HILLS_OCT : i32 = 4;
const HILLS_PERS : f32 = 0.5;
const HILLS_LAC : f32 = 2.0;

const DETAIL_SCALE : f32 = 0.1;
const DETAIL_AMP : f32 = 3.0;
const DETAIL_OCT : i32 = 3;
const DETAIL_PERS : f32 = 0.5;
const DETAIL_LAC : f32 = 2.0;

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

fn valueNoise2(x : f32, z : f32) -> f32 {
  let xi = i32(floor(x));
  let zi = i32(floor(z));
  let xf = smooth01(x - floor(x));
  let zf = smooth01(z - floor(z));
  let a = hashPositionSeeded(xi, zi, 0);
  let b = hashPositionSeeded(xi + 1, zi, 0);
  let c = hashPositionSeeded(xi, zi + 1, 0);
  let d = hashPositionSeeded(xi + 1, zi + 1, 0);
  return a + (b - a) * xf + (c - a) * zf + (a - b - c + d) * xf * zf;
}

fn fbmConfigurable(x : f32, z : f32, scale : f32, octaves : i32, persistence : f32, lacunarity : f32) -> f32 {
  var value : f32 = 0.0;
  var amplitude : f32 = 1.0;
  var frequency : f32 = scale;
  var maxValue : f32 = 0.0;
  for (var i : i32 = 0; i < octaves; i = i + 1) {
    value = value + amplitude * valueNoise2(x * frequency, z * frequency);
    maxValue = maxValue + amplitude;
    amplitude = amplitude * persistence;
    frequency = frequency * lacunarity;
  }
  return value / maxValue;
}

fn ridgedNoise(x : f32, z : f32) -> f32 {
  var value : f32 = 0.0;
  var amplitude : f32 = 1.0;
  var frequency : f32 = MTN_SCALE;
  var maxValue : f32 = 0.0;
  for (var i : i32 = 0; i < MTN_OCT; i = i + 1) {
    let off = f32(i) * 100.0;
    let sample = valueNoise2(x * frequency + off, z * frequency + off);
    let centered = sample * 2.0 - 1.0;
    // max(0,..) guards against a negative base (NaN) if `centered` ever leaves [-1,1] from f32 drift.
    let ridge = pow(max(0.0, 1.0 - abs(centered)), MTN_RIDGE_POWER);
    value = value + ridge * amplitude;
    maxValue = maxValue + amplitude;
    amplitude = amplitude * MTN_PERS;
    frequency = frequency * MTN_LAC;
  }
  return (value / maxValue) * MTN_AMP;
}

fn massifCellMask(x : f32, z : f32) -> f32 {
  let spacing = min(384.0, max(128.0, 1.0 / max(0.001, MTN_MASSIF_SCALE)));
  let cellX = i32(floor(x / spacing));
  let cellZ = i32(floor(z / spacing));
  var strongest : f32 = 0.0;
  for (var dz : i32 = -1; dz <= 1; dz = dz + 1) {
    for (var dx : i32 = -1; dx <= 1; dx = dx + 1) {
      let cx = cellX + dx;
      let cz = cellZ + dz;
      let offsetX = hashPositionSeeded(cx * 43, cz * 59, 0) - 0.5;
      let offsetZ = hashPositionSeeded(cx * 71, cz * 37, 0) - 0.5;
      let heightT = 0.55 + hashPositionSeeded(cx * 97, cz * 83, 0) * 0.45;
      let radiusT = hashPositionSeeded(cx * 113, cz * 131, 0);
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

fn softenHeightCap(height : f32, minHeight : f32, maxHeight : f32) -> f32 {
  let ceilingStart = max(maxHeight - 18.0, minHeight);
  let ceiling = maxHeight - 0.5;
  if (height <= ceilingStart || ceiling <= ceilingStart) { return height; }
  let rangeV = ceiling - ceilingStart;
  let excess = height - ceilingStart;
  return ceilingStart + (rangeV * excess) / (excess + rangeV);
}

fn surfaceHeightField(x : f32, z : f32) -> f32 {
  let continentNoise = fbmConfigurable(x, z, CONTINENT_SCALE, CONTINENT_OCT, CONTINENT_PERS, CONTINENT_LAC);
  let continent = continentNoise * CONTINENT_AMP * 0.55;

  let mountainSignal = fbmConfigurable(x, z, MTN_SCALE * 0.25, 2, 0.5, 2.0);
  let massifSignal = fbmConfigurable(x + 4096.0, z - 2048.0, MTN_MASSIF_SCALE, 3, 0.52, 2.0);
  let massifMask = max(
    pow(smoothstepRange(MTN_MASSIF_THRESHOLD, 1.0, massifSignal), max(0.25, MTN_MASSIF_POWER)),
    massifCellMask(x, z),
  );
  let mountainRegionBase = pow(clamp(mountainSignal, 0.0, 1.0), 1.35);
  let mountainRegion = clamp(mountainRegionBase * 0.55 + massifMask * 0.8, 0.0, 1.0);
  let mountains = ridgedNoise(x, z) * mountainRegion * (1.0 + massifMask * 0.55);
  let mountainUplift = MTN_AMP * 0.18 * mountainRegion + MTN_MASSIF_AMP * massifMask;

  let valleySignal = fbmConfigurable(x + 1375.0, z - 911.0, CONTINENT_SCALE * 2.2, 3, 0.55, 2.0);
  let valleyMask = smoothstepRange(0.22, 0.08, valleySignal);
  let valleyCarve = valleyMask * 14.0 * (1.0 - mountainRegion * 0.75);

  let hillNoise = fbmConfigurable(x, z, HILLS_SCALE, HILLS_OCT, HILLS_PERS, HILLS_LAC);
  let hills = hillNoise * HILLS_AMP * 0.45;

  let detailNoise = fbmConfigurable(x, z, DETAIL_SCALE, DETAIL_OCT, DETAIL_PERS, DETAIL_LAC);
  let detail = detailNoise * DETAIL_AMP;

  let minSurface = max(HEIGHT_MIN, MIN_NORMAL_TERRAIN_SURFACE_Y);
  let height = BASE_TERRAIN_ELEVATION + continent + mountains + mountainUplift + hills + detail - valleyCarve;
  return min(HEIGHT_MAX - 0.5, max(minSurface, softenHeightCap(height, minSurface, HEIGHT_MAX)));
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
