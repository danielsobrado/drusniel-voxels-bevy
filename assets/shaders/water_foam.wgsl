// Water Foam Rendering
// Generates realistic foam textures for wave crests and shorelines

#define_import_path water_foam

const PI: f32 = 3.14159265359;

// Foam parameters
struct FoamParams {
    color: vec3<f32>,
    intensity: f32,
    scale: f32,
    persistence: f32,
    edge_sharpness: f32,
};

// Hash function for noise
fn hash2(p: vec2<f32>) -> vec2<f32> {
    let k = vec2<f32>(0.3183099, 0.3678794);
    var n = p;
    n = fract(n * k + k.yx);
    return fract(n * (n.yx + k) * 17.0);
}

// Voronoi noise for foam bubbles
fn voronoi_foam(p: vec2<f32>) -> f32 {
    let cell = floor(p);
    let frac = fract(p);
    
    var min_dist = 1.0;
    
    for (var y: i32 = -1; y <= 1; y = y + 1) {
        for (var x: i32 = -1; x <= 1; x = x + 1) {
            let neighbor = vec2<f32>(f32(x), f32(y));
            let point = hash2(cell + neighbor);
            let diff = neighbor + point - frac;
            let dist = length(diff);
            min_dist = min(min_dist, dist);
        }
    }
    
    return min_dist;
}

// Multi-octave foam noise
fn foam_noise(p: vec2<f32>, octaves: i32) -> f32 {
    var value = 0.0;
    var amplitude = 0.5;
    var frequency = 1.0;
    var pos = p;
    
    for (var i: i32 = 0; i < octaves; i = i + 1) {
        let v = voronoi_foam(pos * frequency);
        value = value + (1.0 - v) * amplitude;
        amplitude = amplitude * 0.5;
        frequency = frequency * 2.0;
    }
    
    return value;
}

// Main foam calculation
fn calculate_foam_texture(
    position: vec2<f32>,
    time: f32,
    foam_amount: f32,
    params: FoamParams,
) -> vec4<f32> {
    if foam_amount < 0.01 {
        return vec4<f32>(0.0);
    }
    
    // Animated foam position
    let animated_pos = position * params.scale + vec2<f32>(time * 0.1, time * 0.05);
    
    // Multi-scale foam
    let large_foam = foam_noise(animated_pos * 0.5, 3);
    let medium_foam = foam_noise(animated_pos * 1.0, 4);
    let small_foam = foam_noise(animated_pos * 2.0, 3);
    
    // Combine scales
    let foam_pattern = large_foam * 0.4 + medium_foam * 0.4 + small_foam * 0.2;
    
    // Apply foam amount with edge sharpness
    let foam_threshold = 1.0 - foam_amount;
    let foam_value = smoothstep(foam_threshold, foam_threshold + params.edge_sharpness, foam_pattern);
    
    // Add some sparkle
    let sparkle_pos = position * params.scale * 5.0 + time * 2.0;
    let sparkle = pow(voronoi_foam(sparkle_pos), 8.0) * foam_value;
    
    // Final foam color
    let foam_color = params.color * (foam_value + sparkle * 0.3) * params.intensity;
    
    return vec4<f32>(foam_color, foam_value);
}

// Shoreline foam (breaking waves)
fn shoreline_foam(
    position: vec2<f32>,
    time: f32,
    shore_distance: f32,
    wave_phase: f32,
) -> f32 {
    // Wave breaking pattern
    let break_pos = position.x * 0.2 + time * 0.5;
    let break_wave = sin(break_pos + wave_phase) * 0.5 + 0.5;
    
    // Distance-based foam intensity
    let shore_factor = smoothstep(3.0, 0.0, shore_distance);
    
    // Foam turbulence
    let turbulence_pos = position * 2.0 + vec2<f32>(time * 0.3, 0.0);
    let turbulence = voronoi_foam(turbulence_pos);
    
    return shore_factor * break_wave * (1.0 - turbulence * 0.5);
}

// Wake foam (from objects moving through water)
fn wake_foam(
    position: vec2<f32>,
    wake_center: vec2<f32>,
    wake_direction: vec2<f32>,
    time: f32,
    wake_width: f32,
    wake_length: f32,
) -> f32 {
    let to_point = position - wake_center;
    
    // Project onto wake direction
    let along = dot(to_point, wake_direction);
    let perp = length(to_point - wake_direction * along);
    
    // Wake shape (V-pattern)
    let wake_spread = along * 0.3;
    let wake_intensity = smoothstep(wake_width + wake_spread, 0.0, perp);
    let wake_falloff = smoothstep(wake_length, 0.0, along) * smoothstep(0.0, 2.0, along);
    
    // Add turbulence
    let turb_pos = position * 3.0 + vec2<f32>(time * 0.5, 0.0);
    let turbulence = voronoi_foam(turb_pos) * 0.5 + 0.5;
    
    return wake_intensity * wake_falloff * turbulence;
}
