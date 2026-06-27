// Shared final terrain-height sampling for GPU vegetation placement.
// Requires the including shader to declare:
//   @group(0) @binding(N) var hydro_texture: texture_2d<f32>;
//   @group(0) @binding(M) var hydro_sampler: sampler;

const PLACEMENT_COAST_OCEAN_START_CELLS: f32 = 48.0;
const PLACEMENT_COAST_SHORE_BACKSHORE_CELLS: f32 = 32.0;
const PLACEMENT_BEACH_WATERLINE_OFFSET: f32 = -0.25;
const PLACEMENT_BEACH_BACKSHORE_HEIGHT_ABOVE_WATER: f32 = 5.0;
const PLACEMENT_BEACH_SHELF_CELLS: f32 = 8.0;
const PLACEMENT_COAST_MAX_BLEND_CELLS: f32 = 16.0;
const PLACEMENT_COAST_MIN_INLAND_CORE_WORLD_FRACTION: f32 = 0.18;
const PLACEMENT_BEACH_DRY_INFLUENCE_SHELF_FRACTION: f32 = 0.85;
const PLACEMENT_BEACH_HIGHLAND_START_ABOVE_BACKSHORE: f32 = 6.0;
const PLACEMENT_BEACH_HIGHLAND_FULL_EXTRA_CELLS: f32 = 12.0;
const PLACEMENT_BEACH_HIGHLAND_PRESERVE_SHORE_FRACTION: f32 = 0.72;
const PLACEMENT_CLIFF_MIN_HEIGHT_ABOVE_WATER: f32 = 16.0;
const PLACEMENT_CLIFF_INLAND_BOOST: f32 = 4.0;

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

fn placement_max_coast_band_cells(world_size: f32) -> f32 {
  let half_world_cells = max(1.0, floor(world_size * 0.5));
  let inland_core_cells = max(8.0, floor(half_world_cells * PLACEMENT_COAST_MIN_INLAND_CORE_WORLD_FRACTION));
  return max(1.0, half_world_cells - inland_core_cells - PLACEMENT_COAST_MAX_BLEND_CELLS);
}

fn placement_resolved_coast_scale(world_size: f32) -> f32 {
  let configured = PLACEMENT_COAST_OCEAN_START_CELLS + PLACEMENT_COAST_SHORE_BACKSHORE_CELLS;
  return min(1.0, placement_max_coast_band_cells(world_size) / max(1.0, configured));
}

fn placement_edge_distance(wx: f32, wz: f32, world_size: f32) -> f32 {
  let max_cell = max(0.0, world_size - 1.0);
  let xi = floor(wx);
  let zi = floor(wz);
  return min(min(xi, max_cell - xi), min(zi, max_cell - zi));
}

fn placement_beach_shore_influence(edge_distance: f32, ocean_start: f32, beach_shelf: f32) -> f32 {
  let shelf = max(1.0, beach_shelf);
  let fade_start = ocean_start + shelf * PLACEMENT_BEACH_DRY_INFLUENCE_SHELF_FRACTION;
  let fade_end = ocean_start + shelf;
  return 1.0 - smoothstepRange(fade_start, fade_end, edge_distance);
}

fn placement_beach_height(edge_distance: f32, inland_height: f32, ocean_start: f32, shore_backshore: f32, beach_shelf: f32) -> f32 {
  let shore_t = clamp(edge_distance / max(1.0, ocean_start), 0.0, 1.0);
  let waterline = WATER_LEVEL + PLACEMENT_BEACH_WATERLINE_OFFSET;
  let backshore_height = WATER_LEVEL + PLACEMENT_BEACH_BACKSHORE_HEIGHT_ABOVE_WATER;
  let dry_beach = mix(waterline, backshore_height, smooth01(shore_t));
  if (edge_distance < ocean_start) { return dry_beach; }
  let inland_target = max(inland_height, waterline);
  let blend_width = max(1.0, shore_backshore - beach_shelf);
  let delayed_backshore_t = clamp((edge_distance - ocean_start - beach_shelf) / blend_width, 0.0, 1.0);
  return mix(dry_beach, inland_target, smooth01(delayed_backshore_t));
}

fn placement_beach_highland_preserve(edge_distance: f32, inland_height: f32, ocean_start: f32, beach_shelf: f32) -> f32 {
  let backshore_height = WATER_LEVEL + PLACEMENT_BEACH_BACKSHORE_HEIGHT_ABOVE_WATER;
  let start_height = backshore_height + PLACEMENT_BEACH_HIGHLAND_START_ABOVE_BACKSHORE;
  let full_height = max(
    start_height + PLACEMENT_BEACH_HIGHLAND_FULL_EXTRA_CELLS,
    WATER_LEVEL + PLACEMENT_CLIFF_MIN_HEIGHT_ABOVE_WATER + PLACEMENT_CLIFF_INLAND_BOOST
  );
  let highland = smoothstepRange(start_height, full_height, inland_height);
  let dry_side = smoothstepRange(
    ocean_start * PLACEMENT_BEACH_HIGHLAND_PRESERVE_SHORE_FRACTION,
    ocean_start + max(1.0, beach_shelf),
    edge_distance
  );
  return highland * dry_side;
}

fn placement_border_coast_height(wx: f32, wz: f32, inland_height: f32, world_size: f32) -> f32 {
  let scale = placement_resolved_coast_scale(world_size);
  let ocean_start = max(1.0, floor(PLACEMENT_COAST_OCEAN_START_CELLS * scale));
  let shore_backshore = max(1.0, floor(PLACEMENT_COAST_SHORE_BACKSHORE_CELLS * scale));
  let beach_shelf = min(shore_backshore, max(0.0, floor(PLACEMENT_BEACH_SHELF_CELLS * scale)));
  let edge_distance = placement_edge_distance(wx, wz, world_size);
  let beach_reach = placement_beach_shore_influence(edge_distance, ocean_start, beach_shelf);
  if (beach_reach <= 0.0001) { return inland_height; }
  let raw_beach = placement_beach_height(edge_distance, inland_height, ocean_start, shore_backshore, beach_shelf);
  let beach = mix(inland_height, raw_beach, beach_reach);
  let preserve = placement_beach_highland_preserve(edge_distance, inland_height, ocean_start, beach_shelf);
  return mix(beach, inland_height, preserve);
}

fn placement_ground_height(wx: f32, wz: f32, world_size: f32) -> f32 {
  let raw_height = surfaceHeightField(wx, wz);
  if (!placement_hydro_enabled()) {
    return placement_border_coast_height(wx, wz, raw_height, world_size);
  }
  let carved_bed = placement_sample_carved_bed_bilinear(wx, wz, world_size);
  return placement_border_coast_height(wx, wz, carved_bed, world_size);
}

fn placement_hydrology_height(wx: f32, wz: f32, world_size: f32, base_height: f32) -> vec2<f32> {
  if (!placement_hydro_enabled()) {
    return vec2<f32>(placement_border_coast_height(wx, wz, base_height, world_size), 0.0);
  }
  let hydro = placement_sample_hydro_bilinear(wx, wz, world_size);
  let carved_bed = placement_border_coast_height(wx, wz, hydro.z, world_size);
  let wet_mask = hydro.y;
  let height_diff = abs(carved_bed - base_height);
  let height = select(placement_border_coast_height(wx, wz, base_height, world_size), carved_bed, height_diff > 0.01);
  return vec2<f32>(height, wet_mask);
}
