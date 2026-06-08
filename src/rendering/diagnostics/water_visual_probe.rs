use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use bevy::diagnostic::FrameCount;
use bevy::prelude::*;
use bevy_water::water::material::StandardWaterMaterial;
use serde::Serialize;

use crate::camera::controller::PlayerCamera;
use crate::constants::{
    CHUNK_SIZE_I32, RAY_STEP, WATER_FANCY_MIN_DEPTH, WATER_FANCY_MIN_TRIANGLES, WATER_LEVEL,
};
use crate::interaction::TargetedBlock;
use crate::performance::AreaTimingRecorder;
use crate::player::Player;
use crate::rendering::water_reflection::{
    WaterPresence, WaterReflectionConfig, WaterReflectionMaskStats, WaterReflectionStatus,
};
use crate::voxel::meshing::{
    ChunkMesh, WaterBodyId, WaterBodyKind, WaterBodyMaterialMode, WaterMesh, WaterMeshDetail,
};
use crate::voxel::octree::OctreeAabb;
use crate::voxel::plugin::WaterBodyRegistry;
use crate::voxel::types::Voxel;
use crate::voxel::world::VoxelWorld;

const WATER_Y_TOLERANCE: f32 = 1.2;
const NEAR_VISIBLE_WATER_DISTANCE: f32 = 24.0;
const PROBE_RAY_DISTANCE: f32 = 256.0;

pub struct WaterVisualProbePlugin;

impl Plugin for WaterVisualProbePlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<WaterVisualDebugState>().add_systems(
            Update,
            (
                update_water_visual_debug_counters,
                dump_water_visual_probe.after(update_water_visual_debug_counters),
            ),
        );
    }
}

#[derive(Resource, Default, Clone, Debug)]
pub struct WaterVisualDebugState {
    pub nearest_material_near: bool,
    pub nearest_material_far: bool,
    pub nearest_body_kind: WaterBodyKind,
    pub nearest_material_mode: WaterBodyMaterialMode,
    pub nearest_max_depth: usize,
    pub nearest_triangles: usize,
    pub reflection_eligible: bool,
    pub reflection_active: bool,
    pub compositor_pixel_matched: bool,
    pub body_unknown: bool,
}

type WaterMeshProbeQuery<'w, 's> = Query<
    'w,
    's,
    (
        Entity,
        &'static Transform,
        Option<&'static ChunkMesh>,
        Option<&'static WaterMeshDetail>,
        Option<&'static Visibility>,
        Option<&'static InheritedVisibility>,
        Option<&'static ViewVisibility>,
        Option<&'static MeshMaterial3d<StandardWaterMaterial>>,
        Option<&'static MeshMaterial3d<StandardMaterial>>,
        Option<&'static WaterBodyId>,
    ),
    With<WaterMesh>,
>;

#[derive(Serialize)]
struct WaterVisualProbeDump {
    schema_version: u32,
    timestamp_utc: String,
    trigger: String,
    toggles: WaterDebugTogglesDump,
    player_position: Option<Vec3Dump>,
    camera_position: Vec3Dump,
    camera_forward: Vec3Dump,
    target_cursor: TargetCursorDump,
    reflection: ReflectionDump,
    compositor: CompositorDump,
    probes: Vec<WaterMeshProbeDump>,
    local_voxel_depth: Option<LocalWaterDepthDump>,
}

#[derive(Serialize)]
struct WaterDebugTogglesDump {
    force_all_water_fancy: bool,
    force_all_water_cheap: bool,
    force_water_body_kind: Option<String>,
    force_nearest_water_kind: Option<String>,
    force_water_reflection_active: bool,
    disable_water_reflection_compositor: bool,
    water_debug_solid_color: bool,
    disable_voxel_water_ripple_lines: bool,
    water_reflection_debug_view: Option<String>,
}

#[derive(Serialize)]
struct TargetCursorDump {
    targeted_block_position: Option<IVec3Dump>,
    targeted_block_type: Option<String>,
    water_sample_position: Option<IVec3Dump>,
    water_sample_source: String,
}

#[derive(Serialize)]
struct ReflectionDump {
    active: bool,
    sampled: bool,
    disabled_reason: String,
    nearest_visible_distance: Option<f32>,
    visible_meshes: u32,
    eligible_meshes: u32,
    view_visible_meshes: u32,
    total_water_meshes: u32,
}

#[derive(Serialize)]
struct CompositorDump {
    water_level: f32,
    water_y_tolerance: f32,
    center_estimated_world_y: Option<f32>,
    center_passes_water_y_tolerance: Option<bool>,
    target_estimated_world_y: Option<f32>,
    target_passes_water_y_tolerance: Option<bool>,
    center_depth_source_likely: String,
    target_depth_source_likely: String,
    depth_readback_available: bool,
    water_uses_alpha_mode_blend: bool,
    water_may_not_write_depth_prepass: bool,
    compositor_disabled_by_env: bool,
    mask_pixels: u32,
    mask_bodies: u32,
    compositor_applied_pixels: u32,
    compositor_skipped_no_mask_pixels: u32,
    compositor_skipped_disabled_pixels: u32,
    compositor_skipped_too_far_pixels: u32,
}

