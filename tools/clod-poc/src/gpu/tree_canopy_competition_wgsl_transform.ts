const PARAM_FIELD_MARKER = "  hydro_atlas: vec4<f32>,\n";
const TEXTURE_BINDING_MARKER = "@group(0) @binding(13) var hydro_atlas_texture: texture_2d<f32>;\n";
const COMPETITION_FUNCTION_MARKER = "fn tree_competition_sample(wpos: vec2<f32>, species: u32) -> TreeCompetitionSample {";
const NEXT_FUNCTION_MARKER = "fn clamp_morphology_vector(";

const CANONICAL_COMPETITION_FUNCTION = `fn sample_tree_canopy_competition(wpos: vec2<f32>) -> vec2<f32> {
  let world_size = params.canopy_competition.x;
  let resolution = i32(params.canopy_competition.y);
  if (params.canopy_competition.z < 0.5 || world_size <= 1.0 || resolution <= 1) {
    return vec2<f32>(0.0);
  }
  if (wpos.x < 0.0 || wpos.y < 0.0 || wpos.x > world_size || wpos.y > world_size) {
    return vec2<f32>(0.0);
  }

  let uv = clamp(wpos / world_size, vec2<f32>(0.0), vec2<f32>(1.0));
  let texel = uv * f32(resolution - 1);
  let base = min(vec2<i32>(floor(texel)), vec2<i32>(resolution - 1));
  let next = min(base + vec2<i32>(1), vec2<i32>(resolution - 1));
  let blend = fract(texel);
  let s00 = textureLoad(canopy_competition_texture, base, 0).a;
  let s10 = textureLoad(canopy_competition_texture, vec2<i32>(next.x, base.y), 0).a;
  let s01 = textureLoad(canopy_competition_texture, vec2<i32>(base.x, next.y), 0).a;
  let s11 = textureLoad(canopy_competition_texture, next, 0).a;
  let pressure = mix(mix(s00, s10, blend.x), mix(s01, s11, blend.x), blend.y);
  return vec2<f32>(clamp(pressure, 0.0, 1.0), 1.0);
}

fn tree_competition_sample(wpos: vec2<f32>, species: u32) -> TreeCompetitionSample {
  var pressure_sum = 0.0;
  var pressure_vector = vec2<f32>(0.0);
  for (var radius_index = 1; radius_index <= 3; radius_index = radius_index + 1) {
    var radius_m = 8.0;
    if (radius_index == 2) { radius_m = 16.0; }
    if (radius_index == 3) { radius_m = 32.0; }
    for (var direction_index = 0; direction_index < 8; direction_index = direction_index + 1) {
      let angle = f32(direction_index) * 0.78539816339;
      let direction = vec2<f32>(cos(angle), sin(angle));
      let sample_cell = floor((wpos + direction * radius_m) / 3.4);
      let occupancy = tree_pcg2d(sample_cell, params.settings_u.z ^ 0x1005u ^ species).x;
      let pressure = smoothstep(0.42, 0.92, occupancy) / 3.0;
      pressure_sum = pressure_sum + pressure;
      pressure_vector = pressure_vector + direction * pressure;
    }
  }
  let synthetic_pressure = clamp(pressure_sum / 8.0, 0.0, 1.0);
  let canonical = sample_tree_canopy_competition(wpos);
  let magnitude = length(pressure_vector);
  let open_direction = select(vec2<f32>(1.0, 0.0), -pressure_vector / max(magnitude, 1e-6), magnitude > 1e-6);
  return TreeCompetitionSample(
    mix(synthetic_pressure, canonical.x, canonical.y),
    clamp(magnitude / 8.0, 0.0, 1.0),
    open_direction,
  );
}

`;

export function withTreeCanopyCompetition(source: string): string {
  if (source.includes("fn sample_tree_canopy_competition")) return source;

  const withParams = source.replace(
    PARAM_FIELD_MARKER,
    `${PARAM_FIELD_MARKER}  canopy_competition: vec4<f32>,\n`,
  );
  if (withParams === source) {
    throw new Error("tree canopy competition WGSL transform could not add params");
  }

  const withBinding = withParams.replace(
    TEXTURE_BINDING_MARKER,
    `${TEXTURE_BINDING_MARKER}@group(0) @binding(17) var canopy_competition_texture: texture_2d<f32>;\n`,
  );
  if (withBinding === withParams) {
    throw new Error("tree canopy competition WGSL transform could not add texture binding");
  }

  const functionStart = withBinding.indexOf(COMPETITION_FUNCTION_MARKER);
  const functionEnd = withBinding.indexOf(NEXT_FUNCTION_MARKER, functionStart);
  if (functionStart < 0 || functionEnd < 0) {
    throw new Error("tree canopy competition WGSL transform could not replace competition authority");
  }

  return `${withBinding.slice(0, functionStart)}${CANONICAL_COMPETITION_FUNCTION}${withBinding.slice(functionEnd)}`;
}
