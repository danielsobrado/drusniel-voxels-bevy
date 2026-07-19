const PARAM_FIELD = "  sun_visibility: vec4<f32>,\n";
const TEXTURE_BINDINGS = [
  "@group(0) @binding(16) var forest_lighting_texture: texture_2d<f32>;",
  "@group(0) @binding(17) var forest_lighting_sampler: sampler;",
  "",
].join("\n");

const SUN_VISIBILITY_WGSL = `
fn grass_sun_visibility(wpos: vec2<f32>) -> f32 {
  if (params.sun_visibility.z < 0.5) {
    return 1.0;
  }

  let world_size = max(params.sun_visibility.x, 1.0);
  let uv = clamp(wpos / world_size, vec2<f32>(0.0), vec2<f32>(0.999999));
  let shadow_proxy = textureSampleLevel(
    forest_lighting_texture,
    forest_lighting_sampler,
    uv,
    0.0,
  ).g;
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
    `@group(0) @binding(12) var hydro_atlas_texture: texture_2d<f32>;\n${TEXTURE_BINDINGS}`,
  );
  if (withBinding === withParams) {
    throw new Error("grass sun visibility WGSL transform could not add texture bindings");
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