#[derive(Serialize)]
struct WaterMeshProbeDump {
    label: String,
    nearest_water_mesh_entity: Option<String>,
    water_mesh_chunk_position: Option<IVec3Dump>,
    water_mesh_material_type: String,
    water_body_id: Option<u32>,
    water_body_kind: String,
    water_body_material_mode: String,
    water_body_surface_area: Option<f32>,
    water_body_max_depth: Option<usize>,
    water_body_average_depth: Option<f32>,
    water_body_nearest_distance: Option<f32>,
    water_body_visible_chunks: Option<u32>,
    water_body_chunk_count: Option<u32>,
    triangle_count: Option<usize>,
    max_depth: Option<usize>,
    distance_to_camera: Option<f32>,
    in_camera_frustum: Option<bool>,
    view_visible: Option<bool>,
    visibility: Option<String>,
    inherited_visibility: Option<bool>,
    reflection_eligible: Option<bool>,
}

#[derive(Serialize)]
struct LocalWaterDepthDump {
    center: IVec3Dump,
    columns: Vec<WaterColumnDump>,
    max_depth: usize,
    average_depth: f32,
    connected_to_nearby_water_cells: bool,
    ocean_connected_or_isolated: String,
}

#[derive(Serialize)]
struct WaterColumnDump {
    offset_x: i32,
    offset_z: i32,
    world_x: i32,
    world_z: i32,
    water_surface_y: Option<i32>,
    liquid_voxels_below_surface: usize,
    first_solid_below_water: Option<IVec3Dump>,
    connected_to_neighbor_water: bool,
}

#[derive(Serialize, Clone, Copy)]
struct Vec3Dump {
    x: f32,
    y: f32,
    z: f32,
}

#[derive(Serialize, Clone, Copy)]
struct IVec3Dump {
    x: i32,
    y: i32,
    z: i32,
}

pub fn update_water_visual_debug_counters(
    camera_query: Query<(&Transform, &Projection), With<PlayerCamera>>,
    water_meshes: WaterMeshProbeQuery,
    water_body_registry: Option<Res<WaterBodyRegistry>>,
    reflection_config: Option<Res<WaterReflectionConfig>>,
    reflection_status: Option<Res<WaterReflectionStatus>>,
    mut state: ResMut<WaterVisualDebugState>,
    mut timing: ResMut<AreaTimingRecorder>,
    frame: Res<FrameCount>,
) {
    let Ok((camera_transform, projection)) = camera_query.single() else {
        return;
    };

    let nearest = nearest_water_mesh(
        camera_transform.translation,
        camera_transform,
        projection,
        &water_meshes,
        reflection_config.as_deref(),
    );

    state.nearest_material_near = nearest
        .as_ref()
        .is_some_and(|mesh| mesh.material_type == WaterMaterialKind::Near);
    state.nearest_material_far = nearest
        .as_ref()
        .is_some_and(|mesh| mesh.material_type == WaterMaterialKind::Far);
    let nearest_body = nearest
        .as_ref()
        .and_then(|mesh| mesh.body_id)
        .and_then(|id| {
            water_body_registry
                .as_deref()
                .and_then(|registry| registry.bodies.get(&id))
        });
    state.nearest_body_kind = nearest_body
        .map(|body| body.kind)
        .unwrap_or(WaterBodyKind::Unknown);
    state.nearest_material_mode = nearest_body
        .map(|body| body.material_mode)
        .unwrap_or(WaterBodyMaterialMode::Unknown);
    state.nearest_max_depth = nearest
        .as_ref()
        .and_then(|mesh| mesh.max_depth)
        .unwrap_or(0);
    state.nearest_triangles = nearest
        .as_ref()
        .and_then(|mesh| mesh.triangle_count)
        .unwrap_or(0);
    state.reflection_eligible = nearest
        .as_ref()
        .is_some_and(|mesh| mesh.reflection_eligible.unwrap_or(false));
    state.reflection_active = reflection_status
        .as_deref()
        .is_some_and(|status| status.active);
    state.compositor_pixel_matched = state.reflection_active
        && state.reflection_eligible
        && !env_flag("VOXEL_DISABLE_WATER_REFLECTION_COMPOSITOR");
    state.body_unknown = nearest_body.is_none();

    timing.record_count(
        frame.0,
        "Water Debug Nearest Material Near",
        u8::from(state.nearest_material_near) as f64,
    );
    timing.record_count(
        frame.0,
        "Water Debug Nearest Material Far",
        u8::from(state.nearest_material_far) as f64,
    );
    timing.record_count(
        frame.0,
        "Water Debug Nearest Body Kind",
        water_body_kind_code(state.nearest_body_kind) as f64,
    );
    timing.record_count(
        frame.0,
        "Water Debug Nearest Material Mode",
        water_body_material_mode_code(state.nearest_material_mode) as f64,
    );
    timing.record_count(
        frame.0,
        "Water Debug Nearest Max Depth",
        state.nearest_max_depth as f64,
    );
    timing.record_count(
        frame.0,
        "Water Debug Nearest Triangles",
        state.nearest_triangles as f64,
    );
    timing.record_count(
        frame.0,
        "Water Debug Reflection Eligible",
        u8::from(state.reflection_eligible) as f64,
    );
    timing.record_count(
        frame.0,
        "Water Debug Reflection Active",
        u8::from(state.reflection_active) as f64,
    );
    timing.record_count(
        frame.0,
        "Water Debug Compositor Pixel Matched",
        u8::from(state.compositor_pixel_matched) as f64,
    );
    timing.record_count(
        frame.0,
        "Water Debug Body Unknown",
        u8::from(state.body_unknown) as f64,
    );
}

