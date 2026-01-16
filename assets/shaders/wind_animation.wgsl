// Wind Animation System for Vegetation
// Advanced vertex animation for trees, grass, and foliage
//
// Features:
// - Multi-frequency wind noise
// - Trunk sway (large scale, slow)
// - Branch movement (medium scale)
// - Leaf flutter (small scale, fast)
// - Wind gust support

#define_import_path wind_animation

const PI: f32 = 3.14159265359;
const TAU: f32 = 6.28318530718;

// Wind parameters (from uniform buffer)
struct WindParams {
    direction: vec2<f32>,    // Wind direction (normalized)
    speed: f32,              // Base wind speed
    strength: f32,           // Overall wind strength
    turbulence: f32,         // Wind variation/noise
    gust_strength: f32,      // Gust intensity
    gust_frequency: f32,     // How often gusts occur
    time: f32,               // Animation time
};

// Vertex attributes for wind animation
struct WindVertexInput {
    position: vec3<f32>,     // Local vertex position
    normal: vec3<f32>,       // Vertex normal
    uv: vec2<f32>,           // UV coordinates
    vertex_color: vec4<f32>, // Vertex color (for wind mask)
};

// Simple hash for noise
fn hash(p: f32) -> f32 {
    var n = fract(p * 0.1031);
    n = n * (n + 33.33);
    return fract(n * (n + n));
}

