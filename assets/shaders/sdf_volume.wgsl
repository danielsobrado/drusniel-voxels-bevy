//! SDF Volume Generation Shader
//!
//! Compute shader for generating/updating 3D SDF textures from voxel data.
//! Used by Radiance Cascades for efficient ray marching.

struct SdfVolumeParams {
    // Volume bounds in world space
    volume_min: vec3<f32>,
    _padding0: f32,
    volume_max: vec3<f32>,
    _padding1: f32,
    
    // Resolution
    resolution: vec3<u32>,
    _padding2: u32,
    
    // Update region (for incremental updates)
    update_min: vec3<u32>,
    _padding3: u32,
    update_max: vec3<u32>,
    _padding4: u32,
    
    // Voxel data offset
    chunk_offset: vec3<i32>,
    _padding5: i32,
}

@group(0) @binding(0) var<uniform> params: SdfVolumeParams;
@group(0) @binding(1) var<storage, read> voxel_data: array<u32>;  // Packed voxel types
@group(0) @binding(2) var sdf_output: texture_storage_3d<r16float, write>;

// Constants
const CHUNK_SIZE: u32 = 16u;
const VOXEL_SIZE: f32 = 1.0;

// Voxel type check (0 = air, non-zero = solid)
fn is_solid(voxel_type: u32) -> bool {
    return voxel_type != 0u;
}

// Get voxel at integer position
fn get_voxel(pos: vec3<i32>) -> u32 {
    // Bounds check
    let res = vec3<i32>(params.resolution);
    if any(pos < vec3<i32>(0)) || any(pos >= res) {
        return 0u; // Air outside bounds
    }
    
    let index = u32(pos.x) + u32(pos.y) * params.resolution.x + u32(pos.z) * params.resolution.x * params.resolution.y;
    
    // Voxels are packed 4 per u32
    let packed_index = index / 4u;
    let sub_index = index % 4u;
    
    if packed_index >= arrayLength(&voxel_data) {
        return 0u;
    }
    
    let packed = voxel_data[packed_index];
    return (packed >> (sub_index * 8u)) & 0xFFu;
}

// Calculate approximate distance to nearest surface
fn calculate_sdf(pos: vec3<i32>) -> f32 {
    let center_solid = is_solid(get_voxel(pos));
    
    // Quick check: if isolated air or solid, use simple distance
    var min_dist = 1000.0;
    let search_radius = 8; // Search within 8 voxels
    
    // Signed: negative inside, positive outside
    let sign = select(1.0, -1.0, center_solid);
    
    // Brute force search for nearest opposite voxel
    for (var dx = -search_radius; dx <= search_radius; dx++) {
        for (var dy = -search_radius; dy <= search_radius; dy++) {
            for (var dz = -search_radius; dz <= search_radius; dz++) {
                let offset = vec3<i32>(dx, dy, dz);
                let neighbor_pos = pos + offset;
                let neighbor_solid = is_solid(get_voxel(neighbor_pos));
                
                if neighbor_solid != center_solid {
                    let dist = length(vec3<f32>(offset)) * VOXEL_SIZE;
                    min_dist = min(min_dist, dist);
                }
            }
        }
    }
    
    // Clamp and sign
    return sign * min(min_dist, f32(search_radius) * VOXEL_SIZE);
}

// Jump Flooding Algorithm (JFA) for faster SDF generation
// This is a multi-pass algorithm - each pass handles a different step size

struct JfaParams {
    step_size: i32,
    _padding: vec3<i32>,
}

@group(1) @binding(0) var<uniform> jfa_params: JfaParams;
@group(1) @binding(1) var jfa_input: texture_3d<f32>;
@group(1) @binding(2) var jfa_output: texture_storage_3d<rgba16float, write>;

