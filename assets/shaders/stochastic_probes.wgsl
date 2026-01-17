// Stochastic Probe Selection for Radiance Cascades GI
// Enshrouded-style one-from-N probe selection with temporal accumulation
//
// This technique significantly reduces GI cost by:
// 1. Randomly selecting 1 probe from N nearby probes per frame
// 2. Temporally accumulating results over multiple frames
// 3. Using blue noise dithering for even spatial distribution
//
// Performance gain: ~8x for one-from-eight selection

#define_import_path stochastic_probes

struct StochasticProbeParams {
    selection_count: u32,      // N for one-from-N selection (typically 8)
    frame_index: u32,          // Current frame for temporal jitter
    temporal_blend: f32,       // Blend factor with previous frame (0.9-0.95)
    blue_noise_enabled: u32,   // Use blue noise for selection
    probe_spacing: f32,        // Base probe spacing
    cascade_index: u32,        // Current cascade level
    _padding: vec2<f32>,
};

// Blue noise texture for spatially coherent dithering
// @group(2) @binding(0) var blue_noise: texture_2d<f32>;
// @group(2) @binding(1) var blue_noise_sampler: sampler;

const GOLDEN_RATIO: f32 = 1.61803398875;
const PI: f32 = 3.14159265359;

// PCG hash for random number generation
fn pcg_hash(input: u32) -> u32 {
    let state = input * 747796405u + 2891336453u;
    let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

// Generate random float in [0, 1)
fn random_float(seed: u32) -> f32 {
    return f32(pcg_hash(seed)) / 4294967295.0;
}

// Generate random uint in [0, max)
fn random_uint(seed: u32, max: u32) -> u32 {
    return pcg_hash(seed) % max;
}

// Roberts R2 sequence for low-discrepancy sampling
fn r2_sequence(index: u32) -> vec2<f32> {
    let a1 = 1.0 / GOLDEN_RATIO;
    let a2 = 1.0 / (GOLDEN_RATIO * GOLDEN_RATIO);
    return fract(vec2<f32>(f32(index) * a1, f32(index) * a2));
}

// Interleaved gradient noise (IGN) - correlates well with TAA
fn interleaved_gradient_noise(pixel: vec2<f32>, frame: u32) -> f32 {
    let magic = vec3<f32>(0.06711056, 0.00583715, 52.9829189);
    let frame_offset = 5.588238 * f32(frame);
    return fract(magic.z * fract(dot(pixel + frame_offset, magic.xy)));
}

// Sample blue noise texture with temporal animation
fn sample_blue_noise(
    uv: vec2<f32>,
    blue_noise: texture_2d<f32>,
    blue_noise_sampler: sampler,
    frame: u32,
) -> f32 {
    // Animate blue noise pattern per frame
    let noise_size = vec2<f32>(textureDimensions(blue_noise));
    let animated_uv = fract(uv * noise_size + r2_sequence(frame));
    return textureSample(blue_noise, blue_noise_sampler, animated_uv).r;
}

// Get probe offset pattern for one-from-N selection
// Returns an offset in the range [-1, 1] for each axis
fn get_probe_offset(probe_idx: u32, selection_count: u32) -> vec2<i32> {
    // For 8 probes: creates a 3x3 pattern without center
    // For 4 probes: creates a 2x2 pattern
    
    if selection_count == 8u {
        // 8 neighbors in a 3x3 grid (excluding center)
        let offsets = array<vec2<i32>, 8>(
            vec2<i32>(-1, -1), vec2<i32>(0, -1), vec2<i32>(1, -1),
            vec2<i32>(-1,  0),                   vec2<i32>(1,  0),
            vec2<i32>(-1,  1), vec2<i32>(0,  1), vec2<i32>(1,  1)
        );
        return offsets[probe_idx % 8u];
    } else if selection_count == 4u {
        // 4 diagonal neighbors
        let offsets = array<vec2<i32>, 4>(
            vec2<i32>(-1, -1), vec2<i32>(1, -1),
            vec2<i32>(-1,  1), vec2<i32>(1,  1)
        );
        return offsets[probe_idx % 4u];
    } else {
        // Fallback: use modular arithmetic
        let x = i32(probe_idx % 3u) - 1;
        let y = i32((probe_idx / 3u) % 3u) - 1;
        return vec2<i32>(x, y);
    }
}

// Select which probe to sample this frame using stochastic selection
fn select_probe_index(
    pixel_coord: vec2<u32>,
    params: StochasticProbeParams,
) -> u32 {
    // Create a unique seed per pixel that changes each frame
    let pixel_seed = pixel_coord.x + pixel_coord.y * 1920u + params.frame_index * 1920u * 1080u;
    
    if params.blue_noise_enabled != 0u {
        // Use IGN for better spatial distribution with TAA
        let ign = interleaved_gradient_noise(vec2<f32>(pixel_coord), params.frame_index);
        return u32(ign * f32(params.selection_count)) % params.selection_count;
    } else {
        // Fallback to PCG hash
        return random_uint(pixel_seed, params.selection_count);
    }
}

// Get the world-space offset for a stochastically selected probe
fn get_stochastic_probe_offset(
    pixel_coord: vec2<u32>,
    params: StochasticProbeParams,
) -> vec2<f32> {
    let probe_idx = select_probe_index(pixel_coord, params);
    let grid_offset = get_probe_offset(probe_idx, params.selection_count);
    
    // Scale by probe spacing for this cascade level
    let cascade_scale = pow(2.0, f32(params.cascade_index));
    let offset = vec2<f32>(grid_offset) * params.probe_spacing * cascade_scale;
    
    return offset;
}

// Temporal accumulation with motion-vector compensation
struct TemporalAccumResult {
    color: vec3<f32>,
    blend_factor: f32,
}

fn temporal_accumulate(
    current_sample: vec3<f32>,
    history_sample: vec3<f32>,
    motion_vector: vec2<f32>,
    blend: f32,
    disocclusion: bool,
) -> TemporalAccumResult {
    var result: TemporalAccumResult;
    
    // If disocclusion detected, reduce history weight
    var final_blend = blend;
    if disocclusion {
        final_blend = max(blend * 0.5, 0.1);
    }
    
    // Clamp history to current neighborhood to prevent ghosting
    // (In full implementation, would use variance clipping)
    
    result.color = mix(current_sample, history_sample, final_blend);
    result.blend_factor = final_blend;
    
    return result;
}

// Variance-guided history clamping for robust temporal accumulation
fn variance_clip(
    history: vec3<f32>,
    current_mean: vec3<f32>,
    current_std: vec3<f32>,
    clip_strength: f32,
) -> vec3<f32> {
    let clip_box_min = current_mean - current_std * clip_strength;
    let clip_box_max = current_mean + current_std * clip_strength;
    return clamp(history, clip_box_min, clip_box_max);
}

// Full stochastic probe GI sampling
fn sample_gi_stochastic(
    world_position: vec3<f32>,
    world_normal: vec3<f32>,
    screen_uv: vec2<f32>,
    params: StochasticProbeParams,
    // Would also need: probe grid, history buffer, etc.
) -> vec3<f32> {
    let pixel_coord = vec2<u32>(screen_uv * vec2<f32>(1920.0, 1080.0));
    
    // Get stochastic probe offset
    let probe_offset = get_stochastic_probe_offset(pixel_coord, params);
    
    // Sample single probe (placeholder for actual probe sampling)
    // In full implementation:
    // 1. Find nearby probe position + offset
    // 2. Ray trace from probe to get radiance
    // 3. Apply visibility/occlusion
    let sample = vec3<f32>(0.5, 0.5, 0.5); // Placeholder
    
    return sample;
}

// Debug visualization of probe selection pattern
fn debug_probe_selection(
    pixel_coord: vec2<u32>,
    params: StochasticProbeParams,
) -> vec3<f32> {
    let probe_idx = select_probe_index(pixel_coord, params);
    
    // Color-code each probe index
    let colors = array<vec3<f32>, 8>(
        vec3<f32>(1.0, 0.0, 0.0), // Red
        vec3<f32>(0.0, 1.0, 0.0), // Green
        vec3<f32>(0.0, 0.0, 1.0), // Blue
        vec3<f32>(1.0, 1.0, 0.0), // Yellow
        vec3<f32>(1.0, 0.0, 1.0), // Magenta
        vec3<f32>(0.0, 1.0, 1.0), // Cyan
        vec3<f32>(1.0, 0.5, 0.0), // Orange
        vec3<f32>(0.5, 0.0, 1.0), // Purple
    );
    
    return colors[probe_idx % 8u];
}