fn hash2(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

// Value noise
fn value_noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    
    let a = hash2(i);
    let b = hash2(i + vec2<f32>(1.0, 0.0));
    let c = hash2(i + vec2<f32>(0.0, 1.0));
    let d = hash2(i + vec2<f32>(1.0, 1.0));
    
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// FBM (Fractal Brownian Motion) for turbulence
fn fbm(p: vec2<f32>, octaves: i32) -> f32 {
    var value = 0.0;
    var amplitude = 0.5;
    var frequency = 1.0;
    var pos = p;
    
    for (var i: i32 = 0; i < octaves; i = i + 1) {
        value = value + amplitude * value_noise(pos * frequency);
        amplitude = amplitude * 0.5;
        frequency = frequency * 2.0;
    }
    
    return value;
}

// Wind gust function
fn wind_gust(world_pos: vec2<f32>, time: f32, params: WindParams) -> f32 {
    // Gusts travel in wind direction
    let gust_pos = world_pos - params.direction * time * params.speed * 2.0;
    
    // Gust pattern
    let gust_noise = fbm(gust_pos * params.gust_frequency, 2);
    
    // Sharp gust peaks
    let gust = pow(max(gust_noise - 0.3, 0.0) / 0.7, 2.0);
    
    return gust * params.gust_strength;
}

// Main trunk/stem sway (low frequency, large amplitude)
fn trunk_sway(
    world_pos: vec3<f32>,
    height_factor: f32,
    params: WindParams,
) -> vec3<f32> {
    let time = params.time;
    
    // Low frequency swaying
    let sway_speed = 0.5;
    let phase = dot(world_pos.xz, params.direction) * 0.1;
    
    // Primary sway
    let sway_x = sin(time * sway_speed + phase) * params.strength;
    let sway_z = cos(time * sway_speed * 0.7 + phase) * params.strength * 0.5;
    
    // Add turbulence
    let turb = fbm(world_pos.xz * 0.05 + time * 0.1, 2) * 2.0 - 1.0;
    
    // Height-based amplitude (more sway at top)
    let height_amp = height_factor * height_factor;
    
    // Wind direction influence
    let wind_push = vec2<f32>(params.direction.x, params.direction.y) * params.speed * 0.1;
    
    return vec3<f32>(
        (sway_x + turb * params.turbulence + wind_push.x) * height_amp,
        0.0,
        (sway_z + turb * params.turbulence * 0.5 + wind_push.y) * height_amp
    );
}

// Branch movement (medium frequency)
fn branch_movement(
    world_pos: vec3<f32>,
    branch_factor: f32,  // How much this vertex is a "branch" (from vertex color)
    params: WindParams,
) -> vec3<f32> {
    let time = params.time;
    
    // Medium frequency movement
    let branch_speed = 2.0;
    let phase = hash2(world_pos.xz) * TAU;
    
    let move_x = sin(time * branch_speed + phase) * params.strength;
    let move_z = cos(time * branch_speed * 1.3 + phase) * params.strength * 0.7;
    let move_y = sin(time * branch_speed * 0.8 + phase) * params.strength * 0.3;
    
    // Add noise variation
    let noise = value_noise(world_pos.xz * 0.2 + time * 0.3) * 2.0 - 1.0;
    
    return vec3<f32>(
        move_x + noise * params.turbulence,
        move_y,
        move_z + noise * params.turbulence
    ) * branch_factor * 0.5;
}

// Leaf flutter (high frequency, small amplitude)
fn leaf_flutter(
    local_pos: vec3<f32>,
    world_pos: vec3<f32>,
    leaf_factor: f32,  // How much this vertex is a "leaf" (from vertex color)
    params: WindParams,
) -> vec3<f32> {
    let time = params.time;
    
    // High frequency flutter
    let flutter_speed = 8.0;
    let phase = hash2(local_pos.xy + world_pos.xz) * TAU;
    
    // Rapid oscillation
    let flutter = sin(time * flutter_speed + phase);
    let flutter2 = cos(time * flutter_speed * 1.7 + phase * 2.0);
    
    // Small displacement in all directions
    let flutter_amp = 0.02 * params.strength * leaf_factor;
    
    return vec3<f32>(
        flutter * flutter_amp,
        flutter2 * flutter_amp * 0.5,
        flutter * flutter2 * flutter_amp
    );
}

// Complete wind animation
fn apply_wind_animation(
    vertex: WindVertexInput,
    world_pos: vec3<f32>,
    params: WindParams,
) -> vec3<f32> {
    // Extract animation factors from vertex color
    // R = height factor (0 at base, 1 at top)
    // G = branch factor (0 = trunk, 1 = branch)
    // B = leaf factor (0 = wood, 1 = leaf)
    let height_factor = vertex.vertex_color.r;
    let branch_factor = vertex.vertex_color.g;
    let leaf_factor = vertex.vertex_color.b;
    
    // Early out if at base
    if height_factor < 0.01 {
        return vec3<f32>(0.0);
    }
    
    // Calculate gust intensity at this position
    let gust = wind_gust(world_pos.xz, params.time, params);
    let gust_multiplier = 1.0 + gust;
    
    // Combine all animation layers
    var displacement = vec3<f32>(0.0);
    
    // Trunk sway (always applied, scaled by height)
    displacement = displacement + trunk_sway(world_pos, height_factor, params);
    
    // Branch movement (only for branch vertices)
    if branch_factor > 0.01 {
        displacement = displacement + branch_movement(world_pos, branch_factor, params);
    }
    
    // Leaf flutter (only for leaf vertices)
    if leaf_factor > 0.01 {
        displacement = displacement + leaf_flutter(vertex.position, world_pos, leaf_factor, params);
    }
    
    // Apply gust multiplier
    displacement = displacement * gust_multiplier;
    
    return displacement;
}

// Simplified wind for grass (already has animation, this enhances it)
fn grass_wind_enhanced(
    world_pos: vec3<f32>,
    height_factor: f32,
    params: WindParams,
) -> vec2<f32> {
    let time = params.time;
    
    // Per-blade phase offset
    let phase = hash2(world_pos.xz * 7.3) * TAU;
    
    // Primary wind wave
    let wave_pos = world_pos.xz * 0.1 + params.direction * time * params.speed;
    let wave = sin(wave_pos.x + wave_pos.y + phase);
    
    // Turbulence
    let turb = fbm(world_pos.xz * 0.3 + time * 0.5, 3) * 2.0 - 1.0;
    
    // Gust
    let gust = wind_gust(world_pos.xz, time, params);
    
    // Combine
    let wind_strength = (wave * 0.5 + turb * params.turbulence + gust) * params.strength;
    
    // Height-based amplitude
    let amp = height_factor * height_factor;
    
    return vec2<f32>(
        params.direction.x * wind_strength * amp,
        params.direction.y * wind_strength * amp
    );
}
