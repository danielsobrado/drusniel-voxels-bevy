//! GPU compute cull pass for vegetation/prop instances.
//!
//! Reads source instances, performs frustum + distance + LOD culling, and writes:
//! - Compacted visible instances to a flat buffer
//! - Per-group `DrawIndexedIndirectArgs` (instance_count + first_instance)
//! - Per-group vertex-shader uniforms (visible_offset, tint_enabled)
//!
//! The CPU pre-fills a template args buffer with mesh-specific data
//! (index_count, first_index, vertex_offset). This shader only writes the
//! dynamic fields (instance_count, first_instance).
//!
//! Entry points:
//!   cull_main   — main-view frustum + distance + LOD cull
//!   cull_shadows — per-cascade shadow frustum cull (reuses source/bindings)

const WORKGROUP_SIZE: u32 = 64u;
const MAX_CASCADES: u32 = 4u;

struct SourceInstance {
    col0: vec4<f32>,
    col1: vec4<f32>,
    col2: vec4<f32>,
    col3: vec4<f32>,
    tint: vec4<f32>,
};

struct GroupMeta {
    source_offset: u32,
    source_count: u32,
    _pad0: u32,
    _pad1: u32,
};

struct CullParams {
    camera_pos: vec4<f32>,
    clip_from_world: mat4x4<f32>,
    lod_end: vec4<f32>,
    max_draw_distance: f32,
    total_source_instances: u32,
    total_groups: u32,
    cascade_count: u32,
    max_shadow_distance: f32,
};

struct DrawIndexedIndirectArgs {
    index_count: u32,
    instance_count: u32,
    first_index: u32,
    vertex_offset: u32,
    first_instance: u32,
};

struct GroupUniform {
    visible_offset: u32,
    source_count: u32,
    tint_enabled: u32,
    group_index: u32,
};

struct ShadowParams {
    cascade_index: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
};

// --- Bind group 0: inputs (shared by main + shadow) ---
@group(0) @binding(0) var<storage, read> source_instances: array<SourceInstance>;
@group(0) @binding(1) var<storage, read> group_meta: array<GroupMeta>;
@group(0) @binding(2) var<uniform> params: CullParams;

// --- Bind group 1: main-view outputs ---
@group(1) @binding(0) var<storage, read_write> visible_instances: array<SourceInstance>;
@group(1) @binding(1) var<storage, read_write> draw_args: array<DrawIndexedIndirectArgs>;
@group(1) @binding(2) var<storage, read_write> group_uniforms: array<GroupUniform>;
@group(1) @binding(3) var<storage, read_write> group_counters: array<atomic<u32>>;

// --- Bind group 2: shadow cascade outputs + params ---
@group(2) @binding(0) var<uniform> shadow_params: ShadowParams;
@group(2) @binding(1) var<storage, read_write> shadow_visible: array<SourceInstance>;
@group(2) @binding(2) var<storage, read_write> shadow_draw_args: array<DrawIndexedIndirectArgs>;
@group(2) @binding(3) var<storage, read_write> shadow_counters: array<atomic<u32>>;
@group(2) @binding(4) var<uniform> cascade_clip: array<mat4x4<f32>, 4>;

fn instance_translation(src: SourceInstance) -> vec3<f32> {
    return src.col3.xyz;
}

fn instance_bounding_radius(src: SourceInstance) -> f32 {
    let sx = length(src.col0.xyz);
    let sy = length(src.col1.xyz);
    let sz = length(src.col2.xyz);
    return max(sx, max(sy, sz));
}

fn sphere_in_frustum(world_center: vec3<f32>, radius: f32, cf: mat4x4<f32>) -> bool {
    let clip = cf * vec4<f32>(world_center, 1.0);
    let r = abs(radius);
    if (clip.x > clip.w + r) { return false; }
    if (clip.x < -clip.w - r) { return false; }
    if (clip.y > clip.w + r) { return false; }
    if (clip.y < -clip.w - r) { return false; }
    if (clip.z > clip.w + r) { return false; }
    if (clip.z < -clip.w - r) { return false; }
    return true;
}

fn lod_level(distance: f32, p: CullParams) -> u32 {
    if (distance < p.lod_end.x) { return 0u; }
    if (distance < p.lod_end.y) { return 1u; }
    if (distance < p.lod_end.z) { return 2u; }
    return 3u;
}

fn find_group_for_source(src_idx: u32) -> u32 {
    var running_offset: u32 = 0u;
    for (var g: u32 = 0u; g < params.total_groups; g++) {
        let gm = group_meta[g];
        if (src_idx >= running_offset && src_idx < running_offset + gm.source_count) {
            return g;
        }
        running_offset += gm.source_count;
    }
    return 0u;
}

@compute @workgroup_size(WORKGROUP_SIZE, 1, 1)
fn cull_main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let src_idx = gid.x;
    if (src_idx >= params.total_source_instances) {
        return;
    }

    let group_idx = find_group_for_source(src_idx);

    let src = source_instances[src_idx];
    let world_center = instance_translation(src);
    let radius = instance_bounding_radius(src);

    // Distance check
    let dist = distance(world_center, params.camera_pos.xyz);
    if (dist > params.max_draw_distance) {
        return;
    }

    // Frustum check
    if (!sphere_in_frustum(world_center, radius, params.clip_from_world)) {
        return;
    }

    // LOD check: keep LOD 0-1, cull LOD 2+
    let lod = lod_level(dist, params);
    if (lod > 1u) {
        return;
    }

    // Atomically determine write position within this group's visible region.
    let local_idx = atomicAdd(&group_counters[group_idx], 1u);

    let write_pos = group_meta[group_idx].source_offset + local_idx;
    visible_instances[write_pos] = src;

    // Write per-group draw args instance_count.
    draw_args[group_idx].instance_count = local_idx + 1u;

    // Write per-group vertex shader uniform.
    group_uniforms[group_idx].visible_offset = 0u;
    group_uniforms[group_idx].source_count = group_meta[group_idx].source_count;
    group_uniforms[group_idx].tint_enabled = group_meta[group_idx]._pad0;
    group_uniforms[group_idx].group_index = group_idx;
}

@compute @workgroup_size(WORKGROUP_SIZE, 1, 1)
fn cull_shadows(@builtin(global_invocation_id) gid: vec3<u32>) {
    let src_idx = gid.x;
    if (src_idx >= params.total_source_instances) {
        return;
    }

    let ci = shadow_params.cascade_index;
    if (ci >= params.cascade_count) {
        return;
    }

    let group_idx = find_group_for_source(src_idx);

    let src = source_instances[src_idx];
    let world_center = instance_translation(src);
    let radius = instance_bounding_radius(src);

    // Shadow distance check (shorter than main view).
    let dist = distance(world_center, params.camera_pos.xyz);
    if (dist > params.max_shadow_distance) {
        return;
    }

    // Cascade frustum check.
    if (!sphere_in_frustum(world_center, radius, cascade_clip[ci])) {
        return;
    }

    // Shadow LOD: only keep LOD 0 (full quality) for shadow casters.
    let lod = lod_level(dist, params);
    if (lod > 0u) {
        return;
    }

    // Skip if source instance has shadow culled flag (group_meta._pad0 stores tint; skip check omitted for now).

    // Atomically write to shadow visible buffer.
    let local_idx = atomicAdd(&shadow_counters[group_idx], 1u);
    let write_pos = group_meta[group_idx].source_offset + local_idx;
    shadow_visible[write_pos] = src;

    // Write per-group shadow draw args instance_count.
    shadow_draw_args[group_idx].instance_count = local_idx + 1u;
}
