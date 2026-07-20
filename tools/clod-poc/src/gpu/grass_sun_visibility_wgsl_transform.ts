const PARAM_FIELD = "  sun_visibility: vec4<f32>,\n";
const TEXTURE_BINDING = "@group(0) @binding(16) var forest_lighting_texture: texture_2d<f32>;\n";

const FOREST_LIGHTING_WGSL = `
fn sample_grass_forest_lighting(wpos: vec2<f32>) -> vec2<f32> {
  if (params.sun_visibility.z < 0.5) {
    return vec2<f32>(0.0, 0.0);
  }

  let world_size = max(params.sun_visibility.x, 1.0);
  let resolution = max(i32(params.sun_visibility.y), 1);
  let uv = clamp(wpos / world_size, vec2<f32>(0.0), vec2<f32>(0.999999));
  let texel = uv * f32(max(resolution - 1, 0));
  let base = vec2<i32>(floor(texel));
  let next = min(base + vec2<i32>(1), vec2<i32>(resolution - 1));
  let blend = fract(texel);
  let s00 = textureLoad(forest_lighting_texture, base, 0).rg;
  let s10 = textureLoad(forest_lighting_texture, vec2<i32>(next.x, base.y), 0).rg;
  let s01 = textureLoad(forest_lighting_texture, vec2<i32>(base.x, next.y), 0).rg;
  let s11 = textureLoad(forest_lighting_texture, next, 0).rg;
  return mix(mix(s00, s10, blend.x), mix(s01, s11, blend.x), blend.y);
}

fn grass_sun_visibility(wpos: vec2<f32>) -> f32 {
  let forest_lighting = sample_grass_forest_lighting(wpos);
  return clamp(1.0 - forest_lighting.y, 0.0, 1.0);
}

fn grass_forest_density_multiplier(wpos: vec2<f32>) -> f32 {
  let forest_lighting = sample_grass_forest_lighting(wpos);
  return clamp(1.0 - forest_lighting.x, 0.18, 1.0);
}
`;

const GRASS_MASK_RETURN = "  return clamp(max(grass_weight * viable * (1.0 - bank * 0.58), scruff) * river_band.density * terrain_density, 0.0, 1.0);";
const CANONICAL_GRASS_MASK_RETURN = "  return clamp(max(grass_weight * viable * (1.0 - bank * 0.58), scruff) * river_band.density * terrain_density * grass_forest_density_multiplier(vec2<f32>(wx, wz)), 0.0, 1.0);";

export function withGrassSunVisibility(source: string): string {
  if (source.includes("fn grass_sun_visibility")) return source;

  const withParams = source.replace(
    "  hydro_atlas: vec4<f32>,\n",
    `  hydro_atlas: vec4<f32>,\n${PARAM_FIELD}`,
  );
  if (withParams === source) {
    throw new Error("grass forest lighting WGSL transform could not add params");
  }

  const withBinding = withParams.replace(
    "@group(0) @binding(12) var hydro_atlas_texture: texture_2d<f32>;\n",
    `@group(0) @binding(12) var hydro_atlas_texture: texture_2d<f32>;\n${TEXTURE_BINDING}`,
  );
  if (withBinding === withParams) {
    throw new Error("grass forest lighting WGSL transform could not add texture binding");
  }

  const functionMarker = "fn placement_hydro_atlas_params() -> vec4<f32> {";
  const withFunction = withBinding.replace(functionMarker, `${FOREST_LIGHTING_WGSL}\n${functionMarker}`);
  if (withFunction === withBinding) {
    throw new Error("grass forest lighting WGSL transform could not add sampler functions");
  }

  const withDensity = withFunction.replace(GRASS_MASK_RETURN, CANONICAL_GRASS_MASK_RETURN);
  if (withDensity === withFunction) {
    throw new Error("grass forest lighting WGSL transform could not apply density suppression");
  }

  const outputMarker = "out_offset[out_index] = vec4<f32>(wpos.x, height + 0.02, wpos.y, 1.0);";
  const withOutput = withDensity.replace(
    outputMarker,
    "out_offset[out_index] = vec4<f32>(wpos.x, height + 0.02, wpos.y, grass_sun_visibility(wpos));",
  );
  if (withOutput === withDensity) {
    throw new Error("grass forest lighting WGSL transform could not write blade visibility");
  }
  return withOutput;
}
