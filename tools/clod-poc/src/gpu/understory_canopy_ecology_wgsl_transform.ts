const TEXTURE_BINDING = "@group(0) @binding(14) var canopy_ecology_texture: texture_2d<f32>;\n";

const CANOPY_ECOLOGY_WGSL = `
fn sample_understory_canopy_ecology(wpos: vec2<f32>) -> vec4<f32> {
  if (params.hydro_params.w < 0.5) {
    return vec4<f32>(0.0);
  }

  let world_size = max(params.center_radius.w, 1.0);
  let resolution = max(i32(params.hydro_params.z), 1);
  let uv = clamp(wpos / world_size, vec2<f32>(0.0), vec2<f32>(0.999999));
  let texel = uv * f32(max(resolution - 1, 0));
  let base = vec2<i32>(floor(texel));
  let next = min(base + vec2<i32>(1), vec2<i32>(resolution - 1));
  let blend = fract(texel);
  let s00 = textureLoad(canopy_ecology_texture, base, 0).rgb;
  let s10 = textureLoad(canopy_ecology_texture, vec2<i32>(next.x, base.y), 0).rgb;
  let s01 = textureLoad(canopy_ecology_texture, vec2<i32>(base.x, next.y), 0).rgb;
  let s11 = textureLoad(canopy_ecology_texture, next, 0).rgb;
  let sample = mix(mix(s00, s10, blend.x), mix(s01, s11, blend.x), blend.y);
  return vec4<f32>(sample, 1.0);
}
`;

const SYNTHETIC_FOREST_BLOCK = `  let base_forest = understory_fractalNoise2D(x, z, forest_scale, seed + 21001u, 3);
  let forest_influence = understory_smoothstep(0.32, 0.78, base_forest);
  let outer = understory_smoothstep(0.32 - 12.0 / edge_width, 0.32 + 12.0 / edge_width, base_forest);
  let inner = understory_smoothstep(0.78 - 12.0 / edge_width, 0.78 + 12.0 / edge_width, base_forest);
  let forest_edge = clamp(min(outer, 1.0 - inner) * 1.45, 0.0, 1.0);`;

const CANONICAL_FOREST_BLOCK = `  let base_forest = understory_fractalNoise2D(x, z, forest_scale, seed + 21001u, 3);
  let synthetic_forest_influence = understory_smoothstep(0.32, 0.78, base_forest);
  let outer = understory_smoothstep(0.32 - 12.0 / edge_width, 0.32 + 12.0 / edge_width, base_forest);
  let inner = understory_smoothstep(0.78 - 12.0 / edge_width, 0.78 + 12.0 / edge_width, base_forest);
  let synthetic_forest_edge = clamp(min(outer, 1.0 - inner) * 1.45, 0.0, 1.0);
  let canopy_ecology = sample_understory_canopy_ecology(vec2<f32>(x, z));
  let forest_influence = mix(synthetic_forest_influence, canopy_ecology.x, canopy_ecology.w);
  let forest_edge = mix(synthetic_forest_edge, canopy_ecology.y, canopy_ecology.w);`;

export function withUnderstoryCanopyEcology(source: string): string {
  if (source.includes("fn sample_understory_canopy_ecology")) return source;

  const withBinding = source.replace(
    "@group(0) @binding(10) var hydro_atlas_texture: texture_2d<f32>;\n",
    `@group(0) @binding(10) var hydro_atlas_texture: texture_2d<f32>;\n${TEXTURE_BINDING}`,
  );
  if (withBinding === source) {
    throw new Error("understory canopy ecology WGSL transform could not add texture binding");
  }

  const functionMarker = "fn placement_hydro_atlas_params() -> vec4<f32> {";
  const withFunction = withBinding.replace(functionMarker, `${CANOPY_ECOLOGY_WGSL}\n${functionMarker}`);
  if (withFunction === withBinding) {
    throw new Error("understory canopy ecology WGSL transform could not add sampler function");
  }

  const withCanonicalForest = withFunction.replace(SYNTHETIC_FOREST_BLOCK, CANONICAL_FOREST_BLOCK);
  if (withCanonicalForest === withFunction) {
    throw new Error("understory canopy ecology WGSL transform could not replace synthetic forest authority");
  }
  return withCanonicalForest;
}
