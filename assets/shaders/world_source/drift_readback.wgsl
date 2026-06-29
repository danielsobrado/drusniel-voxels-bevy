#import "shaders/world_source/biome_splat.wgsl"::{
    biome_splat_dominant_layer,
    biome_splat_sample,
}

const WORLD_SOURCE_DRIFT_READBACK_WORKGROUP_SIZE : u32 = 64u;

struct WorldSourceDriftReadbackParams {
    sample_count : u32,
    _pad0 : u32,
    _pad1 : u32,
    _pad2 : u32,
};

struct WorldSourceDriftInputSample {
    x : f32,
    z : f32,
    slope : f32,
    sea_level : f32,
    height : f32,
    ocean_mask : f32,
    biome : u32,
    _pad0 : u32,
};

struct WorldSourceDriftOutputSample {
    x : f32,
    z : f32,
    height : f32,
    ocean_mask : f32,
    biome : u32,
    dominant_layer : u32,
    _pad0 : u32,
    _pad1 : u32,
};

@group(0) @binding(0) var<uniform> params : WorldSourceDriftReadbackParams;
@group(0) @binding(1) var<storage, read> input_samples : array<WorldSourceDriftInputSample>;
@group(0) @binding(2) var<storage, read_write> output_samples : array<WorldSourceDriftOutputSample>;

@compute @workgroup_size(WORLD_SOURCE_DRIFT_READBACK_WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
    let index = global_id.x;
    if (index >= params.sample_count) {
        return;
    }

    let input = input_samples[index];
    let splat = biome_splat_sample(input.biome, input.height, input.sea_level, input.slope);
    output_samples[index] = WorldSourceDriftOutputSample(
        input.x,
        input.z,
        input.height,
        input.ocean_mask,
        input.biome,
        biome_splat_dominant_layer(splat),
        0u,
        0u,
    );
}
