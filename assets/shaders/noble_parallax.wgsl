// Ported from Noble Shaders by Belmu (GPL-3.0).
#define_import_path noble_parallax

#import noble_gerstner
#import bevy_water::water_bindings::material

fn parallaxMappingWater(coords: vec2<f32>, tangentDirection: vec3<f32>, octaves: i32) -> vec2<f32> {
    let layer_count = 4.0;
    let layer_height = 1.0 / layer_count;
    let depth = max(material.amplitude * 0.06, 0.01);
    let safe_z = max(abs(tangentDirection.z), 0.08);
    let increment = tangentDirection.xy / safe_z * depth * layer_height;

    var curr_coords = coords;
    var curr_height = noble_gerstner::calculateWaveHeightGerstner(curr_coords, octaves);
    var prev_height = curr_height;
    var trace_distance = 0.0;

    for (var i = 0; i < 4; i = i + 1) {
        if (trace_distance >= curr_height) {
            break;
        }
        curr_coords -= increment;
        prev_height = curr_height;
        curr_height = noble_gerstner::calculateWaveHeightGerstner(curr_coords, octaves);
        trace_distance += layer_height;
    }

    let prev_coords = curr_coords + increment;
    let before_height = prev_height - trace_distance + layer_height;
    let after_height = curr_height - trace_distance;
    let denom = after_height - before_height;
    let weight = select(0.0, clamp(after_height / denom, 0.0, 1.0), abs(denom) > 0.0001);
    return mix(curr_coords, prev_coords, weight);
}
