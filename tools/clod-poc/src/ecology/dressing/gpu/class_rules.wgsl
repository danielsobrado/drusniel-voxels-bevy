const DRESSING_CLASS_COUNT: u32 = 29u;
const DEAD_LOG_FRESH: u32 = 1u;
const DEAD_LOG_MOSSY: u32 = 2u;
const DEAD_LOG_ROTTEN: u32 = 3u;
const RIVER_COBBLES: u32 = 23u;
const WET_STONE_CLUSTER: u32 = 24u;
const CAVE_MOUTH_FERN: u32 = 27u;
const CLIFF_FERN: u32 = 28u;

struct DressingEnvironment {
  position_water_depth: vec4<f32>,
  normal_shore_distance: vec4<f32>,
  material_weights: vec4<f32>,
  flow_moisture_wetness: vec4<f32>,
  canopy_sky_hardness: vec4<f32>,
  sediment_deposition_flags: vec4<f32>,
  forest_sun_cave_padding: vec4<f32>,
  reserved: vec4<f32>,
};

struct DressingInstance {
  transform_0: vec4<f32>,
  transform_1: vec4<f32>,
  identity: vec4<u32>,
  data: vec4<f32>,
};

fn dressing_accept(class_id: u32, env: DressingEnvironment) -> bool {
  let water_depth = env.position_water_depth.w;
  let shore_distance = env.normal_shore_distance.w;
  let flow_speed = length(env.flow_moisture_wetness.xy);
  let moisture = env.flow_moisture_wetness.z;
  let wetness = env.flow_moisture_wetness.w;
  if (class_id >= DEAD_LOG_FRESH && class_id <= DEAD_LOG_ROTTEN) {
    return env.normal_shore_distance.y >= 0.8660254 && water_depth <= 0.12;
  }
  if (class_id == RIVER_COBBLES) {
    return shore_distance >= -2.0 && shore_distance <= 4.0 && flow_speed >= 0.15;
  }
  if (class_id == WET_STONE_CLUSTER) {
    return (shore_distance >= -1.0 && shore_distance <= 2.0) || wetness >= 0.7;
  }
  if (class_id == CAVE_MOUTH_FERN) {
    let sky = env.canopy_sky_hardness.z;
    return env.forest_sun_cave_padding.z >= 0.45 && sky >= 0.1 && sky <= 0.65 && moisture >= 0.5;
  }
  if (class_id == CLIFF_FERN) {
    let slope_y = env.normal_shore_distance.y;
    return slope_y <= 0.573576 && slope_y >= 0.034899 && moisture >= 0.45 && env.material_weights.y >= 0.45;
  }
  return water_depth <= 0.12;
}
