import { DEFAULT_ENVIRONMENTAL_MASK_SETTINGS } from "../environment_masks/environment_mask_config.js";
import {
  STONE_META_UNDERWATER_FLAG,
  STONE_META_VARIANT_SCALE,
} from "../stones/stone_instance_meta.js";

export function withUnderwaterRiverCobbles(source: string): string {
  const config = DEFAULT_ENVIRONMENTAL_MASK_SETTINGS.riverCobble;
  let next = source;

  next = replaceRequired(next,
    "// Packed source meta: source_b.w = variant * STONE_META_VARIANT_SCALE + sink_depth.\nconst STONE_META_VARIANT_SCALE: f32 = 32.0;",
    `// Packed source meta keeps variant, underwater state, and sink depth in one lane.\nconst STONE_META_VARIANT_SCALE: f32 = ${wgslFloat(STONE_META_VARIANT_SCALE)};\nconst STONE_META_UNDERWATER_FLAG: f32 = ${wgslFloat(STONE_META_UNDERWATER_FLAG)};\nconst HYDROLOGY_BODY_RIVER: u32 = 3u;\nconst RIVER_COBBLE_STRENGTH: f32 = ${wgslFloat(config.strength)};\nconst RIVER_COBBLE_MIN_DEPTH_M: f32 = ${wgslFloat(config.minDepthM)};\nconst RIVER_COBBLE_MAX_DEPTH_M: f32 = ${wgslFloat(config.maxDepthM)};\nconst RIVER_COBBLE_MIN_FLOW: f32 = ${wgslFloat(config.minFlowStrength)};\nconst RIVER_COBBLE_MAX_FLOW: f32 = ${wgslFloat(config.maxFlowStrength)};\nconst RIVER_COBBLE_MAX_SHORE_M: f32 = ${wgslFloat(config.maxShoreDistanceM)};\nconst RIVER_COBBLE_MIN_NORMAL_Y: f32 = ${wgslFloat(config.minNormalY)};`,
  );

  next = replaceRequired(next,
    `struct StoneHydrologySample {
  water_y: f32,
  wet_mask: f32,
  carved_bed: f32,
  enabled: f32,
};`,
    `struct StoneHydrologySample {
  water_y: f32,
  wet_mask: f32,
  carved_bed: f32,
  shore_distance: f32,
  enabled: f32,
};

struct StoneHydrologyFieldsSample {
  flow_strength: f32,
  body_kind: u32,
  enabled: f32,
};`,
  );

  next = replaceRequired(next,
    `fn hydrology_at(wx: f32, wz: f32) -> StoneHydrologySample {
  let dims = textureDimensions(hydro_texture);
  if (dims.x <= 1u || dims.y <= 1u) {
    return StoneHydrologySample(0.0, 0.0, 0.0, 0.0);
  }
  let world_size = max(1.0, params.world.x);
  if (!placement_inside_startup_world(wx, wz, world_size) && placement_hydro_atlas_enabled()) {
    let atlas = placement_sample_hydro_atlas(wx, wz);
    if (!placement_hydro_sample_valid(atlas)) {
      return StoneHydrologySample(0.0, 0.0, 0.0, 0.0);
    }
    return StoneHydrologySample(atlas.x, atlas.y, atlas.z, 1.0);
  }
  let uv = clamp(vec2<f32>(wx, wz) / world_size, vec2<f32>(0.0), vec2<f32>(1.0));
  let h = textureSampleLevel(hydro_texture, hydro_sampler, uv, 0.0);
  return StoneHydrologySample(h.x, h.y, h.z, 1.0);
}`,
    `fn hydrology_at(wx: f32, wz: f32) -> StoneHydrologySample {
  let dims = textureDimensions(hydro_texture);
  if (dims.x <= 1u || dims.y <= 1u) {
    return StoneHydrologySample(0.0, 0.0, 0.0, 0.0, 0.0);
  }
  let world_size = max(1.0, params.world.x);
  if (!placement_inside_startup_world(wx, wz, world_size) && placement_hydro_atlas_enabled()) {
    let atlas = placement_sample_hydro_atlas(wx, wz);
    if (!placement_hydro_sample_valid(atlas)) {
      return StoneHydrologySample(0.0, 0.0, 0.0, 0.0, 0.0);
    }
    return StoneHydrologySample(atlas.x, atlas.y, atlas.z, atlas.w, 1.0);
  }
  let uv = clamp(vec2<f32>(wx, wz) / world_size, vec2<f32>(0.0), vec2<f32>(1.0));
  let h = textureSampleLevel(hydro_texture, hydro_sampler, uv, 0.0);
  return StoneHydrologySample(h.x, h.y, h.z, h.w, 1.0);
}

fn hydrology_fields_at(wx: f32, wz: f32) -> StoneHydrologyFieldsSample {
  let world_size = max(1.0, params.world.x);
  if (!placement_inside_startup_world(wx, wz, world_size) && placement_hydro_atlas_enabled()) {
    let p = placement_hydro_atlas_params();
    let res = i32(textureDimensions(hydro_fields_atlas_texture).x);
    let gx = (wx - p.x) / max(p.z, 0.0001);
    let gz = (wz - p.y) / max(p.z, 0.0001);
    if (res <= 1 || gx < 0.0 || gz < 0.0 || gx > f32(res - 1) || gz > f32(res - 1)) {
      return StoneHydrologyFieldsSample(0.0, 0u, 0.0);
    }
    let ix = clamp(i32(round(gx)), 0, res - 1);
    let iz = clamp(i32(round(gz)), 0, res - 1);
    let fields = textureLoad(hydro_fields_atlas_texture, vec2<i32>(ix, iz), 0);
    return StoneHydrologyFieldsSample(max(0.0, fields.z), u32(round(max(0.0, fields.w))), 1.0);
  }
  let dims = textureDimensions(hydro_fields_texture);
  if (dims.x <= 1u || dims.y <= 1u) {
    return StoneHydrologyFieldsSample(0.0, 0u, 0.0);
  }
  let uv = clamp(vec2<f32>(wx, wz) / world_size, vec2<f32>(0.0), vec2<f32>(1.0));
  let fields = textureSampleLevel(hydro_fields_texture, hydro_sampler, uv, 0.0);
  let body_kind = u32(round(clamp(fields.w, 0.0, 1.0) * 255.0));
  return StoneHydrologyFieldsSample(length(fields.xy), body_kind, 1.0);
}`,
  );

  next = replaceRequired(next,
    `fn material_weights(height: f32) -> vec4<f32> {`,
    `fn stone_mask_ramp(edge0: f32, edge1: f32, value: f32) -> f32 {
  if (!(edge1 > edge0)) {
    return select(0.0, 1.0, value >= edge1);
  }
  let t = clamp((value - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn stone_mask_band(value: f32, min_value: f32, max_value: f32) -> f32 {
  if (!(max_value > min_value)) {
    return 0.0;
  }
  let width = max(0.001, (max_value - min_value) * 0.25);
  return stone_mask_ramp(min_value, min(max_value, min_value + width), value)
    * (1.0 - stone_mask_ramp(max(min_value, max_value - width), max_value, value));
}

fn river_cobble_mask(
  hydro: StoneHydrologySample,
  fields: StoneHydrologyFieldsSample,
  normal_y: f32,
) -> f32 {
  if (params.counts_a.w == 0u || hydro.enabled < 0.5 || fields.enabled < 0.5) {
    return 0.0;
  }
  if (hydro.wet_mask <= 0.05 || fields.body_kind != HYDROLOGY_BODY_RIVER) {
    return 0.0;
  }
  let depth = max(0.0, hydro.water_y - hydro.carved_bed);
  let shore = max(0.0, hydro.shore_distance);
  return clamp(
    RIVER_COBBLE_STRENGTH
      * stone_mask_band(depth, RIVER_COBBLE_MIN_DEPTH_M, RIVER_COBBLE_MAX_DEPTH_M)
      * stone_mask_band(fields.flow_strength, RIVER_COBBLE_MIN_FLOW, RIVER_COBBLE_MAX_FLOW)
      * (1.0 - stone_mask_ramp(RIVER_COBBLE_MAX_SHORE_M * 0.65, RIVER_COBBLE_MAX_SHORE_M, shore))
      * stone_mask_ramp(RIVER_COBBLE_MIN_NORMAL_Y, min(1.0, RIVER_COBBLE_MIN_NORMAL_Y + 0.16), normal_y),
    0.0,
    1.0,
  );
}

fn material_weights(height: f32) -> vec4<f32> {`,
  );

  next = replaceRequired(next,
    `fn ring_edge_fade(dist: f32) -> f32 {`,
    `fn pick_river_cobble_class(roll: f32) -> u32 {
  return select(CLASS_MEDIUM, CLASS_SMALL, roll >= 0.35);
}

fn ring_edge_fade(dist: f32) -> f32 {`,
  );

  next = replaceRequired(next,
    `  let world_size = params.world.x;
  let hydro = hydrology_at(wpos.x, wpos.y);
  let h = placement_ground_height(wpos.x, wpos.y, world_size);`,
    `  let world_size = params.world.x;
  let hydro = hydrology_at(wpos.x, wpos.y);
  var hydro_fields = StoneHydrologyFieldsSample(0.0, 0u, 0.0);
  if (params.counts_a.w != 0u) {
    hydro_fields = hydrology_fields_at(wpos.x, wpos.y);
  }
  let h = placement_ground_height(wpos.x, wpos.y, world_size);`,
  );

  next = replaceRequired(next,
    `  let terrain = terrain_bias(h, weights);
  let hydro_streambed = hydrology_streambed_mask(hydro, h);

  if (h < WATER_LEVEL + params.slope_water.z || hydrology_reject_stone(hydro, h)) {
    atomicAdd(&counters[COUNTER_REJECT_BELOW_WATER], 1u);
    return;
  }`,
    `  let terrain = terrain_bias(h, weights);
  let hydro_streambed = hydrology_streambed_mask(hydro, h);
  let river_cobble = river_cobble_mask(hydro, hydro_fields, normal.y);
  let underwater_cobble = river_cobble > 0.0;

  if ((h < WATER_LEVEL + params.slope_water.z || hydrology_reject_stone(hydro, h)) && !underwater_cobble) {
    atomicAdd(&counters[COUNTER_REJECT_BELOW_WATER], 1u);
    return;
  }`,
  );

  next = replaceRequired(next,
    `  let ring_edge = ring_edge_fade(dist);
  let accept = params.world.z * base * clump * repose * terrain.x * ring_edge * (1.0 - snow * params.stream_snow_lean.z);`,
    `  let ring_edge = ring_edge_fade(dist);
  let dry_accept = params.world.z * base * clump * repose * terrain.x * ring_edge * (1.0 - snow * params.stream_snow_lean.z);
  let cobble_accept = params.world.z * river_cobble * clump * repose * ring_edge;
  let accept = select(dry_accept, cobble_accept, underwater_cobble);`,
  );

  next = replaceRequired(next,
    `  let cls = pick_class(scree, streambed, cliff_above, terrain, pcg2d(wc, seed + 523u).x);`,
    `  let class_roll = pcg2d(wc, seed + 523u).x;
  let cls = select(
    pick_class(scree, streambed, cliff_above, terrain, class_roll),
    pick_river_cobble_class(class_roll),
    underwater_cobble,
  );`,
  );

  next = replaceRequired(next,
    `  let variant = min(
    class_variant_count(cls) - 1u,
    u32(pcg2d(wc, seed + 941u).x * f32(class_variant_count(cls))),
  );
  let out_index = cls * max_instances + class_slot;
  source_a[out_index] = vec4<f32>(wpos.x, y, wpos.y, scale);
  source_b[out_index] = vec4<f32>(yaw, lean.x, lean.y, f32(variant) * STONE_META_VARIANT_SCALE + sink_depth);`,
    `  let sampled_variant = min(
    class_variant_count(cls) - 1u,
    u32(pcg2d(wc, seed + 941u).x * f32(class_variant_count(cls))),
  );
  let variant = select(sampled_variant, 0u, underwater_cobble);
  let underwater_meta = select(0.0, STONE_META_UNDERWATER_FLAG, underwater_cobble);
  let out_index = cls * max_instances + class_slot;
  source_a[out_index] = vec4<f32>(wpos.x, y, wpos.y, scale);
  source_b[out_index] = vec4<f32>(
    yaw,
    lean.x,
    lean.y,
    f32(variant) * STONE_META_VARIANT_SCALE + underwater_meta + sink_depth,
  );`,
  );

  next = replaceRequired(next,
    `  let variant = u32(floor(src_b.w / STONE_META_VARIANT_SCALE));
  let sink_depth = src_b.w - f32(variant) * STONE_META_VARIANT_SCALE;`,
    `  let variant = u32(floor(src_b.w / STONE_META_VARIANT_SCALE));
  let meta_lane = src_b.w - f32(variant) * STONE_META_VARIANT_SCALE;
  let underwater = meta_lane >= STONE_META_UNDERWATER_FLAG;
  let sink_depth = meta_lane - select(0.0, STONE_META_UNDERWATER_FLAG, underwater);`,
  );

  next = replaceRequired(next,
    `  instance_b[draw_index] = vec4<f32>(src_b.x, src_b.y, src_b.z, sink_depth);`,
    `  let underwater_meta = select(0.0, STONE_META_UNDERWATER_FLAG, underwater);
  instance_b[draw_index] = vec4<f32>(src_b.x, src_b.y, src_b.z, sink_depth + underwater_meta);`,
  );

  return next;
}

function replaceRequired(source: string, search: string, replacement: string): string {
  if (!source.includes(search)) {
    throw new Error(`stone river-cobble WGSL anchor missing: ${search.slice(0, 80)}`);
  }
  return source.replace(search, replacement);
}

function wgslFloat(value: number): string {
  const finite = Number.isFinite(value) ? value : 0;
  const text = finite.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return text.includes(".") ? text : `${text}.0`;
}
