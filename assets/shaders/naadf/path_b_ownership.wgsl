struct NaadfPathBOwnershipParams {
    mode_split: vec4<f32>,
    pip_min_max: vec4<f32>,
    path_b_config: vec4<f32>,
    view_from_clip: mat4x4<f32>,
}

struct NaadfPathBStats {
    ray_count: atomic<u32>,
    total_steps: atomic<u32>,
    max_steps: atomic<u32>,
    miss_reason_0_hits: atomic<u32>,
    miss_reason_1_clean_exit: atomic<u32>,
    miss_reason_2_voxel_budget: atomic<u32>,
    miss_reason_3_chunk_budget: atomic<u32>,
    miss_reason_4_distance_clamp: atomic<u32>,
    miss_reason_5_no_lookup: atomic<u32>,
    path_b_depth_rejects: atomic<u32>,
    path_b_coverage_rejects: atomic<u32>,
    path_b_naadf_accepts: atomic<u32>,
    path_b_current_kept: atomic<u32>,
    path_b_refine_requests: atomic<u32>,
    path_b_stale_or_unresident: atomic<u32>,
    path_b_ownership_changes: atomic<u32>,
}

const NAADF_OWNER_CURRENT: u32 = 0u;
const NAADF_OWNER_NAADF: u32 = 1u;
const NAADF_OWNER_REFINE_OR_MISS: u32 = 2u;

@group(3) @binding(42) var<uniform> naadf_path_b_ownership_params: NaadfPathBOwnershipParams;
@group(3) @binding(43) var naadf_path_b_scene_depth: texture_depth_2d;
@group(3) @binding(44) var naadf_path_b_foreground_coverage: texture_2d<f32>;
@group(3) @binding(45) var naadf_path_b_preview_depth: texture_2d<f32>;
@group(3) @binding(46) var naadf_path_b_preview_color: texture_2d<f32>;
@group(3) @binding(47) var naadf_path_b_current_owner: texture_storage_2d<r32uint, write>;
@group(3) @binding(48) var naadf_path_b_history_owner: texture_2d<u32>;
@group(3) @binding(49) var naadf_path_b_motion: texture_2d<f32>;
@group(3) @binding(50) var<storage, read_write> naadf_path_b_stats: NaadfPathBStats;

@compute @workgroup_size(8, 8, 1)
fn naadf_path_b_ownership(@builtin(global_invocation_id) id: vec3<u32>) {
    let output_size = textureDimensions(naadf_path_b_current_owner);
    if any(id.xy >= output_size) {
        return;
    }

    let coord = vec2<i32>(id.xy);
    let owner = naadf_path_b_owner_for_pixel(coord, output_size);
    textureStore(naadf_path_b_current_owner, coord, vec4<u32>(owner, 0u, 0u, 0u));

    if !naadf_path_b_counters_enabled() {
        return;
    }

    if naadf_path_b_mode() < 2.5 {
        return;
    }

    let motion = textureLoad(naadf_path_b_motion, coord, 0);
    if motion.z > 0.0 {
        let history_size = textureDimensions(naadf_path_b_history_owner);
        let size_f = vec2<f32>(output_size);
        let uv = (vec2<f32>(coord) + vec2<f32>(0.5)) / size_f;
        let previous_uv = uv - motion.xy;
        if all(previous_uv >= vec2<f32>(0.0)) && all(previous_uv <= vec2<f32>(1.0)) {
            let history_coord = clamp(
                vec2<i32>(previous_uv * vec2<f32>(history_size)),
                vec2<i32>(0),
                vec2<i32>(history_size) - vec2<i32>(1),
            );
            let previous_owner = textureLoad(naadf_path_b_history_owner, history_coord, 0).r;
            if previous_owner != owner {
                atomicAdd(&naadf_path_b_stats.path_b_ownership_changes, 1u);
            }
        }
    }
}