// JFA seed pass - initialize distance field
@compute @workgroup_size(8, 8, 8)
fn jfa_seed(
    @builtin(global_invocation_id) global_id: vec3<u32>
) {
    let pos = vec3<i32>(global_id);
    let res = vec3<i32>(params.resolution);
    
    if any(pos >= res) {
        return;
    }
    
    let voxel = get_voxel(pos);
    let solid = is_solid(voxel);
    
    // Store: xyz = nearest seed position, w = distance (0 if this is a seed)
    if solid {
        // Solid voxels are seeds (distance 0, position is self)
        textureStore(jfa_output, global_id, vec4<f32>(vec3<f32>(pos), 0.0));
    } else {
        // Air voxels start with infinite distance
        textureStore(jfa_output, global_id, vec4<f32>(-1.0, -1.0, -1.0, 1000.0));
    }
}

// JFA step pass
@compute @workgroup_size(8, 8, 8)
fn jfa_step(
    @builtin(global_invocation_id) global_id: vec3<u32>
) {
    let pos = vec3<i32>(global_id);
    let res = vec3<i32>(params.resolution);
    
    if any(pos >= res) {
        return;
    }
    
    let step = jfa_params.step_size;
    var best = textureLoad(jfa_input, global_id, 0);
    
    // Check 26 neighbors at step distance
    for (var dx = -1; dx <= 1; dx++) {
        for (var dy = -1; dy <= 1; dy++) {
            for (var dz = -1; dz <= 1; dz++) {
                if dx == 0 && dy == 0 && dz == 0 {
                    continue;
                }
                
                let neighbor_pos = pos + vec3<i32>(dx, dy, dz) * step;
                
                if any(neighbor_pos < vec3<i32>(0)) || any(neighbor_pos >= res) {
                    continue;
                }
                
                let neighbor = textureLoad(jfa_input, vec3<u32>(neighbor_pos), 0);
                
                if neighbor.x >= 0.0 { // Valid seed
                    let seed_pos = neighbor.xyz;
                    let dist = length(vec3<f32>(pos) - seed_pos);
                    
                    if dist < best.w {
                        best = vec4<f32>(seed_pos, dist);
                    }
                }
            }
        }
    }
    
    textureStore(jfa_output, global_id, best);
}

// Convert JFA result to signed distance field
@compute @workgroup_size(8, 8, 8)
fn jfa_to_sdf(
    @builtin(global_invocation_id) global_id: vec3<u32>
) {
    let pos = vec3<i32>(global_id);
    let res = vec3<i32>(params.resolution);
    
    if any(pos >= res) {
        return;
    }
    
    let jfa_result = textureLoad(jfa_input, global_id, 0);
    let voxel = get_voxel(pos);
    let solid = is_solid(voxel);
    
    // Signed distance: negative inside, positive outside
    var sdf = jfa_result.w * VOXEL_SIZE;
    if solid {
        sdf = -sdf;
    }
    
    textureStore(sdf_output, global_id, vec4<f32>(sdf, 0.0, 0.0, 0.0));
}

// Direct brute-force SDF generation (slower but single-pass)
@compute @workgroup_size(8, 8, 8)
fn generate_sdf_brute(
    @builtin(global_invocation_id) global_id: vec3<u32>
) {
    let pos = vec3<i32>(global_id);
    let res = vec3<i32>(params.resolution);
    
    if any(pos >= res) {
        return;
    }
    
    // Only update within specified region
    let update_min = vec3<i32>(params.update_min);
    let update_max = vec3<i32>(params.update_max);
    
    if any(pos < update_min) || any(pos >= update_max) {
        return;
    }
    
    let sdf = calculate_sdf(pos);
    textureStore(sdf_output, global_id, vec4<f32>(sdf, 0.0, 0.0, 0.0));
}

// Incremental SDF update for modified chunks
@compute @workgroup_size(8, 8, 8)
fn update_sdf_region(
    @builtin(global_invocation_id) global_id: vec3<u32>
) {
    let local_pos = vec3<i32>(global_id);
    let world_pos = local_pos + params.chunk_offset;
    
    // Bounds check
    let res = vec3<i32>(params.resolution);
    if any(world_pos < vec3<i32>(0)) || any(world_pos >= res) {
        return;
    }
    
    // Recalculate SDF for this voxel
    let sdf = calculate_sdf(world_pos);
    textureStore(sdf_output, vec3<u32>(world_pos), vec4<f32>(sdf, 0.0, 0.0, 0.0));
}
