// Shared hydrology carved-bed sampling for GPU vegetation placement.
// Requires the including shader to declare:
//   @group(0) @binding(N) var hydro_texture: texture_2d<f32>;
//   @group(0) @binding(M) var hydro_sampler: sampler;

fn placement_hydro_enabled() -> bool {
  let dims = textureDimensions(hydro_texture);
  return dims.x > 1u && dims.y > 1u;
}

fn placement_hydro_res() -> u32 {
  return max(textureDimensions(hydro_texture).x, 1u);
}

fn placement_hydro_texel_uv(ix: u32, iz: u32, res: u32) -> vec2<f32> {
  let denom = f32(max(1u, res - 1u));
  return vec2<f32>(f32(ix) / denom, f32(iz) / denom);
}

fn placement_sample_hydro_texel(ix: u32, iz: u32, res: u32) -> vec4<f32> {
  return textureSampleLevel(hydro_texture, hydro_sampler, placement_hydro_texel_uv(ix, iz, res), 0.0);
}

fn placement_sample_hydro_bilinear(wx: f32, wz: f32, world_size: f32) -> vec4<f32> {
  let res = max(placement_hydro_res(), 2u);
  let scale = f32(res - 1u) / max(world_size, 1.0);
  let gx = wx * scale;
  let gz = wz * scale;
  let x0 = u32(floor(gx));
  let z0 = u32(floor(gz));
  let x1 = min(res - 1u, x0 + 1u);
  let z1 = min(res - 1u, z0 + 1u);
  let fx = clamp(gx - f32(x0), 0.0, 1.0);
  let fz = clamp(gz - f32(z0), 0.0, 1.0);
  let a = placement_sample_hydro_texel(x0, z0, res);
  let b = placement_sample_hydro_texel(x1, z0, res);
  let c = placement_sample_hydro_texel(x0, z1, res);
  let d = placement_sample_hydro_texel(x1, z1, res);
  let ab = mix(a, b, fx);
  let cd = mix(c, d, fx);
  return mix(ab, cd, fz);
}

fn placement_sample_carved_bed_bilinear(wx: f32, wz: f32, world_size: f32) -> f32 {
  return placement_sample_hydro_bilinear(wx, wz, world_size).z;
}

fn placement_ground_height(wx: f32, wz: f32, world_size: f32) -> f32 {
  if (!placement_hydro_enabled()) {
    return surfaceHeightField(wx, wz);
  }
  return placement_sample_carved_bed_bilinear(wx, wz, world_size);
}

fn placement_hydrology_height(wx: f32, wz: f32, world_size: f32, base_height: f32) -> vec2<f32> {
  if (!placement_hydro_enabled()) {
    return vec2<f32>(base_height, 0.0);
  }
  let hydro = placement_sample_hydro_bilinear(wx, wz, world_size);
  let carved_bed = hydro.z;
  let wet_mask = hydro.y;
  let height_diff = abs(carved_bed - base_height);
  let height = select(base_height, carved_bed, height_diff > 0.01);
  return vec2<f32>(height, wet_mask);
}
