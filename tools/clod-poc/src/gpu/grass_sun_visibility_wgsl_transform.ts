const PARAM_FIELD = "  sun_visibility: vec4<f32>,\n";
const TEXTURE_BINDING = "@group(0) @binding(16) var forest_lighting_texture: texture_2d<f32>;\n";

const SUN_VISIBILITY_WGSL = `
fn grass_sun_visibility(wpos: vec2<f32>) -> f32 {
  if (params.sun_visibility.z < 0.5) {
    return 1.0;
  }

  let world_size = max(params.sun_visibility.x, 1.0);
  let resolution = max(i32(params.sun_visibility.y), 1);
  let uv = clamp(wpos / world_size, vec2<f32>(0.0), vec2<f32>(0.999999));
  let texel = uv * f32(max(resolution - 1, 0));
  let base = vec2<i32>(floor(texel));
  let next = min(base + vec2<i32>(1), vec2<i32>(resolution - 1));
  let blend = fract(texel);
  let s00 = textureLoad(forest_lighting_texture, base, 0).g;
  let s10 = textureLoad(forest_lighting_texture, vec2<i32>(next.x, base.y), 0).g;
  let s01 = textureLoad(forest_lighting_texture, vec2<i32>(base.x, next.y), 0).g;
  let s11 = textureLoad(forest_lighting_texture, next, 0).g;
  let shadow_proxy = mix(mix(s00, s10, blend.x), mix(s01, s11, blend.x), blend.y);
  return clamp(1.0 - shadow_proxy, 0.0, 1.0);
}
`;

export function withGrassSunVisibility(source: string): string {
  if (source.includes("fn grass_sun_visibility")) return source;

  const withParams = source.replace(
    "  hydro_atlas: vec4<f32>,\n",
    `  hydro_atlas: vec4<f32>,\n${PARAM_FIELD}`,
  );
  if (withParams === source) {
    throw new Error("grass sun visibility WGSL transform could not add params");
  }

  const withBinding = withParams.replace(
    "@group(0) @binding(12) var hydro_atlas_texture: texture_2d<f32>;\n",
    `@group(0) @binding(12) var hydro_atlas_texture: texture_2d<f32>;\n${TEXTURE_BINDING}`,
  );
  if (withBinding === withParams) {
    throw new Error("grass sun visibility WGSL transform could not add texture binding");
  }

  const functionMarker = "fn placement_hydro_atlas_params() -> vec4<f32> {";
  const withFunction = withBinding.replace(functionMarker, `${SUN_VISIBILITY_WGSL}\n${functionMarker}`);
  if (withFunction === withBinding) {
    throw new Error("grass sun visibility WGSL transform could not add sampler function");
  }

  const outputMarker = "out_offset[out_index] = vec4<f32>(wpos.x, height + 0.02, wpos.y, 1.0);";
  const withOutput = withFunction.replace(
    outputMarker,
    "out_offset[out_index] = vec4<f32>(wpos.x, height + 0.02, wpos.y, grass_sun_visibility(wpos));",
  );
  if (withOutput === withFunction) {
    throw new Error("grass sun visibility WGSL transform could not write blade visibility");
  }
  return withOutput;
}
