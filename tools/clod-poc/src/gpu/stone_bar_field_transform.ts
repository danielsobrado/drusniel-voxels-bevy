import { gravelBarSeedPhase } from "../water/gravel_bar_field.js";
import {
  gravelBarStonesEnabled,
  readGravelBarSettings,
} from "../water/gravel_bar_runtime.js";

export function withGravelBarStones(source: string): string {
  const config = readGravelBarSettings();
  let next = source;
  next = insertAfter(
    next,
    /const RIVER_COBBLE_MIN_NORMAL_Y: f32 = -?\d+(?:\.\d+)?;/,
    gravelConstants(config),
  );
  next = requiredReplace(next, FIELDS_STRUCT, FIELDS_STRUCT_WITH_PHASE);
  next = next.replaceAll(
    "StoneHydrologyFieldsSample(0.0, 0u, 0.0)",
    "StoneHydrologyFieldsSample(0.0, 0.0, 0.0, 0u, 0.0, 0.0)",
  );
  next = requiredReplace(next, STREAM_FIELDS_RETURN, STREAM_FIELDS_RETURN_WITH_PHASE);
  next = requiredReplace(next, STATIC_FIELDS_RETURN, STATIC_FIELDS_RETURN_WITH_PHASE);
  next = requiredReplace(next, "fn material_weights(height: f32) -> vec4<f32> {", `${GRAVEL_MASK_WGSL}\nfn material_weights(height: f32) -> vec4<f32> {`);
  next = requiredReplace(next, PROCESS_MASKS, PROCESS_MASKS_WITH_GRAVEL);
  next = requiredReplace(next, "&& !underwater_cobble) {", "&& !special_wet_stone) {");
  next = requiredReplace(next, ACCEPT_MASKS, ACCEPT_MASKS_WITH_GRAVEL);
  next = requiredReplace(next, "    underwater_cobble,\n  );", "    special_wet_stone,\n  );");
  next = requiredReplace(next, VARIANT_META, VARIANT_META_WITH_GRAVEL);
  return next;
}

const FIELDS_STRUCT = `struct StoneHydrologyFieldsSample {
  flow_strength: f32,
  body_kind: u32,
  enabled: f32,
};`;

const FIELDS_STRUCT_WITH_PHASE = `struct StoneHydrologyFieldsSample {
  flow_x: f32,
  flow_z: f32,
  flow_strength: f32,
  body_kind: u32,
  body_phase: f32,
  enabled: f32,
};`;

const STREAM_FIELDS_RETURN = `    let fields = textureLoad(hydro_fields_atlas_texture, vec2<i32>(ix, iz), 0);
    return StoneHydrologyFieldsSample(max(0.0, fields.z), u32(round(max(0.0, fields.w))), 1.0);`;

const STREAM_FIELDS_RETURN_WITH_PHASE = `    let fields = textureLoad(hydro_fields_atlas_texture, vec2<i32>(ix, iz), 0);
    let encoded_kind = max(0.0, fields.w);
    let body_kind = u32(round(encoded_kind));
    let body_phase = clamp(fract(encoded_kind) * 4.0, 0.0, 1.0);
    return StoneHydrologyFieldsSample(fields.x, fields.y, max(0.0, fields.z), body_kind, body_phase, 1.0);`;

const STATIC_FIELDS_RETURN = `  let fields = textureSampleLevel(hydro_fields_texture, hydro_sampler, uv, 0.0);
  let body_kind = u32(round(clamp(fields.w, 0.0, 1.0) * 255.0));
  return StoneHydrologyFieldsSample(length(fields.xy), body_kind, 1.0);`;

const STATIC_FIELDS_RETURN_WITH_PHASE = `  let fields = textureSampleLevel(hydro_fields_texture, hydro_sampler, uv, 0.0);
  let encoded_kind = clamp(fields.w, 0.0, 1.0) * 255.0;
  let body_kind = u32(round(encoded_kind));
  let body_phase = clamp(fract(encoded_kind) * 4.0, 0.0, 1.0);
  return StoneHydrologyFieldsSample(fields.x, fields.y, length(fields.xy), body_kind, body_phase, 1.0);`;

const PROCESS_MASKS = `  let river_cobble = river_cobble_mask(hydro, hydro_fields, normal.y);
  let underwater_cobble = river_cobble > 0.0;`;

const PROCESS_MASKS_WITH_GRAVEL = `  let river_cobble = river_cobble_mask(hydro, hydro_fields, normal.y);
  let gravel_bar = gravel_bar_mask(wpos.x, wpos.y, hydro, hydro_fields);
  let underwater_cobble = river_cobble > 0.0;
  let gravel_bar_stone = gravel_bar > 0.0;
  let special_wet_stone = underwater_cobble || gravel_bar_stone;`;

const ACCEPT_MASKS = `  let cobble_accept = params.world.z * river_cobble * clump * repose * ring_edge;
  let accept = select(dry_accept, cobble_accept, underwater_cobble);`;

const ACCEPT_MASKS_WITH_GRAVEL = `  let cobble_accept = params.world.z * river_cobble * clump * repose * ring_edge;
  let gravel_accept = params.world.z * gravel_bar * clump * repose * ring_edge;
  let accept = select(dry_accept, max(cobble_accept, gravel_accept), special_wet_stone);`;

