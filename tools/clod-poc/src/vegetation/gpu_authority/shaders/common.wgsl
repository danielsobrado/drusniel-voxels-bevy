struct VegetationSurfaceSample {
  position_ws: vec3<f32>,
  normal_ws: vec3<f32>,
  material_weights: vec4<f32>,
  water_depth_m: f32,
  shore_distance_m: f32,
  wetness: f32,
  moisture: f32,
  sediment: f32,
  deposition: f32,
  hardness: f32,
  flow: vec2<f32>,
  canopy_coverage: f32,
  canopy_height_m: f32,
  cave_coverage: f32,
  structure_coverage: f32,
  validity: u32,
  flags: u32,
};

struct VegetationClusterDescriptor {
  cluster_x: i32,
  cluster_z: i32,
  category: u32,
  candidate_count: u32,
  terrain_revision: u32,
  provider_revision: u32,
  flags: u32,
  reserved: u32,
};

struct ActiveVegetationCluster {
  descriptor_index: u32,
  rejection_mask: u32,
  visibility_class: u32,
  reserved: u32,
};

struct VegetationGenericInstance {
  position_scale: vec4<f32>,
  rotation_normal_y: vec4<f32>,
  identity: vec4<u32>,
  render0: vec4<f32>,
};

struct VegetationTreeInstance {
  position_scale: vec4<f32>,
  rotation_normal_y: vec4<f32>,
  identity: vec4<u32>,
  morphology0: vec4<f32>,
  morphology1: vec4<f32>,
  morphology2: vec4<f32>,
};
