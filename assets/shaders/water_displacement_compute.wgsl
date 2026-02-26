// Water Displacement Compute Shader
// Implements 2D wave equation for interactive water surface ripples.
//
// Uses ping-pong textures: prev_state (read) → curr_state (write).
// Dispatched each frame with a 16x16 workgroup over the simulation grid.
// The R channel stores height, G channel stores velocity.
//
// Wave equation:
//   velocity += wave_speed * (avg_neighbors - height)
//   velocity *= damping
//   height   += velocity

#define_import_path water_displacement_compute

struct DisplacementParams {
    /// Propagation speed (0.0..1.0, typical: 0.98)
    wave_speed: f32,
    /// Damping per frame (0.99-0.999; lower = faster decay)
    damping: f32,
    /// Grid resolution (both axes assumed equal)
    grid_size: u32,
    /// Delta time (capped) for frame-rate independent simulation
    delta_time: f32,
}

@group(0) @binding(0) var prev_state: texture_storage_2d<rg32float, read>;
@group(0) @binding(1) var curr_state: texture_storage_2d<rg32float, write>;
@group(0) @binding(2) var<uniform> params: DisplacementParams;

@compute @workgroup_size(16, 16)
fn propagate(@builtin(global_invocation_id) id: vec3<u32>) {
    let size = i32(params.grid_size);
    let pos = vec2<i32>(id.xy);

    if pos.x >= size || pos.y >= size {
        return;
    }

    let current = textureLoad(prev_state, pos);
    let height   = current.r;
    let velocity = current.g;

    // Clamp neighbors at grid edges (reflective boundary)
    let left  = textureLoad(prev_state, clamp(pos + vec2(-1,  0), vec2(0), vec2(size - 1))).r;
    let right = textureLoad(prev_state, clamp(pos + vec2( 1,  0), vec2(0), vec2(size - 1))).r;
    let up    = textureLoad(prev_state, clamp(pos + vec2( 0, -1), vec2(0), vec2(size - 1))).r;
    let down  = textureLoad(prev_state, clamp(pos + vec2( 0,  1), vec2(0), vec2(size - 1))).r;

    // Discrete 2D wave equation: Laplacian drives acceleration
    let laplacian    = (left + right + up + down) * 0.25 - height;
    let new_velocity = (velocity + laplacian * params.wave_speed) * params.damping;
    let new_height   = clamp(height + new_velocity, -2.0, 2.0);

    textureStore(curr_state, pos, vec4<f32>(new_height, new_velocity, 0.0, 0.0));
}
