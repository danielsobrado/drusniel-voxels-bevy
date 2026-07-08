struct FarSummaryTileDescriptor {
  tile_x: i32,
  tile_z: i32,
  ring: u32,
  sample_grid: u32,
  origin_x: f32,
  origin_z: f32,
  size_x: f32,
  size_z: f32,
  revision: u32,
  flags: u32,
  tile_cells: u32,
  cell_size_m: f32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
  _pad3: u32,
};

struct FarSummaryGpuRecord {
  height_min_max: vec2<f32>,
  height_avg_slope: vec2<f32>,
  normal_avg: vec4<f32>,
  material_cover_a: vec4<f32>,
  material_cover_b: vec4<f32>,
  canopy_occ: vec4<f32>,
  record_meta: vec4<u32>,
  _pad0: vec4<u32>,
  _pad1: vec4<u32>,
};

@group(0) @binding(0) var<storage, read> descriptors: array<FarSummaryTileDescriptor>;
@group(0) @binding(1) var<storage, read_write> records: array<FarSummaryGpuRecord>;

@compute @workgroup_size(64)
fn build_far_summary(@builtin(global_invocation_id) id: vec3<u32>) {
  let tile_index = id.x;
  if (tile_index >= arrayLength(&descriptors)) {
    return;
  }

  let descriptor = descriptors[tile_index];
  let center_x = descriptor.origin_x + descriptor.size_x * 0.5;
  let center_z = descriptor.origin_z + descriptor.size_z * 0.5;
  let synthetic_height = sin(center_x * 0.001) * 8.0 + cos(center_z * 0.001) * 8.0;

  var record: FarSummaryGpuRecord;
  record.height_min_max = vec2<f32>(synthetic_height, synthetic_height);
  record.height_avg_slope = vec2<f32>(synthetic_height, 0.0);
  record.normal_avg = vec4<f32>(0.0, 1.0, 0.0, 0.0);
  record.material_cover_a = vec4<f32>(0.0, 1.0, 1.0, 0.0);
  record.material_cover_b = vec4<f32>(0.0, 0.0, 1.0, 1.0);
  record.canopy_occ = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  record.record_meta = vec4<u32>(0u, descriptor.revision, descriptor.flags, descriptor.sample_grid * descriptor.sample_grid);
  record._pad0 = vec4<u32>(0u);
  record._pad1 = vec4<u32>(0u);
  records[tile_index] = record;
}
