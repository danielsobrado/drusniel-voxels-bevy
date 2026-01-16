//! Cloud Noise Generation Shader
//!
//! Generates 3D Worley-Perlin noise textures for volumetric cloud rendering.
//! Can be used as a compute shader to pre-generate noise textures.

// Noise parameters
struct NoiseParams {
    resolution: vec3<u32>,
    _padding0: u32,
    frequency: f32,
    octaves: u32,
    persistence: f32,
    lacunarity: f32,
    seed: u32,
    _padding1: vec3<u32>,
}

@group(0) @binding(0) var<uniform> params: NoiseParams;
@group(0) @binding(1) var output_texture: texture_storage_3d<rgba8unorm, write>;

// Hash functions for pseudo-random values
fn hash31(p: vec3<f32>) -> f32 {
    var p3 = fract(p * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
}

fn hash33(p: vec3<f32>) -> vec3<f32> {
    var p3 = fract(p * vec3<f32>(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return fract((p3.xxy + p3.yxx) * p3.zyx);
}

// Gradient noise (Perlin-like)
fn gradient_noise(p: vec3<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    
    return mix(
        mix(
            mix(hash31(i + vec3<f32>(0.0, 0.0, 0.0)),
                hash31(i + vec3<f32>(1.0, 0.0, 0.0)), u.x),
            mix(hash31(i + vec3<f32>(0.0, 1.0, 0.0)),
                hash31(i + vec3<f32>(1.0, 1.0, 0.0)), u.x), u.y),
        mix(
            mix(hash31(i + vec3<f32>(0.0, 0.0, 1.0)),
                hash31(i + vec3<f32>(1.0, 0.0, 1.0)), u.x),
            mix(hash31(i + vec3<f32>(0.0, 1.0, 1.0)),
                hash31(i + vec3<f32>(1.0, 1.0, 1.0)), u.x), u.y), u.z);
}

// Worley noise (cellular)
fn worley_noise(p: vec3<f32>) -> f32 {
    let cell = floor(p);
    let local = fract(p);
    
    var min_dist = 1.0;
    
    for (var x = -1; x <= 1; x++) {
        for (var y = -1; y <= 1; y++) {
            for (var z = -1; z <= 1; z++) {
                let neighbor = vec3<f32>(f32(x), f32(y), f32(z));
                let point = hash33(cell + neighbor);
                let diff = neighbor + point - local;
                let dist = length(diff);
                min_dist = min(min_dist, dist);
            }
        }
    }
    
    return min_dist;
}

// Inverted Worley for fluffy cloud look
fn worley_fbm(p: vec3<f32>, octaves: i32) -> f32 {
    var value = 0.0;
    var amplitude = 0.5;
    var frequency = 1.0;
    var pos = p;
    
    for (var i = 0; i < octaves; i++) {
        value += (1.0 - worley_noise(pos * frequency)) * amplitude;
        amplitude *= 0.5;
        frequency *= 2.0;
    }
    
    return value;
}

// Perlin FBM
fn perlin_fbm(p: vec3<f32>, octaves: i32) -> f32 {
    var value = 0.0;
    var amplitude = 0.5;
    var frequency = 1.0;
    var pos = p;
    
    for (var i = 0; i < octaves; i++) {
        value += gradient_noise(pos * frequency) * amplitude;
        amplitude *= params.persistence;
        frequency *= params.lacunarity;
    }
    
    return value;
}

// Remap helper
fn remap(value: f32, old_min: f32, old_max: f32, new_min: f32, new_max: f32) -> f32 {
    return new_min + (value - old_min) / (old_max - old_min) * (new_max - new_min);
}

@compute @workgroup_size(8, 8, 8)
fn generate_base_noise(
    @builtin(global_invocation_id) global_id: vec3<u32>
) {
    let res = vec3<f32>(params.resolution);
    let uvw = vec3<f32>(global_id) / res;
    
    // Make tileable by wrapping
    let p = uvw * params.frequency;
    
    // Perlin noise (base shape)
    let perlin = perlin_fbm(p, 4);
    
    // Worley noise at different frequencies
    let worley1 = worley_fbm(p, 3);
    let worley2 = worley_fbm(p * 2.0, 3);
    let worley3 = worley_fbm(p * 4.0, 3);
    
    // Pack into RGBA
    // R: Perlin-Worley (main shape)
    // G, B, A: Worley at different frequencies (for detail)
    let perlin_worley = remap(perlin, 0.0, 1.0, worley1, 1.0);
    
    let color = vec4<f32>(
        perlin_worley,
        worley1,
        worley2,
        worley3
    );
    
    textureStore(output_texture, global_id, color);
}

@compute @workgroup_size(8, 8, 8)
fn generate_detail_noise(
    @builtin(global_invocation_id) global_id: vec3<u32>
) {
    let res = vec3<f32>(params.resolution);
    let uvw = vec3<f32>(global_id) / res;
    
    let p = uvw * params.frequency;
    
    // Higher frequency Worley for detail erosion
    let worley1 = worley_fbm(p, 4);
    let worley2 = worley_fbm(p * 2.0, 4);
    let worley3 = worley_fbm(p * 4.0, 4);
    
    // Curl noise for wispy details
    let curl_x = gradient_noise(p + vec3<f32>(0.0, 0.1, 0.0)) - gradient_noise(p - vec3<f32>(0.0, 0.1, 0.0));
    
    let color = vec4<f32>(
        worley1,
        worley2,
        worley3,
        curl_x * 0.5 + 0.5
    );
    
    textureStore(output_texture, global_id, color);
}

// Weather map generation (2D)
@compute @workgroup_size(8, 8, 1)
fn generate_weather_map(
    @builtin(global_invocation_id) global_id: vec3<u32>
) {
    let res = vec2<f32>(params.resolution.xy);
    let uv = vec2<f32>(global_id.xy) / res;
    
    let p = vec3<f32>(uv * params.frequency, f32(params.seed) * 0.01);
    
    // Large-scale coverage
    var coverage = perlin_fbm(p * 0.5, 5);
    coverage = smoothstep(0.3, 0.7, coverage);
    
    // Precipitation zones
    var precipitation = perlin_fbm(p * 0.3 + vec3<f32>(100.0, 0.0, 0.0), 4);
    precipitation = smoothstep(0.5, 0.8, precipitation);
    
    // Cloud type variation
    var cloud_type = perlin_fbm(p * 0.2 + vec3<f32>(0.0, 100.0, 0.0), 3);
    cloud_type = smoothstep(0.3, 0.7, cloud_type);
    
    let color = vec4<f32>(coverage, precipitation, cloud_type, 1.0);
    
    // Note: Would need 2D texture storage binding for this
    // textureStore(weather_output, global_id.xy, color);
}