const VARIANT_META = `  let variant = select(sampled_variant, 0u, underwater_cobble);
  let underwater_meta = select(0.0, STONE_META_UNDERWATER_FLAG, underwater_cobble);`;

const VARIANT_META_WITH_GRAVEL = `  let variant = select(sampled_variant, 0u, special_wet_stone);
  let underwater_meta = select(0.0, STONE_META_UNDERWATER_FLAG, special_wet_stone);`;

const GRAVEL_MASK_WGSL = `fn gravel_bar_unit_sin(value: f32) -> f32 {
  return sin(value * TAU) * 0.5 + 0.5;
}

fn gravel_bar_mask(wx: f32, wz: f32, hydro: StoneHydrologySample, fields: StoneHydrologyFieldsSample) -> f32 {
  if (!GRAVEL_BAR_ENABLED || hydro.enabled < 0.5 || fields.enabled < 0.5 || fields.body_kind != HYDROLOGY_BODY_RIVER) {
    return 0.0;
  }
  let flow = vec2<f32>(fields.flow_x, fields.flow_z);
  let flow_length = length(flow);
  if (flow_length <= 0.00001 || hydro.wet_mask <= 0.02) {
    return 0.0;
  }
  let direction = flow / flow_length;
  let along = dot(vec2<f32>(wx, wz), direction) / GRAVEL_BAR_LONGITUDINAL_PERIOD_M;
  let across = dot(vec2<f32>(wx, wz), vec2<f32>(-direction.y, direction.x)) / GRAVEL_BAR_CROSS_PERIOD_M;
  let phase = fields.body_phase + GRAVEL_BAR_SEED_PHASE;
  let longitudinal_wave = gravel_bar_unit_sin(along + phase);
  let side_wave = gravel_bar_unit_sin(across + along * 0.47 + phase * 1.73);
  let breakup_wave = gravel_bar_unit_sin(along * 2.17 - across * 1.31 + phase * 3.11);
  let pattern = stone_mask_ramp(GRAVEL_BAR_PATTERN_START, GRAVEL_BAR_PATTERN_END, longitudinal_wave)
    * stone_mask_ramp(0.42, 0.72, side_wave)
    * mix(1.0, stone_mask_ramp(0.22, 0.78, breakup_wave), GRAVEL_BAR_BREAKUP_STRENGTH);
  let depth = max(0.0, hydro.water_y - hydro.carved_bed);
  return clamp(GRAVEL_BAR_STRENGTH * hydro.wet_mask * pattern
    * stone_mask_band(max(0.0, hydro.shore_distance), GRAVEL_BAR_MIN_SHORE_M, GRAVEL_BAR_MAX_SHORE_M)
    * stone_mask_band(depth, GRAVEL_BAR_MIN_DEPTH_M, GRAVEL_BAR_MAX_DEPTH_M)
    * stone_mask_band(fields.flow_strength, GRAVEL_BAR_MIN_FLOW, GRAVEL_BAR_MAX_FLOW), 0.0, 1.0);
}`;

function gravelConstants(config: ReturnType<typeof readGravelBarSettings>): string {
  return [
    `const GRAVEL_BAR_ENABLED: bool = ${gravelBarStonesEnabled() ? "true" : "false"};`,
    constant("GRAVEL_BAR_STRENGTH", config.strength),
    constant("GRAVEL_BAR_SEED_PHASE", gravelBarSeedPhase(config.seedSalt)),
    constant("GRAVEL_BAR_LONGITUDINAL_PERIOD_M", config.longitudinalPeriodM),
    constant("GRAVEL_BAR_CROSS_PERIOD_M", config.crossPeriodM),
    constant("GRAVEL_BAR_PATTERN_START", config.patternStart),
    constant("GRAVEL_BAR_PATTERN_END", config.patternEnd),
    constant("GRAVEL_BAR_BREAKUP_STRENGTH", config.breakupStrength),
    constant("GRAVEL_BAR_MIN_SHORE_M", config.minShoreDistanceM),
    constant("GRAVEL_BAR_MAX_SHORE_M", config.maxShoreDistanceM),
    constant("GRAVEL_BAR_MIN_DEPTH_M", config.minDepthM),
    constant("GRAVEL_BAR_MAX_DEPTH_M", config.maxDepthM),
    constant("GRAVEL_BAR_MIN_FLOW", config.minFlowStrength),
    constant("GRAVEL_BAR_MAX_FLOW", config.maxFlowStrength),
  ].join("\n");
}

function insertAfter(source: string, pattern: RegExp, addition: string): string {
  const match = source.match(pattern);
  if (!match) throw new Error("stone bar-field WGSL constants anchor missing");
  return source.replace(match[0], `${match[0]}\n${addition}`);
}

function requiredReplace(source: string, search: string, replacement: string): string {
  if (!source.includes(search)) throw new Error(`stone bar-field WGSL anchor missing: ${search.slice(0, 80)}`);
  return source.replace(search, replacement);
}

function constant(name: string, value: number): string {
  const finite = Number.isFinite(value) ? value : 0;
  const text = finite.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return `const ${name}: f32 = ${text.includes(".") ? text : `${text}.0`};`;
}
