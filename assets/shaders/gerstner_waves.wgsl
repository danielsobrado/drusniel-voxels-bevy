// Gerstner Wave Implementation for Realistic Ocean/Water Simulation
// Based on GPU Gems: Chapter 1 - Effective Water Simulation from Physical Models
//
// Features:
// - Multiple wave layers with different frequencies
// - Directional waves with steepness control
// - Physically accurate displacement (horizontal + vertical)
// - Foam generation from wave peaks
// - Caustics pattern generation

#define_import_path gerstner_waves

const PI: f32 = 3.14159265359;
const TAU: f32 = 6.28318530718;

// Single Gerstner wave parameters
struct GerstnerWave {
    direction: vec2<f32>,  // Normalized wave direction (x, z)
    wavelength: f32,       // Distance between wave peaks
    steepness: f32,        // 0.0-1.0, controls wave sharpness (Q factor)
    amplitude: f32,        // Wave height
    speed: f32,            // Wave propagation speed
};

// Result of wave calculation
struct WaveResult {
    position: vec3<f32>,   // Displaced position
    normal: vec3<f32>,     // Surface normal
    tangent: vec3<f32>,    // Surface tangent
    bitangent: vec3<f32>,  // Surface bitangent
    foam: f32,             // Foam intensity (0-1)
};

// Calculate single Gerstner wave contribution
fn gerstner_wave(
    position: vec2<f32>,
    time: f32,
    wave: GerstnerWave,
) -> WaveResult {
    var result: WaveResult;
    
    // Wave number (2π / wavelength)
    let k = TAU / wave.wavelength;
    
    // Angular frequency
    let omega = sqrt(9.81 * k); // Deep water dispersion relation
    
    // Phase
    let d = normalize(wave.direction);
    let phase = k * dot(d, position) - omega * time * wave.speed;
    
    // Steepness factor (Q)
    let q = wave.steepness / (k * wave.amplitude);
    
    // Trigonometric values
    let c = cos(phase);
    let s = sin(phase);
    
    // Position displacement
    result.position = vec3<f32>(
        q * wave.amplitude * d.x * c,  // X displacement
        wave.amplitude * s,             // Y displacement (height)
        q * wave.amplitude * d.y * c    // Z displacement
    );
    
    // Calculate partial derivatives for normal
    let wa = k * wave.amplitude;
    let qa = q * wave.amplitude;
    
    // Tangent (dP/dx)
    result.tangent = vec3<f32>(
        1.0 - qa * d.x * d.x * s,
        wa * d.x * c,
        -qa * d.x * d.y * s
    );
    
    // Bitangent (dP/dz)
    result.bitangent = vec3<f32>(
        -qa * d.x * d.y * s,
        wa * d.y * c,
        1.0 - qa * d.y * d.y * s
    );
    
    // Normal is cross product of tangent and bitangent
    result.normal = normalize(cross(result.bitangent, result.tangent));
    
    // Foam generation - peaks of waves generate foam
    // Based on Jacobian determinant (wave convergence)
    let jacobian = (1.0 - qa * d.x * d.x * s) * (1.0 - qa * d.y * d.y * s) 
                 - (qa * d.x * d.y * s) * (qa * d.x * d.y * s);
    result.foam = saturate(1.0 - jacobian);
    
    return result;
}

// Sum multiple Gerstner waves for realistic ocean surface
fn sum_gerstner_waves(
    position: vec2<f32>,
    time: f32,
    base_amplitude: f32,
    wave_scale: f32,
) -> WaveResult {
    var result: WaveResult;
    result.position = vec3<f32>(0.0);
    result.normal = vec3<f32>(0.0, 1.0, 0.0);
    result.tangent = vec3<f32>(1.0, 0.0, 0.0);
    result.bitangent = vec3<f32>(0.0, 0.0, 1.0);
    result.foam = 0.0;
    
    // Define multiple wave layers
    // Layer 1: Primary swell
    var wave1: GerstnerWave;
    wave1.direction = vec2<f32>(0.6, 0.8);
    wave1.wavelength = 30.0 * wave_scale;
    wave1.steepness = 0.25;
    wave1.amplitude = base_amplitude;
    wave1.speed = 1.0;
    
    // Layer 2: Secondary swell (cross-sea)
    var wave2: GerstnerWave;
    wave2.direction = vec2<f32>(-0.4, 0.9);
    wave2.wavelength = 20.0 * wave_scale;
    wave2.steepness = 0.3;
    wave2.amplitude = base_amplitude * 0.6;
    wave2.speed = 1.1;
    
    // Layer 3: Wind waves
    var wave3: GerstnerWave;
    wave3.direction = vec2<f32>(0.9, 0.2);
    wave3.wavelength = 8.0 * wave_scale;
    wave3.steepness = 0.4;
    wave3.amplitude = base_amplitude * 0.3;
    wave3.speed = 0.9;
    
    // Layer 4: Small ripples
    var wave4: GerstnerWave;
    wave4.direction = vec2<f32>(-0.7, -0.5);
    wave4.wavelength = 3.0 * wave_scale;
    wave4.steepness = 0.5;
    wave4.amplitude = base_amplitude * 0.15;
    wave4.speed = 0.8;
    
    // Sum all waves
    let w1 = gerstner_wave(position, time, wave1);
    let w2 = gerstner_wave(position, time, wave2);
    let w3 = gerstner_wave(position, time, wave3);
    let w4 = gerstner_wave(position, time, wave4);
    
    result.position = w1.position + w2.position + w3.position + w4.position;
    
    // Average normals (should be weighted by amplitude)
    result.normal = normalize(
        w1.normal * wave1.amplitude +
        w2.normal * wave2.amplitude +
        w3.normal * wave3.amplitude +
        w4.normal * wave4.amplitude
    );
    
    // Max foam from all waves
    result.foam = max(max(w1.foam, w2.foam), max(w3.foam, w4.foam));
    
    return result;
}

// Get wave height only (for cheaper calculations)
fn get_gerstner_height(
    position: vec2<f32>,
    time: f32,
    base_amplitude: f32,
    wave_scale: f32,
) -> f32 {
    let result = sum_gerstner_waves(position, time, base_amplitude, wave_scale);
    return result.position.y;
}

// Get wave normal only
fn get_gerstner_normal(
    position: vec2<f32>,
    time: f32,
    base_amplitude: f32,
    wave_scale: f32,
) -> vec3<f32> {
    let result = sum_gerstner_waves(position, time, base_amplitude, wave_scale);
    return result.normal;
}

// Calculate foam intensity with persistence
fn calculate_foam(
    position: vec2<f32>,
    time: f32,
    wave_foam: f32,
    depth: f32,          // Water depth at this point
    shore_distance: f32, // Distance to shore
) -> f32 {
    // Wave crest foam
    var foam = wave_foam;
    
    // Shore foam (breaking waves)
    let shore_foam = smoothstep(5.0, 0.0, shore_distance);
    foam = max(foam, shore_foam * 0.8);
    
    // Shallow water foam
    let shallow_foam = smoothstep(2.0, 0.0, depth) * 0.5;
    foam = max(foam, shallow_foam);
    
    // Add some noise variation
    let noise_pos = position * 0.5 + vec2<f32>(time * 0.3, time * 0.2);
    let noise = fract(sin(dot(noise_pos, vec2<f32>(12.9898, 78.233))) * 43758.5453);
    foam = foam * (0.8 + noise * 0.4);
    
    return saturate(foam);
}