#[allow(clippy::too_many_arguments)]
fn dump_water_visual_probe(
    keys: Res<ButtonInput<KeyCode>>,
    world: Res<VoxelWorld>,
    targeted: Res<TargetedBlock>,
    camera_query: Query<(&Transform, &Projection), With<PlayerCamera>>,
    player_query: Query<&GlobalTransform, With<Player>>,
    water_meshes: WaterMeshProbeQuery,
    water_body_registry: Option<Res<WaterBodyRegistry>>,
    reflection_config: Option<Res<WaterReflectionConfig>>,
    reflection_status: Option<Res<WaterReflectionStatus>>,
    presence: Option<Res<WaterPresence>>,
    mask_stats: Option<Res<WaterReflectionMaskStats>>,
    fancy_materials: Res<Assets<StandardWaterMaterial>>,
    cheap_materials: Res<Assets<StandardMaterial>>,
    mut env_probe_dumped: Local<bool>,
) {
    // Shift+F10. The fly camera no longer descends while a function key is held (see
    // the camera controller), so this no longer nudges the view mid-capture.
    let shift_held = keys.pressed(KeyCode::ShiftLeft) || keys.pressed(KeyCode::ShiftRight);
    let hotkey_triggered = shift_held && keys.just_pressed(KeyCode::F10);
    let env_triggered = env_flag("VOXEL_WATER_VISUAL_PROBE_ONCE") && !*env_probe_dumped;
    if !hotkey_triggered && !env_triggered {
        return;
    }
    if env_triggered && water_meshes.iter().next().is_none() {
        return;
    }

    let Ok((camera_transform, projection)) = camera_query.single() else {
        warn!("Dump Water Visual Probe skipped: player camera not found");
        return;
    };
    if env_triggered && !camera_matches_probe_wait(camera_transform.translation) {
        return;
    }
    if env_triggered {
        *env_probe_dumped = true;
    }

    let target = target_cursor_water_sample(&world, &targeted, camera_transform);
    let camera_water_pos = highest_water_surface_at_xz(
        &world,
        camera_transform.translation.x.floor() as i32,
        camera_transform.translation.z.floor() as i32,
    )
    .map(|y| {
        IVec3::new(
            camera_transform.translation.x.floor() as i32,
            y,
            camera_transform.translation.z.floor() as i32,
        )
    });

    let camera_probe_point = camera_water_pos
        .map(|pos| pos.as_vec3() + Vec3::splat(0.5))
        .unwrap_or(camera_transform.translation);
    let target_probe_point = target
        .water_sample_position
        .map(|pos| pos.as_vec3() + Vec3::splat(0.5))
        .unwrap_or(camera_transform.translation + camera_transform.forward().as_vec3() * 32.0);

    let camera_probe = build_probe_dump(
        "under_or_near_camera",
        camera_probe_point,
        camera_transform,
        projection,
        &water_meshes,
        water_body_registry.as_deref(),
        reflection_config.as_deref(),
    );
    let target_probe = build_probe_dump(
        "under_target_cursor",
        target_probe_point,
        camera_transform,
        projection,
        &water_meshes,
        water_body_registry.as_deref(),
        reflection_config.as_deref(),
    );

    let nearest_material_blend = nearest_water_mesh(
        target_probe_point,
        camera_transform,
        projection,
        &water_meshes,
        reflection_config.as_deref(),
    )
    .map(|nearest| {
        water_material_uses_blend(
            nearest.material_type,
            nearest.fancy_handle.as_ref(),
            nearest.cheap_handle.as_ref(),
            &fancy_materials,
            &cheap_materials,
        )
    })
    .unwrap_or(false);

    let center = compositor_pixel_estimate(
        &world,
        camera_transform,
        camera_transform.forward().as_vec3(),
    );
    let target_estimate = target
        .water_sample_position
        .map(|pos| pos.as_vec3() + Vec3::splat(0.5));
    let target_depth_source = if let Some(pos) = target.water_sample_position {
        depth_source_for_point(
            &world,
            camera_transform.translation,
            pos.as_vec3() + Vec3::splat(0.5),
        )
    } else {
        "unknown-no-target-water".to_string()
    };

    let status = reflection_status.as_deref().copied().unwrap_or_default();
    let presence = presence.as_deref().copied().unwrap_or_default();
    let mask_stats = mask_stats.as_deref().copied().unwrap_or_default();
    let timestamp = timestamp_utc_compact();
    let dump = WaterVisualProbeDump {
        schema_version: 1,
        timestamp_utc: timestamp.clone(),
        trigger: if hotkey_triggered {
            "Shift+F10 Dump Water Visual Probe".to_string()
        } else {
            "VOXEL_WATER_VISUAL_PROBE_ONCE".to_string()
        },
        toggles: WaterDebugTogglesDump {
            force_all_water_fancy: env_flag("VOXEL_FORCE_ALL_WATER_FANCY"),
            force_all_water_cheap: env_flag("VOXEL_FORCE_ALL_WATER_CHEAP"),
            force_nearest_water_kind: std::env::var("VOXEL_FORCE_NEAREST_WATER_KIND").ok(),
            force_water_body_kind: std::env::var("VOXEL_FORCE_WATER_BODY_KIND").ok(),
            force_water_reflection_active: env_flag("VOXEL_FORCE_WATER_REFLECTION_ACTIVE"),
            disable_water_reflection_compositor: env_flag(
                "VOXEL_DISABLE_WATER_REFLECTION_COMPOSITOR",
            ),
            water_debug_solid_color: env_flag("VOXEL_WATER_DEBUG_SOLID_COLOR"),
            disable_voxel_water_ripple_lines: env_flag("VOXEL_DISABLE_VOXEL_WATER_RIPPLE_LINES"),
            water_reflection_debug_view: std::env::var("VOXEL_WATER_REFLECTION_DEBUG_VIEW").ok(),
        },
        player_position: player_query
            .iter()
            .next()
            .map(|t| Vec3Dump::from(t.translation())),
        camera_position: Vec3Dump::from(camera_transform.translation),
        camera_forward: Vec3Dump::from(camera_transform.forward().as_vec3()),
        target_cursor: TargetCursorDump {
            targeted_block_position: targeted.position.map(IVec3Dump::from),
            targeted_block_type: targeted.voxel_type.map(|voxel| format!("{voxel:?}")),
            water_sample_position: target.water_sample_position.map(IVec3Dump::from),
            water_sample_source: target.source,
        },
        reflection: ReflectionDump {
            active: status.active,
            sampled: status.sample_reflection,
            disabled_reason: status.reason.as_str().to_string(),
            nearest_visible_distance: presence.nearest_visible_distance,
            visible_meshes: presence.visible_meshes,
            eligible_meshes: presence.eligible_meshes,
            view_visible_meshes: presence.view_visible_meshes,
            total_water_meshes: presence.water_meshes,
        },
        compositor: CompositorDump {
            water_level: WATER_LEVEL as f32,
            water_y_tolerance: WATER_Y_TOLERANCE,
            center_estimated_world_y: center.world_y,
            center_passes_water_y_tolerance: center
                .world_y
                .map(|y| (y - WATER_LEVEL as f32).abs() <= WATER_Y_TOLERANCE),
            target_estimated_world_y: target_estimate.map(|pos| pos.y),
            target_passes_water_y_tolerance: target_estimate
                .map(|pos| (pos.y - WATER_LEVEL as f32).abs() <= WATER_Y_TOLERANCE),
            center_depth_source_likely: center.depth_source_likely,
            target_depth_source_likely: target_depth_source,
            depth_readback_available: false,
            water_uses_alpha_mode_blend: nearest_material_blend,
            water_may_not_write_depth_prepass: nearest_material_blend,
            compositor_disabled_by_env: env_flag("VOXEL_DISABLE_WATER_REFLECTION_COMPOSITOR"),
            mask_pixels: mask_stats.estimated_mask_pixels,
            mask_bodies: mask_stats.mask_bodies,
            compositor_applied_pixels: mask_stats.estimated_applied_pixels,
            compositor_skipped_no_mask_pixels: mask_stats.estimated_skipped_no_mask_pixels,
            compositor_skipped_disabled_pixels: mask_stats.estimated_skipped_disabled_pixels,
            compositor_skipped_too_far_pixels: mask_stats.estimated_skipped_too_far_pixels,
        },
        probes: vec![camera_probe, target_probe],
        local_voxel_depth: target
            .water_sample_position
            .or(camera_water_pos)
            .map(|pos| local_water_depth_dump(&world, pos)),
    };

    match write_probe_dump(&dump, &timestamp) {
        Ok(path) => info!("Dump Water Visual Probe wrote {}", path.display()),
        Err(err) => warn!("Dump Water Visual Probe failed: {err}"),
    }
}

