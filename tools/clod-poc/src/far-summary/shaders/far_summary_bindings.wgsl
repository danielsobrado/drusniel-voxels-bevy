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
  cell_record_offset: u32,
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
@group(0) @binding(2) var<storage, read> digEdits: array<DigEdit>;
@group(0) @binding(3) var<uniform> fieldParams: FieldParams;
@group(0) @binding(4) var<storage, read_write> cell_records: array<FarSummaryGpuRecord>;
