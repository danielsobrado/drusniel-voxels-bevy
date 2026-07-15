struct VegetationCanonicalHeightSample {
  height_m: f32,
  validity: u32,
};

fn vegetation_positive_mod(value: i32, divisor: i32) -> i32 {
  return ((value % divisor) + divisor) % divisor;
}

fn vegetation_missing_canonical_height() -> VegetationCanonicalHeightSample {
  return VegetationCanonicalHeightSample(0.0, 0u);
}

fn vegetation_sample_canonical_height(wx: f32, wz: f32) -> VegetationCanonicalHeightSample {
  if (canonical_height_atlas_params.w < 0.5) {
    return vegetation_missing_canonical_height();
  }

  let tile_size_m = canonical_height_atlas_params.x;
  let tile_res = i32(canonical_height_atlas_params.y);
  let tiles_per_side = i32(canonical_height_atlas_params.z);
  if (tile_size_m <= 0.0 || tile_res <= 1 || tiles_per_side <= 0) {
    return vegetation_missing_canonical_height();
  }

  let tile_x = i32(floor(wx / tile_size_m));
  let tile_z = i32(floor(wz / tile_size_m));
  let slot_x = vegetation_positive_mod(tile_x, tiles_per_side);
  let slot_z = vegetation_positive_mod(tile_z, tiles_per_side);
  let resident_key = textureLoad(canonical_height_residency, vec2<i32>(slot_x, slot_z), 0).xy;
  if (resident_key.x != tile_x || resident_key.y != tile_z) {
    return vegetation_missing_canonical_height();
  }

  let local_x = clamp(wx - f32(tile_x) * tile_size_m, 0.0, f32(tile_res - 1));
  let local_z = clamp(wz - f32(tile_z) * tile_size_m, 0.0, f32(tile_res - 1));
  let x0 = i32(floor(local_x));
  let z0 = i32(floor(local_z));
  let x1 = min(x0 + 1, tile_res - 1);
  let z1 = min(z0 + 1, tile_res - 1);
  let atlas_origin = vec2<i32>(slot_x * tile_res, slot_z * tile_res);
  let a = textureLoad(canonical_height_atlas, atlas_origin + vec2<i32>(x0, z0), 0).x;
  let b = textureLoad(canonical_height_atlas, atlas_origin + vec2<i32>(x1, z0), 0).x;
  let c = textureLoad(canonical_height_atlas, atlas_origin + vec2<i32>(x0, z1), 0).x;
  let d = textureLoad(canonical_height_atlas, atlas_origin + vec2<i32>(x1, z1), 0).x;
  let fx = local_x - f32(x0);
  let fz = local_z - f32(z0);
  return VegetationCanonicalHeightSample(mix(mix(a, b, fx), mix(c, d, fx), fz), 2u);
}