fn naadf_path_b_owner_for_pixel(coord: vec2<i32>, output_size: vec2<u32>) -> u32 {
    if naadf_path_b_mode() < 2.5 {
        return NAADF_OWNER_NAADF;
    }

    let preview_color = textureLoad(naadf_path_b_preview_color, coord, 0);
    let preview_depth = textureLoad(naadf_path_b_preview_depth, coord, 0);
    if preview_color.a <= 0.0 {
        naadf_path_b_count_stale_or_unresident(preview_depth.b);
        return NAADF_OWNER_REFINE_OR_MISS;
    }

    let scene_size = textureDimensions(naadf_path_b_scene_depth);
    let scene_coord = clamp(
        coord,
        vec2<i32>(0),
        vec2<i32>(scene_size) - vec2<i32>(1),
    );
    let scene_depth = textureLoad(naadf_path_b_scene_depth, scene_coord, 0);

    if naadf_path_b_foreground_coverage_valid() {
        let coverage_size = textureDimensions(naadf_path_b_foreground_coverage);
        let coverage_coord = clamp(
            coord,
            vec2<i32>(0),
            vec2<i32>(coverage_size) - vec2<i32>(1),
        );
        let foreground_coverage = textureLoad(naadf_path_b_foreground_coverage, coverage_coord, 0).r;
        if foreground_coverage > 0.001 {
            naadf_path_b_count_coverage_reject();
            return NAADF_OWNER_CURRENT;
        }
    }

    let uv = (vec2<f32>(coord) + vec2<f32>(0.5)) / vec2<f32>(output_size);
    let raster_linear_depth = naadf_path_b_reconstruct_linear_view_depth(uv, scene_depth);
    let naadf_linear_depth = preview_depth.r;
    if naadf_path_b_scene_depth_valid(scene_depth) &&
        raster_linear_depth <= naadf_linear_depth + naadf_path_b_ownership_params.path_b_config.x {
        naadf_path_b_count_depth_reject();
        return NAADF_OWNER_CURRENT;
    }

    naadf_path_b_count_naadf_accept();
    return NAADF_OWNER_NAADF;
}

fn naadf_path_b_count_stale_or_unresident(reason: f32) {
    if !naadf_path_b_counters_enabled() {
        return;
    }
    if reason >= 2.5 {
        atomicAdd(&naadf_path_b_stats.path_b_refine_requests, 1u);
    } else {
        atomicAdd(&naadf_path_b_stats.path_b_stale_or_unresident, 1u);
    }
    atomicAdd(&naadf_path_b_stats.path_b_current_kept, 1u);
}

fn naadf_path_b_count_coverage_reject() {
    if naadf_path_b_counters_enabled() {
        atomicAdd(&naadf_path_b_stats.path_b_coverage_rejects, 1u);
        atomicAdd(&naadf_path_b_stats.path_b_current_kept, 1u);
    }
}

fn naadf_path_b_count_depth_reject() {
    if naadf_path_b_counters_enabled() {
        atomicAdd(&naadf_path_b_stats.path_b_depth_rejects, 1u);
        atomicAdd(&naadf_path_b_stats.path_b_current_kept, 1u);
    }
}

fn naadf_path_b_count_naadf_accept() {
    if naadf_path_b_counters_enabled() {
        atomicAdd(&naadf_path_b_stats.path_b_naadf_accepts, 1u);
    }
}

fn naadf_path_b_mode() -> f32 {
    return naadf_path_b_ownership_params.mode_split.x;
}

fn naadf_path_b_counters_enabled() -> bool {
    return naadf_path_b_ownership_params.mode_split.w > 0.5;
}

fn naadf_path_b_scene_depth_valid(depth: f32) -> bool {
    return naadf_path_b_ownership_params.path_b_config.z > 0.5 && depth > 0.001;
}

fn naadf_path_b_foreground_coverage_valid() -> bool {
    return naadf_path_b_ownership_params.path_b_config.w > 0.5;
}

fn naadf_path_b_reconstruct_linear_view_depth(uv: vec2<f32>, depth: f32) -> f32 {
    if !naadf_path_b_scene_depth_valid(depth) {
        return 1000000.0;
    }
    let ndc = vec4<f32>(uv * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), depth, 1.0);
    let view = naadf_path_b_ownership_params.view_from_clip * ndc;
    let view_pos = view.xyz / max(view.w, 0.000001);
    return max(-view_pos.z, 0.0);
}