#[derive(Clone)]
struct TargetWaterSample {
    water_sample_position: Option<IVec3>,
    source: String,
}

fn target_cursor_water_sample(
    world: &VoxelWorld,
    targeted: &TargetedBlock,
    camera_transform: &Transform,
) -> TargetWaterSample {
    if let Some(pos) = raycast_liquid(
        world,
        camera_transform.translation,
        camera_transform.forward().as_vec3(),
        PROBE_RAY_DISTANCE,
    ) {
        return TargetWaterSample {
            water_sample_position: Some(pos),
            source: "camera-ray-first-liquid".to_string(),
        };
    }

    if let Some(target_pos) = targeted.position {
        if let Some(y) = highest_water_surface_at_xz(world, target_pos.x, target_pos.z) {
            return TargetWaterSample {
                water_sample_position: Some(IVec3::new(target_pos.x, y, target_pos.z)),
                source: "target-block-column-water-surface".to_string(),
            };
        }
    }

    if let Some(pos) = ray_water_plane_cell(world, camera_transform) {
        return TargetWaterSample {
            water_sample_position: Some(pos),
            source: "camera-ray-water-level-plane".to_string(),
        };
    }

    TargetWaterSample {
        water_sample_position: None,
        source: "none".to_string(),
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum WaterMaterialKind {
    Near,
    Far,
    Unknown,
}

struct NearestWaterMesh {
    entity: Entity,
    chunk_position: Option<IVec3>,
    material_type: WaterMaterialKind,
    triangle_count: Option<usize>,
    max_depth: Option<usize>,
    distance_to_camera: f32,
    in_camera_frustum: bool,
    view_visible: Option<bool>,
    visibility: Option<String>,
    inherited_visibility: Option<bool>,
    reflection_eligible: Option<bool>,
    fancy_handle: Option<Handle<StandardWaterMaterial>>,
    cheap_handle: Option<Handle<StandardMaterial>>,
    body_id: Option<WaterBodyId>,
}

fn nearest_water_mesh(
    point: Vec3,
    camera_transform: &Transform,
    projection: &Projection,
    water_meshes: &WaterMeshProbeQuery,
    reflection_config: Option<&WaterReflectionConfig>,
) -> Option<NearestWaterMesh> {
    water_meshes
        .iter()
        .map(
            |(
                entity,
                transform,
                chunk_mesh,
                detail,
                visibility,
                inherited_visibility,
                view_visibility,
                fancy_mat,
                cheap_mat,
                body_id,
            )| {
                let aabb = water_mesh_aabb(transform);
                let distance_to_camera = distance_to_aabb_xz(camera_transform.translation, aabb);
                let distance_to_point = distance_to_aabb_xz(point, aabb);
                let in_camera_frustum = aabb_in_camera_view(camera_transform, projection, aabb);
                let reflection_eligible = reflection_config.map(|config| {
                    let visible = !config.require_water_in_frustum
                        || in_camera_frustum
                        || distance_to_camera <= NEAR_VISIBLE_WATER_DISTANCE;
                    let in_range = config.auto_disable_distance <= 0.0
                        || distance_to_camera <= config.auto_disable_distance;
                    let meaningful = detail
                        .map(|detail| {
                            detail.triangle_count >= WATER_FANCY_MIN_TRIANGLES
                                && detail.max_depth >= WATER_FANCY_MIN_DEPTH
                        })
                        .unwrap_or(true);
                    visible && in_range && meaningful
                });
                let material_type = match (fancy_mat.is_some(), cheap_mat.is_some()) {
                    (true, _) => WaterMaterialKind::Near,
                    (false, true) => WaterMaterialKind::Far,
                    _ => WaterMaterialKind::Unknown,
                };
                (
                    distance_to_point,
                    NearestWaterMesh {
                        entity,
                        chunk_position: chunk_mesh.map(|mesh| mesh.chunk_position),
                        material_type,
                        triangle_count: detail.map(|detail| detail.triangle_count),
                        max_depth: detail.map(|detail| detail.max_depth),
                        distance_to_camera,
                        in_camera_frustum,
                        view_visible: view_visibility.map(|visibility| visibility.get()),
                        visibility: visibility.map(|visibility| format!("{visibility:?}")),
                        inherited_visibility: inherited_visibility
                            .map(|visibility| visibility.get()),
                        reflection_eligible,
                        fancy_handle: fancy_mat.map(|mat| mat.0.clone()),
                        cheap_handle: cheap_mat.map(|mat| mat.0.clone()),
                        body_id: body_id.copied(),
                    },
                )
            },
        )
        .min_by(|(a, _), (b, _)| a.total_cmp(b))
        .map(|(_, mesh)| mesh)
}

fn build_probe_dump(
    label: &str,
    point: Vec3,
    camera_transform: &Transform,
    projection: &Projection,
    water_meshes: &WaterMeshProbeQuery,
    water_body_registry: Option<&WaterBodyRegistry>,
    reflection_config: Option<&WaterReflectionConfig>,
) -> WaterMeshProbeDump {
    let nearest = nearest_water_mesh(
        point,
        camera_transform,
        projection,
        water_meshes,
        reflection_config,
    );
    let body = nearest
        .as_ref()
        .and_then(|mesh| mesh.body_id)
        .and_then(|id| water_body_registry.and_then(|registry| registry.bodies.get(&id)));
    WaterMeshProbeDump {
        label: label.to_string(),
        nearest_water_mesh_entity: nearest.as_ref().map(|mesh| format!("{:?}", mesh.entity)),
        water_mesh_chunk_position: nearest
            .as_ref()
            .and_then(|mesh| mesh.chunk_position.map(IVec3Dump::from)),
        water_mesh_material_type: nearest
            .as_ref()
            .map(|mesh| material_kind_name(mesh.material_type).to_string())
            .unwrap_or_else(|| "unknown/missing".to_string()),
        water_body_id: nearest
            .as_ref()
            .and_then(|mesh| mesh.body_id.map(|id| id.0)),
        water_body_kind: body
            .map(|body| body.kind.as_str().to_string())
            .unwrap_or_else(|| "unknown".to_string()),
        water_body_material_mode: body
            .map(|body| body.material_mode.as_str().to_string())
            .unwrap_or_else(|| "unknown".to_string()),
        water_body_surface_area: body.map(|body| body.surface_area),
        water_body_max_depth: body.map(|body| body.max_depth),
        water_body_average_depth: body.map(|body| body.average_depth),
        water_body_nearest_distance: body.map(|body| body.nearest_distance),
        water_body_visible_chunks: body.map(|body| body.visible_chunks),
        water_body_chunk_count: body.map(|body| body.chunk_count),
        triangle_count: nearest.as_ref().and_then(|mesh| mesh.triangle_count),
        max_depth: nearest.as_ref().and_then(|mesh| mesh.max_depth),
        distance_to_camera: nearest.as_ref().map(|mesh| mesh.distance_to_camera),
        in_camera_frustum: nearest.as_ref().map(|mesh| mesh.in_camera_frustum),
        view_visible: nearest.as_ref().and_then(|mesh| mesh.view_visible),
        visibility: nearest.as_ref().and_then(|mesh| mesh.visibility.clone()),
        inherited_visibility: nearest.as_ref().and_then(|mesh| mesh.inherited_visibility),
        reflection_eligible: nearest.as_ref().and_then(|mesh| mesh.reflection_eligible),
    }
}

fn material_kind_name(kind: WaterMaterialKind) -> &'static str {
    match kind {
        WaterMaterialKind::Near => "near StandardWaterMaterial",
        WaterMaterialKind::Far => "far StandardMaterial",
        WaterMaterialKind::Unknown => "unknown/missing",
    }
}

fn camera_matches_probe_wait(camera_position: Vec3) -> bool {
    let Ok(value) = std::env::var("VOXEL_WATER_VISUAL_PROBE_WAIT_CAMERA_XZ") else {
        return true;
    };
    let parts: Vec<_> = value
        .split([',', ';', ' '])
        .filter(|part| !part.is_empty())
        .collect();
    if parts.len() < 2 {
        return true;
    }
    let Ok(x) = parts[0].parse::<f32>() else {
        return true;
    };
    let Ok(z) = parts[1].parse::<f32>() else {
        return true;
    };
    let threshold = parts
        .get(2)
        .and_then(|part| part.parse::<f32>().ok())
        .unwrap_or(3.0);
    Vec2::new(camera_position.x - x, camera_position.z - z).length() <= threshold
}

fn water_body_kind_code(kind: WaterBodyKind) -> u8 {
    match kind {
        WaterBodyKind::Ocean => 1,
        WaterBodyKind::Lake => 2,
        WaterBodyKind::River => 3,
        WaterBodyKind::Pond => 4,
        WaterBodyKind::ShallowFlood => 5,
        WaterBodyKind::Unknown => 0,
    }
}

fn water_body_material_mode_code(mode: WaterBodyMaterialMode) -> u8 {
    match mode {
        WaterBodyMaterialMode::Fancy => 1,
        WaterBodyMaterialMode::Cheap => 2,
        WaterBodyMaterialMode::Hidden => 3,
        WaterBodyMaterialMode::Unknown => 0,
    }
}

fn water_material_uses_blend(
    kind: WaterMaterialKind,
    fancy_handle: Option<&Handle<StandardWaterMaterial>>,
    cheap_handle: Option<&Handle<StandardMaterial>>,
    fancy_materials: &Assets<StandardWaterMaterial>,
    cheap_materials: &Assets<StandardMaterial>,
) -> bool {
    match kind {
        WaterMaterialKind::Near => fancy_handle
            .and_then(|handle| fancy_materials.get(handle))
            .is_some_and(|mat| matches!(mat.base.alpha_mode, AlphaMode::Blend)),
        WaterMaterialKind::Far => cheap_handle
            .and_then(|handle| cheap_materials.get(handle))
            .is_some_and(|mat| matches!(mat.alpha_mode, AlphaMode::Blend)),
        WaterMaterialKind::Unknown => false,
    }
}

struct CompositorPixelEstimate {
    world_y: Option<f32>,
    depth_source_likely: String,
}

fn compositor_pixel_estimate(
    world: &VoxelWorld,
    camera_transform: &Transform,
    direction: Vec3,
) -> CompositorPixelEstimate {
    let origin = camera_transform.translation;
    let water_y = WATER_LEVEL as f32;
    let water_t = if direction.y.abs() > f32::EPSILON {
        let t = (water_y - origin.y) / direction.y;
        (t > 0.0).then_some(t)
    } else {
        None
    };

    let Some(water_t) = water_t else {
        return CompositorPixelEstimate {
            world_y: None,
            depth_source_likely: "ray-does-not-intersect-water-plane".to_string(),
        };
    };

    let plane_pos = origin + direction.normalize() * water_t;
    CompositorPixelEstimate {
        world_y: Some(plane_pos.y),
        depth_source_likely: depth_source_along_ray(world, origin, direction, water_t),
    }
}

fn depth_source_along_ray(
    world: &VoxelWorld,
    origin: Vec3,
    direction: Vec3,
    water_t: f32,
) -> String {
    let first_solid_t = first_solid_distance(world, origin, direction, PROBE_RAY_DISTANCE);
    if first_solid_t.is_some_and(|solid_t| solid_t < water_t - RAY_STEP) {
        return "terrain-before-water-plane".to_string();
    }

    let water_pos = origin + direction.normalize() * water_t;
    let water_cell = IVec3::new(
        water_pos.x.floor() as i32,
        WATER_LEVEL,
        water_pos.z.floor() as i32,
    );
    if world
        .get_voxel(water_cell)
        .is_some_and(|voxel| voxel.is_liquid())
    {
        if first_solid_t.is_some_and(|solid_t| solid_t > water_t + RAY_STEP) {
            return "terrain-below-water-if-water-does-not-write-depth".to_string();
        }
        return "water-plane-candidate".to_string();
    }

    if first_solid_t.is_some() {
        "terrain-not-water".to_string()
    } else {
        "sky-or-unloaded-depth".to_string()
    }
}

fn depth_source_for_point(world: &VoxelWorld, origin: Vec3, point: Vec3) -> String {
    let to_point = point - origin;
    if to_point.length_squared() <= f32::EPSILON {
        return "camera-at-target".to_string();
    }
    let direction = to_point.normalize();
    let distance = to_point.length();
    if first_solid_distance(world, origin, direction, distance)
        .is_some_and(|solid_t| solid_t < distance - RAY_STEP)
    {
        "terrain-before-target-water".to_string()
    } else {
        "target-water-candidate".to_string()
    }
}

fn first_solid_distance(
    world: &VoxelWorld,
    origin: Vec3,
    direction: Vec3,
    max_distance: f32,
) -> Option<f32> {
    let step = direction.normalize() * RAY_STEP;
    let steps = (max_distance / RAY_STEP) as i32;
    let mut pos = origin;
    let mut previous = IVec3::new(
        pos.x.floor() as i32,
        pos.y.floor() as i32,
        pos.z.floor() as i32,
    );

    for i in 0..steps {
        pos += step;
        let block = IVec3::new(
            pos.x.floor() as i32,
            pos.y.floor() as i32,
            pos.z.floor() as i32,
        );
        if block == previous {
            continue;
        }
        if world.get_voxel(block).is_some_and(|voxel| voxel.is_solid()) {
            return Some(i as f32 * RAY_STEP);
        }
        previous = block;
    }
    None
}

fn raycast_liquid(
    world: &VoxelWorld,
    origin: Vec3,
    direction: Vec3,
    max_distance: f32,
) -> Option<IVec3> {
    let step = direction.normalize() * RAY_STEP;
    let steps = (max_distance / RAY_STEP) as i32;
    let mut pos = origin;
    let mut previous = IVec3::new(
        pos.x.floor() as i32,
        pos.y.floor() as i32,
        pos.z.floor() as i32,
    );

    for _ in 0..steps {
        pos += step;
        let block = IVec3::new(
            pos.x.floor() as i32,
            pos.y.floor() as i32,
            pos.z.floor() as i32,
        );
        if block == previous {
            continue;
        }
        if let Some(voxel) = world.get_voxel(block) {
            if voxel.is_liquid() {
                return Some(block);
            }
            if voxel.is_solid() {
                return None;
            }
        }
        previous = block;
    }
    None
}

fn ray_water_plane_cell(world: &VoxelWorld, camera_transform: &Transform) -> Option<IVec3> {
    let origin = camera_transform.translation;
    let direction = camera_transform.forward().as_vec3();
    if direction.y.abs() <= f32::EPSILON {
        return None;
    }
    let t = (WATER_LEVEL as f32 - origin.y) / direction.y;
    if t <= 0.0 {
        return None;
    }
    let pos = origin + direction * t;
    let cell = IVec3::new(pos.x.floor() as i32, WATER_LEVEL, pos.z.floor() as i32);
    world
        .get_voxel(cell)
        .is_some_and(|voxel| voxel.is_liquid())
        .then_some(cell)
}

fn highest_water_surface_at_xz(world: &VoxelWorld, x: i32, z: i32) -> Option<i32> {
    let max_y = world.world_size_chunks().y * CHUNK_SIZE_I32 - 1;
    for y in (0..=max_y).rev() {
        let pos = IVec3::new(x, y, z);
        if !world.get_voxel(pos).is_some_and(|voxel| voxel.is_liquid()) {
            continue;
        }
        let above = world.get_voxel(pos + IVec3::Y);
        if above.is_none_or(|voxel| !voxel.is_liquid()) {
            return Some(y);
        }
    }
    None
}

fn local_water_depth_dump(world: &VoxelWorld, center: IVec3) -> LocalWaterDepthDump {
    let mut columns = Vec::new();
    let mut max_depth = 0usize;
    let mut total_depth = 0usize;
    let mut depth_columns = 0usize;
    let mut connected_any = false;

    for dz in -2..=2 {
        for dx in -2..=2 {
            let x = center.x + dx;
            let z = center.z + dz;
            let surface_y = highest_water_surface_at_xz(world, x, z);
            let mut depth = 0usize;
            let mut first_solid = None;
            let mut connected = false;

            if let Some(y) = surface_y {
                let mut scan_y = y;
                while scan_y >= 0 {
                    let pos = IVec3::new(x, scan_y, z);
                    match world.get_voxel(pos) {
                        Some(voxel) if voxel.is_liquid() => depth += 1,
                        Some(voxel) if voxel.is_solid() => {
                            first_solid = Some(pos);
                            break;
                        }
                        _ => {}
                    }
                    if scan_y == 0 {
                        break;
                    }
                    scan_y -= 1;
                }

                connected = [IVec3::X, IVec3::NEG_X, IVec3::Z, IVec3::NEG_Z]
                    .into_iter()
                    .any(|offset| {
                        world
                            .get_voxel(IVec3::new(x, y, z) + offset)
                            .is_some_and(|voxel| voxel.is_liquid())
                    });
                connected_any |= connected;
                max_depth = max_depth.max(depth);
                total_depth += depth;
                depth_columns += 1;
            }

            columns.push(WaterColumnDump {
                offset_x: dx,
                offset_z: dz,
                world_x: x,
                world_z: z,
                water_surface_y: surface_y,
                liquid_voxels_below_surface: depth,
                first_solid_below_water: first_solid.map(IVec3Dump::from),
                connected_to_neighbor_water: connected,
            });
        }
    }

    LocalWaterDepthDump {
        center: IVec3Dump::from(center),
        columns,
        max_depth,
        average_depth: if depth_columns == 0 {
            0.0
        } else {
            total_depth as f32 / depth_columns as f32
        },
        connected_to_nearby_water_cells: connected_any,
        ocean_connected_or_isolated: "unknown".to_string(),
    }
}

fn water_mesh_aabb(transform: &Transform) -> OctreeAabb {
    let origin = transform.translation;
    OctreeAabb::new(
        origin,
        Vec3::new(
            origin.x + CHUNK_SIZE_I32 as f32,
            origin.y + CHUNK_SIZE_I32 as f32,
            origin.z + CHUNK_SIZE_I32 as f32,
        ),
    )
}

fn distance_to_aabb_xz(position: Vec3, aabb: OctreeAabb) -> f32 {
    let dx = if position.x < aabb.min.x {
        aabb.min.x - position.x
    } else if position.x > aabb.max.x {
        position.x - aabb.max.x
    } else {
        0.0
    };
    let dz = if position.z < aabb.min.z {
        aabb.min.z - position.z
    } else if position.z > aabb.max.z {
        position.z - aabb.max.z
    } else {
        0.0
    };
    Vec2::new(dx, dz).length()
}

fn aabb_in_camera_view(
    camera_transform: &Transform,
    projection: &Projection,
    aabb: OctreeAabb,
) -> bool {
    let camera_pos = camera_transform.translation;
    if point_in_aabb(camera_pos, aabb) {
        return true;
    }

    let forward = camera_transform.forward().as_vec3();
    let min_dot = match projection {
        Projection::Perspective(_) => -0.05,
        Projection::Orthographic(_) => -0.25,
        Projection::Custom(_) => -0.05,
    };

    for point in aabb_sample_points(aabb) {
        let to_point = point - camera_pos;
        if to_point.length_squared() < 1.0 {
            return true;
        }
        if forward.dot(to_point.normalize()) >= min_dot {
            return true;
        }
    }

    false
}

fn point_in_aabb(point: Vec3, aabb: OctreeAabb) -> bool {
    point.x >= aabb.min.x
        && point.x <= aabb.max.x
        && point.y >= aabb.min.y
        && point.y <= aabb.max.y
        && point.z >= aabb.min.z
        && point.z <= aabb.max.z
}

fn aabb_sample_points(aabb: OctreeAabb) -> [Vec3; 9] {
    let min = aabb.min;
    let max = aabb.max;
    let center = aabb.center();
    [
        center,
        Vec3::new(min.x, min.y, min.z),
        Vec3::new(min.x, min.y, max.z),
        Vec3::new(min.x, max.y, min.z),
        Vec3::new(min.x, max.y, max.z),
        Vec3::new(max.x, min.y, min.z),
        Vec3::new(max.x, min.y, max.z),
        Vec3::new(max.x, max.y, min.z),
        Vec3::new(max.x, max.y, max.z),
    ]
}

fn write_probe_dump(dump: &WaterVisualProbeDump, timestamp: &str) -> std::io::Result<PathBuf> {
    let dir = PathBuf::from("debug");
    fs::create_dir_all(&dir)?;
    let path = dir.join(format!("water-visual-probe-{timestamp}.json"));
    let json = serde_json::to_string_pretty(dump)?;
    fs::write(&path, json)?;
    Ok(path)
}

fn env_flag(name: &str) -> bool {
    std::env::var_os(name).is_some()
}

fn timestamp_utc_compact() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default();
    let days = seconds.div_euclid(86_400);
    let seconds_of_day = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;
    format!("{year:04}{month:02}{day:02}-{hour:02}{minute:02}{second:02}")
}

fn civil_from_days(days_since_unix_epoch: i64) -> (i32, u32, u32) {
    let z = days_since_unix_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if m <= 2 { 1 } else { 0 };
    (year as i32, m as u32, d as u32)
}

impl From<Vec3> for Vec3Dump {
    fn from(value: Vec3) -> Self {
        Self {
            x: value.x,
            y: value.y,
            z: value.z,
        }
    }
}

impl From<IVec3> for IVec3Dump {
    fn from(value: IVec3) -> Self {
        Self {
            x: value.x,
            y: value.y,
            z: value.z,
        }
    }
}
