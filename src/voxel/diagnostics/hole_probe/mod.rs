use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use avian3d::prelude::{Collider, RigidBody, SpatialQuery, SpatialQueryFilter};
use bevy::diagnostic::FrameCount;
use bevy::prelude::*;
use bevy::window::PrimaryWindow;
use bevy_mesh::{Indices, VertexAttributeValues};
use serde::{Deserialize, Serialize};

use crate::camera::controller::PlayerCamera;
use crate::constants::{CHUNK_SIZE_I32, VOXEL_SIZE};
use crate::interaction::TargetedBlock;
use crate::performance::AreaTimingRecorder;
use crate::physics::{ChunkCollider, NeedsCollider, PhysicsLayer};
use crate::player::{Player, classify_player_world_validity};
use crate::voxel::chunk::{ChunkUniformity, LodLevel, MeshDirtyReason};
use crate::voxel::mc_transvoxel::McTransvoxelStats;
use crate::voxel::meshing::{
    ChunkMesh, LodTransitionSnapStats, McTriangleSource, McTriangleSources, MeshMode, MeshSettings,
    TerrainMeshDebug, TerrainMeshSectionStats, WaterMesh,
    empty_chunk_has_surface_nets_boundary_surface,
};
use crate::voxel::plugin::{
    LodSettings, collect_water_shore_lod_guard_chunks, effective_terrain_mesh_lod_for_chunk,
    terrain_lod_distance_xz, terrain_lod_hysteresis,
};
use crate::voxel::skirt::{ChunkFace, NeighborLods};
use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::world::{VoxelSample as BoundaryVoxelSample, VoxelWorld, WorldBounds};

mod classify;
mod mc_oracle;
mod mesh;
mod output;
mod rays;
mod types;
mod visual;

use classify::*;
use mc_oracle::*;
use mesh::*;
use output::*;
use rays::*;
use types::*;
use visual::*;

pub use types::TerrainEntityQuery;

pub struct TerrainHoleProbePlugin;

const TERRAIN_HOLE_PROBE_SCHEMA_VERSION: u32 = 16;

impl Plugin for TerrainHoleProbePlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<TerrainHoleProbeRequests>()
            .add_systems(Update, dump_terrain_hole_probe);
    }
}

#[derive(Clone, Debug)]
pub struct TerrainHoleProbeRequest {
    pub trigger: String,
    pub output_label: Option<String>,
    pub target_voxel_position: IVec3,
    pub player_world_position: Option<Vec3>,
    pub camera_world_position: Option<Vec3>,
    pub camera_direction: Option<Vec3>,
    pub screenshot_path: Option<PathBuf>,
}

#[derive(Resource, Default)]
pub struct TerrainHoleProbeRequests {
    pending: Vec<TerrainHoleProbeRequest>,
}

impl TerrainHoleProbeRequests {
    pub fn push(&mut self, request: TerrainHoleProbeRequest) {
        self.pending.push(request);
    }
}

fn dump_terrain_hole_probe(
    keys: Res<ButtonInput<KeyCode>>,
    mut requests: ResMut<TerrainHoleProbeRequests>,
    world: Res<VoxelWorld>,
    targeted: Res<TargetedBlock>,
    player_query: Query<&GlobalTransform, With<Player>>,
    camera_query: Query<(&GlobalTransform, &Projection), (With<PlayerCamera>, Without<Player>)>,
    window_query: Query<&Window, With<PrimaryWindow>>,
    terrain_entities: TerrainEntityQuery,
    meshes: Res<Assets<Mesh>>,
    spatial_query: Option<SpatialQuery>,
    mesh_settings: Res<MeshSettings>,
    lod_settings: Res<LodSettings>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
    mut probe_notice: ResMut<crate::voxel::terrain_debug::TerrainProbeNotice>,
) {
    // Alt+F10 (moved off Shift+F9: Shift descends the fly camera, nudging the view
    // mid-probe). Alt+F9 is taken by the iso-band overlay, so this uses Alt+F10.
    let alt_held = keys.pressed(KeyCode::AltLeft) || keys.pressed(KeyCode::AltRight);
    let keyboard_requested = alt_held && keys.just_pressed(KeyCode::F10);
    let scripted_request = (!keyboard_requested)
        .then(|| requests.pending.pop())
        .flatten();
    if !keyboard_requested && scripted_request.is_none() {
        return;
    }
    let request = scripted_request.as_ref();

    let mut spatial_query = spatial_query;
    if let Some(spatial_query) = spatial_query.as_mut() {
        spatial_query.update_pipeline();
    } else if keyboard_requested {
        warn!("Terrain hole probe skipped: physics SpatialQuery resource is not available");
        return;
    } else {
        warn!(
            "Terrain hole probe continuing without physics SpatialQuery; down-ray hits will be absent"
        );
    }

    let player_pos = player_query
        .single()
        .map(|transform| transform.translation())
        .or_else(|_| {
            camera_query
                .single()
                .map(|(transform, _)| transform.translation())
        })
        .unwrap_or(Vec3::ZERO);
    let player_pos = request
        .and_then(|request| request.player_world_position)
        .unwrap_or(player_pos);
    let camera_transform = camera_query.single().ok();
    let camera_pos = request
        .and_then(|request| request.camera_world_position)
        .or_else(|| camera_transform.map(|(transform, _)| transform.translation()));
    let camera_dir = request
        .and_then(|request| request.camera_direction)
        .map(Vec3::normalize_or_zero)
        .or_else(|| camera_transform.map(|(transform, _)| transform.forward().as_vec3()));
    let (scripted_right, scripted_up) = camera_dir
        .filter(|_| request.is_some())
        .map(camera_basis_from_forward)
        .unwrap_or((Vec3::ZERO, Vec3::ZERO));
    let camera_right = if request.is_some() {
        Some(scripted_right)
    } else {
        camera_transform.map(|(transform, _)| transform.right().as_vec3())
    };
    let camera_up = if request.is_some() {
        Some(scripted_up)
    } else {
        camera_transform.map(|(transform, _)| transform.up().as_vec3())
    };
    let explicit_visual_image_path = request.and_then(|request| request.screenshot_path.clone());
    let visual_image_path = explicit_visual_image_path
        .clone()
        .or_else(|| latest_matching_terrain_debug_screenshot(camera_pos, camera_dir));
    if explicit_visual_image_path.is_none() {
        if let Some(path) = visual_image_path.as_ref() {
            info!(
                "Terrain hole probe using latest matching terrain debug screenshot {}",
                path.display()
            );
        }
    }
    let visual_image = visual_image_path
        .as_deref()
        .and_then(load_probe_image)
        .inspect(|image| {
            debug!(
                "Terrain hole probe loaded screenshot {} ({}x{}) for visual samples",
                image.path.display(),
                image.width,
                image.height
            );
        });
    let window_size = window_query
        .single()
        .ok()
        .map(|window| Vec2::new(window.resolution.width(), window.resolution.height()));
    let visual_context = camera_pos
        .zip(camera_dir)
        .zip(camera_right)
        .zip(camera_up)
        .and_then(|(((pos, forward), right), up)| {
            let projection = camera_transform.map(|(_, projection)| projection)?;
            Some(VisualProbeContext {
                camera_pos: pos,
                camera_forward: forward.normalize_or_zero(),
                camera_right: right.normalize_or_zero(),
                camera_up: up.normalize_or_zero(),
                projection,
                window_size,
                image: visual_image.as_ref(),
                screenshot_path: visual_image_path.as_ref(),
            })
        });
    let target_pos = request
        .map(|request| request.target_voxel_position)
        .or(targeted.position)
        .unwrap_or_else(|| {
            IVec3::new(
                player_pos.x.floor() as i32,
                (player_pos.y - 1.0).floor() as i32,
                player_pos.z.floor() as i32,
            )
        });
    let target_chunk = VoxelWorld::world_to_chunk(target_pos);
    let target_local = VoxelWorld::world_to_local(target_pos);
    let target_voxel = world.sample_voxel_for_collision(target_pos).voxel();
    let water_lod_guard_chunks = collect_water_shore_lod_guard_chunks(&world);

    let columns = sample_columns(&world, target_pos, 2);
    let player_down_ray_origin = player_pos + Vec3::Y * 4.0;
    let target_down_ray_origin = target_pos.as_vec3() + Vec3::new(0.5, 8.0, 0.5);
    let physics = if let Some(spatial_query) = spatial_query.as_ref() {
        PhysicsProbe {
            player_down_ray: cast_down_ray(
                spatial_query,
                &terrain_entities,
                player_down_ray_origin,
                160.0,
            ),
            target_down_ray: cast_down_ray(
                spatial_query,
                &terrain_entities,
                target_down_ray_origin,
                160.0,
            ),
        }
    } else {
        PhysicsProbe {
            player_down_ray: missing_down_ray_probe(player_down_ray_origin, 160.0),
            target_down_ray: missing_down_ray_probe(target_down_ray_origin, 160.0),
        }
    };
    let expected_surface_y = expected_surface_y(&columns);
    let render_mesh_ray_hits = sample_render_mesh_rays(
        &world,
        &terrain_entities,
        &meshes,
        target_chunk,
        target_pos,
        expected_surface_y,
    );
    let render_mesh_ray_grid = sample_render_mesh_ray_grid(
        &world,
        &terrain_entities,
        &meshes,
        target_chunk,
        target_pos,
        camera_pos,
        camera_dir,
        camera_right,
        camera_up,
        &mesh_settings,
        &lod_settings,
        &water_lod_guard_chunks,
    );
    log_camera_height_grid_summary(&render_mesh_ray_grid);
    let camera_ray = match (camera_pos, camera_dir) {
        (Some(camera_pos), Some(camera_dir)) => Some(sample_camera_ray(
            &world,
            &terrain_entities,
            &meshes,
            camera_pos,
            camera_dir,
            512.0,
            visual_context.as_ref(),
        )),
        _ => None,
    };
    if let Some(gap) = camera_ray
        .as_ref()
        .and_then(|ray| ray.see_through_gap.as_ref())
    {
        warn!(
            "Camera-ray probe: solid-before-render candidate at {:.1}m; \
             nearest front render surface at {:?}, distance delta {:.1}m \
             (may be hole or depressed surface)",
            gap.voxel_surface_distance, gap.first_front_render_hit_distance, gap.gap_length,
        );
    }
    let camera_ray_fan = match (camera_pos, camera_dir, camera_right, camera_up) {
        (Some(pos), Some(forward), Some(right), Some(up)) => Some(sample_camera_ray_fan(
            &world,
            &terrain_entities,
            &meshes,
            pos,
            forward,
            right,
            up,
            512.0,
            &mesh_settings,
            &lod_settings,
            &water_lod_guard_chunks,
            visual_context.as_ref(),
        )),
        _ => None,
    };
    if let Some(fan) = &camera_ray_fan {
        if fan.rays_with_gap > 0 {
            warn!(
                "Camera-ray fan: {} of {} rays found solid-before-render candidates in the {} degree cone \
                 (may be hole or depressed surface)",
                fan.rays_with_gap, fan.rays_total, fan.half_angle_degrees,
            );
            let terrace_gaps: Vec<&FanGap> = fan
                .gaps
                .iter()
                .filter(|gap| {
                    gap.seam_terrace.as_ref().is_some_and(|terrace| {
                        terrace.classification == SeamTerraceClassification::PossibleTerrace
                    })
                })
                .collect();
            if !terrace_gaps.is_empty() {
                let max_delta = terrace_gaps
                    .iter()
                    .filter_map(|gap| {
                        gap.seam_terrace
                            .as_ref()
                            .and_then(|terrace| terrace.worst_abs_height_delta)
                    })
                    .fold(0.0_f32, f32::max);
                info!(
                    "Camera-ray fan: {} gap rays report possible seam terraces; max paired fine/coarse iso height delta {:.2} voxels",
                    terrace_gaps.len(),
                    max_delta,
                );
            }
        } else {
            info!(
                "Camera-ray fan: 0 of {} rays found solid-before-render candidates in the {} degree cone \
                 around the crosshair.",
                fan.rays_total, fan.half_angle_degrees,
            );
        }
    }
    let chunks = sample_neighbor_chunks(
        &world,
        target_chunk,
        target_local,
        &terrain_entities,
        camera_pos,
        &mesh_settings,
        &lod_settings,
        &water_lod_guard_chunks,
    );
    let active_seam_faces = sample_active_seam_faces(
        &world,
        &terrain_entities,
        &meshes,
        target_chunk,
        camera_ray_fan.as_ref(),
        visual_context.as_ref(),
        camera_pos,
        &mesh_settings,
        &lod_settings,
        &water_lod_guard_chunks,
    );
    let render_entity_checklist = render_entity_checklist_for_probe(
        &world,
        &terrain_entities,
        &meshes,
        target_chunk,
        camera_ray_fan.as_ref(),
        &active_seam_faces,
        camera_pos,
        &mesh_settings,
        &lod_settings,
        &water_lod_guard_chunks,
    );
    let normalized_summary = normalized_probe_summary(
        camera_ray_fan.as_ref(),
        &active_seam_faces,
        &render_entity_checklist,
    );
    let screenshot_overlay_points = screenshot_overlay_points(
        camera_ray.as_ref(),
        camera_ray_fan.as_ref(),
        &active_seam_faces,
    );
    let classification = classify_probe(
        target_pos,
        target_local,
        target_voxel,
        &columns,
        &physics,
        &render_mesh_ray_hits,
        &chunks,
        &world,
    );

    timing.record_count(
        frame.0,
        "Terrain Hole Probe: World Data Hole",
        classification.world_data_hole as u8 as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Hole Probe: Mesh Missing",
        classification.mesh_missing as u8 as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Hole Probe: Collider Missing",
        classification.collider_missing as u8 as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Hole Probe: Collider Pending",
        classification.collider_pending as u8 as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Hole Probe: Collider Failed",
        classification.collider_failed as u8 as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Hole Probe: Visibility Hidden",
        classification.visibility_hidden as u8 as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Surface Coverage Mismatch",
        (classification.mesh_surface_mismatch || classification.collider_surface_mismatch) as u8
            as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Collider Surface Mismatch",
        classification.collider_surface_mismatch as u8 as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Mesh Surface Mismatch",
        classification.mesh_surface_mismatch as u8 as f64,
    );

    let timestamp = timestamp_utc_compact();
    let trigger = request
        .map(|request| request.trigger.clone())
        .unwrap_or_else(|| "Alt+F10".to_string());
    let dump = TerrainHoleProbeDump {
        schema_version: TERRAIN_HOLE_PROBE_SCHEMA_VERSION,
        timestamp_utc: timestamp.clone(),
        trigger,
        player_world_position: player_pos.into(),
        camera_world_position: camera_pos.map(Into::into),
        target_voxel_position: target_pos.into(),
        target_voxel_type: target_voxel.map(voxel_name),
        target_chunk_position: target_chunk.into(),
        target_local_voxel_position: target_local.into(),
        world_bounds: world_bounds_probe(world.bounds()),
        player_validity: playable_validity_probe(&world, player_pos),
        target_validity: playable_validity_probe(
            &world,
            Vec3::new(
                target_pos.x as f32 + 0.5,
                target_pos.y as f32 + 1.0,
                target_pos.z as f32 + 0.5,
            ),
        ),
        player_boundary_sample: boundary_sample_probe(
            &world,
            IVec3::new(
                player_pos.x.floor() as i32,
                player_pos.y.floor() as i32,
                player_pos.z.floor() as i32,
            ),
        ),
        target_boundary_sample: boundary_sample_probe(&world, target_pos),
        classification,
        columns,
        physics,
        render_mesh_ray_hits,
        render_mesh_ray_grid,
        camera_ray,
        camera_ray_fan,
        normalized_summary,
        active_seam_faces,
        render_entity_checklist,
        screenshot_overlay_points,
        chunks,
    };

    let output_label = request.and_then(|request| request.output_label.as_deref());
    match write_probe_dump(&dump, &timestamp, output_label) {
        Ok(path) => {
            info!("Terrain hole probe written to {}", path.display());
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.display().to_string());
            probe_notice.notify(name);
        }
        Err(err) => error!("Failed to write terrain hole probe: {err}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lod_mesh_status_reports_current_when_lod_tags_match() {
        assert_eq!(lod_mesh_status(Some(false), false), LodMeshStatus::Current);
        assert_eq!(lod_mesh_status(Some(false), true), LodMeshStatus::Current);
    }

    #[test]
    fn lod_mesh_status_separates_pending_remesh_from_stale_mesh() {
        assert_eq!(
            lod_mesh_status(Some(true), true),
            LodMeshStatus::RemeshPending
        );
        assert_eq!(lod_mesh_status(Some(true), false), LodMeshStatus::Stale);
    }

    #[test]
    fn lod_mesh_status_reports_missing_debug_provenance() {
        assert_eq!(
            lod_mesh_status(None, false),
            LodMeshStatus::DebugUnavailable
        );
        assert_eq!(lod_mesh_status(None, true), LodMeshStatus::DebugUnavailable);
    }

    #[test]
    fn promoted_effective_mesh_lod_is_not_reported_stale() {
        let debug = TerrainMeshDebug {
            logical_lod_at_mesh: LodLevel::Lod1,
            effective_lod_at_mesh: LodLevel::Lod0,
            target_mode_at_mesh: MeshMode::SurfaceNets,
            neighbor_lods_at_mesh: NeighborLods::default(),
            lod_delta_gt_one_face_mask: 0,
            missing_boundary_neighbors_at_mesh: 0,
            empty_surface_cap_at_mesh: false,
            generated_frame: 1,
            lod_transition_snap_stats: LodTransitionSnapStats::default(),
            mesh_section_stats: TerrainMeshSectionStats::default(),
            mc_transvoxel_stats: None,
        };

        let mismatch =
            mesh_lod_mismatch_from_debug(Some(LodLevel::Lod1), Some(LodLevel::Lod0), Some(&debug));

        assert_eq!(mismatch, Some(false));
        assert_eq!(lod_mesh_status(mismatch, false), LodMeshStatus::Current);
    }

    #[test]
    fn stale_or_pending_status_filter_excludes_debug_unavailable() {
        assert!(!is_stale_or_pending_mesh_status(LodMeshStatus::Current));
        assert!(is_stale_or_pending_mesh_status(LodMeshStatus::Stale));
        assert!(is_stale_or_pending_mesh_status(
            LodMeshStatus::RemeshPending
        ));
        assert!(!is_stale_or_pending_mesh_status(
            LodMeshStatus::DebugUnavailable
        ));
    }

    #[test]
    fn scripted_camera_basis_is_orthonormal() {
        let forward = Vec3::new(-0.97716266, -0.02399765, -0.21113348);

        let (right, up) = camera_basis_from_forward(forward);

        assert!((right.length() - 1.0).abs() < 1.0e-5);
        assert!((up.length() - 1.0).abs() < 1.0e-5);
        assert!(right.dot(forward).abs() < 1.0e-5);
        assert!(up.dot(forward).abs() < 1.0e-5);
        assert!(right.dot(up).abs() < 1.0e-5);
    }

    #[test]
    fn probe_output_label_is_filename_safe() {
        assert_eq!(
            sanitize_probe_label("mctx static/mountain hole!"),
            "mctx-staticmountain-hole"
        );
    }

    #[test]
    fn ray_triangle_hit_reports_front_and_backface_hits() {
        let origin = Vec3::new(0.25, 0.25, 1.0);
        let dir = Vec3::NEG_Z;
        let p0 = Vec3::new(0.0, 0.0, 0.0);
        let p1 = Vec3::new(1.0, 0.0, 0.0);
        let p2 = Vec3::new(0.0, 1.0, 0.0);

        let front = ray_triangle_hit(origin, dir, p0, p1, p2).unwrap();
        let back = ray_triangle_hit(origin, dir, p0, p2, p1).unwrap();

        assert!((front.0 - 1.0).abs() < 1.0e-5);
        assert!(front.1);
        assert!((back.0 - 1.0).abs() < 1.0e-5);
        assert!(!back.1);
    }

    #[test]
    fn camera_gap_classifies_backface_when_front_hit_is_late() {
        let gap = Some(SeeThroughGap {
            voxel_surface_distance: 10.0,
            first_front_render_hit_distance: None,
            gap_length: 10.0,
            note: "test".to_string(),
        });
        let backface = CameraRayHit {
            distance: 10.25,
            point: Vec3::ZERO.into(),
            front_face: false,
            geometric_normal: Vec3::Z.into(),
            normal_dot_ray: 1.0,
            vertex_normal: Some(Vec3::Z.into()),
            material_weights: Some([1.0, 0.0, 0.0, 0.0]),
            chunk_position: None,
            entity: "Entity(0)".to_string(),
            mesh_section: MeshTriangleSectionProbe::MainSurface,
            triangle_start_index: 0,
            vertices: None,
            source: None,
        };

        assert_eq!(
            classify_camera_gap(
                &gap,
                &Some(backface.clone()),
                &None,
                &Some(backface),
                None,
                None,
                None,
                &CameraRayVisualSamples::default()
            ),
            GapClassification::BackfaceOrWinding
        );
    }

    #[test]
    fn camera_gap_does_not_classify_far_backface_as_winding() {
        let gap = Some(SeeThroughGap {
            voxel_surface_distance: 227.25,
            first_front_render_hit_distance: None,
            gap_length: 284.75,
            note: "test".to_string(),
        });
        let far_backface = CameraRayHit {
            distance: 265.58856,
            point: Vec3::ZERO.into(),
            front_face: false,
            geometric_normal: Vec3::Y.into(),
            normal_dot_ray: 0.27,
            vertex_normal: Some(Vec3::Y.into()),
            material_weights: Some([0.0, 0.0, 0.78, 0.22]),
            chunk_position: Some(IVec3::new(4, 3, 4).into()),
            entity: "Entity(0)".to_string(),
            mesh_section: MeshTriangleSectionProbe::Unknown,
            triangle_start_index: 51,
            vertices: None,
            source: None,
        };

        assert_eq!(
            classify_camera_gap(
                &gap,
                &Some(far_backface.clone()),
                &None,
                &Some(far_backface),
                Some(228.0654),
                None,
                None,
                &CameraRayVisualSamples::default(),
            ),
            GapClassification::Unknown
        );
    }

    #[test]
    fn screenshot_pixel_classifier_detects_dark_and_lit_pixels() {
        assert_eq!(
            classify_visual_pixel(RgbaProbe {
                r: 2,
                g: 2,
                b: 2,
                a: 255,
                luminance: pixel_luminance(2, 2, 2),
            }),
            VisualPixelClassification::DarkOrMissing
        );
        assert_eq!(
            classify_visual_pixel(RgbaProbe {
                r: 180,
                g: 160,
                b: 120,
                a: 255,
                luminance: pixel_luminance(180, 160, 120),
            }),
            VisualPixelClassification::LitOrNonDark
        );
    }

    #[test]
    fn screenshot_pixel_sampler_reads_synthetic_fixture() {
        let image = ProbeImage {
            path: PathBuf::from("synthetic.png"),
            width: 2,
            height: 1,
            pixels: vec![0, 0, 0, 255, 200, 180, 120, 255],
        };

        let dark = sample_probe_image(&image, Vec2::new(0.0, 0.0)).unwrap();
        let lit = sample_probe_image(&image, Vec2::new(1.0, 0.0)).unwrap();

        assert_eq!(
            classify_visual_pixel(dark),
            VisualPixelClassification::DarkOrMissing
        );
        assert_eq!(
            classify_visual_pixel(lit),
            VisualPixelClassification::LitOrNonDark
        );
    }

    #[test]
    fn screenshot_pixel_window_reports_nearby_bright_pixels() {
        let image = ProbeImage {
            path: PathBuf::from("synthetic.png"),
            width: 3,
            height: 3,
            pixels: vec![
                180, 180, 180, 255, 180, 180, 180, 255, 180, 180, 180, 255, 180, 180, 180, 255,
                180, 180, 180, 255, 255, 255, 255, 255, 180, 180, 180, 255, 180, 180, 180, 255,
                180, 180, 180, 255,
            ],
        };

        let window = sample_probe_image_window(&image, Vec2::new(1.0, 1.0), 1).unwrap();

        assert_eq!(window.sampled_pixels, 9);
        assert_eq!(window.bright_pixels, 1);
        assert_eq!(window.lit_or_non_dark_pixels, 9);
        assert!(window.max_luminance > 0.99);
    }

    #[test]
    fn latest_matching_terrain_debug_screenshot_uses_recent_camera_match() {
        let temp = tempfile::tempdir().unwrap();
        let sidecar_path = temp.path().join("wireframe-test.json");
        let png_path = temp.path().join("wireframe-test.png");
        fs::write(
            &sidecar_path,
            r#"{"camera_pos":[1.0,2.0,3.0],"camera_rot":[0.0,0.0,0.0,1.0]}"#,
        )
        .unwrap();
        fs::write(&png_path, [0_u8]).unwrap();

        assert_eq!(
            latest_matching_terrain_debug_screenshot_in_dir(
                temp.path(),
                Some(Vec3::new(1.2, 2.0, 3.0)),
                Some(Vec3::NEG_Z),
            ),
            Some(png_path)
        );
        assert!(
            latest_matching_terrain_debug_screenshot_in_dir(
                temp.path(),
                Some(Vec3::new(10.0, 2.0, 3.0)),
                Some(Vec3::NEG_Z),
            )
            .is_none()
        );
        assert!(
            latest_matching_terrain_debug_screenshot_in_dir(
                temp.path(),
                Some(Vec3::new(1.2, 2.0, 3.0)),
                Some(Vec3::Z),
            )
            .is_none()
        );
        assert!(
            latest_matching_terrain_debug_screenshot_in_dir(temp.path(), None, Some(Vec3::NEG_Z))
                .is_none()
        );
        assert!(
            latest_matching_terrain_debug_screenshot_in_dir(
                temp.path(),
                Some(Vec3::new(1.2, 2.0, 3.0)),
                None
            )
            .is_none()
        );
    }

    #[test]
    fn ray_to_emitted_triangle_residual_reports_hit_and_miss() {
        let vertices = [
            Vec3::new(0.0, 0.0, 5.0),
            Vec3::new(1.0, 0.0, 5.0),
            Vec3::new(0.0, 1.0, 5.0),
        ];

        let hit = emitted_triangle_probe(0, Vec3::new(0.25, 0.25, 0.0), Vec3::Z, vertices);
        let miss = emitted_triangle_probe(0, Vec3::new(3.0, 3.0, 0.0), Vec3::Z, vertices);

        assert!((hit.ray_hit_distance.unwrap() - 5.0).abs() < 1.0e-5);
        assert!(hit.closest_ray_distance < 0.75);
        assert!(miss.ray_hit_distance.is_none());
        assert!(miss.closest_ray_distance > 2.0);
    }

    #[test]
    fn render_hit_source_cell_matches_expected_mc_cell() {
        let cell = McCellOracleProbe {
            chunk_position: IVec3::new(1, 2, 3).into(),
            effective_lod_at_mesh: "Lod1".to_string(),
            neighbor_lods_at_mesh: NeighborLodsProbe {
                neg_x: None,
                pos_x: None,
                neg_y: None,
                pos_y: None,
                neg_z: None,
                pos_z: None,
            },
            cell: UVec3::new(4, 5, 6).into(),
            case_index: 23,
            class_index: 3,
            expected_regular_triangle_count: 2,
            actual_regular_triangle_count: Some(2),
            boundary_faces: Vec::new(),
            skipped_regular_faces: Vec::new(),
            transition_owner_faces: Vec::new(),
            transition_cells: Vec::new(),
            emitted_regular_triangles: Vec::new(),
            emitted_regular_triangles_ray_hit_count: 0,
            nearest_emitted_regular_triangle_ray_hit_distance: None,
            closest_emitted_regular_triangle_ray_distance: None,
            source_chunk_skipped_lod_delta_gt_one: Some(0),
        };
        let source = McTriangleSourceProbe::Regular {
            chunk_position: IVec3::new(1, 2, 3).into(),
            lod: "Lod1".to_string(),
            cell: UVec3::new(4, 5, 6).into(),
            case_index: 23,
            class_index: 3,
        };

        assert!(mc_source_matches_cell_probe(&source, &cell));
    }

    fn classification_test_hit(distance: f32) -> CameraRayHit {
        CameraRayHit {
            distance,
            point: Vec3::new(0.0, 0.0, distance).into(),
            front_face: true,
            geometric_normal: Vec3::Y.into(),
            normal_dot_ray: 0.0,
            vertex_normal: Some(Vec3::Y.into()),
            material_weights: Some([1.0, 0.0, 0.0, 0.0]),
            chunk_position: Some(IVec3::ZERO.into()),
            entity: "test".to_string(),
            mesh_section: MeshTriangleSectionProbe::Unknown,
            triangle_start_index: 0,
            vertices: None,
            source: None,
        }
    }

    fn classification_test_cell() -> McCellOracleProbe {
        McCellOracleProbe {
            chunk_position: IVec3::new(11, 1, 8).into(),
            effective_lod_at_mesh: "Lod0".to_string(),
            neighbor_lods_at_mesh: NeighborLodsProbe {
                neg_x: Some("Lod0".to_string()),
                pos_x: Some("Lod0".to_string()),
                neg_y: Some("Lod0".to_string()),
                pos_y: Some("Lod0".to_string()),
                neg_z: Some("Lod0".to_string()),
                pos_z: Some("Lod0".to_string()),
            },
            cell: UVec3::new(15, 4, 5).into(),
            case_index: 3,
            class_index: 3,
            expected_regular_triangle_count: 2,
            actual_regular_triangle_count: Some(2),
            boundary_faces: vec!["pos_x".to_string()],
            skipped_regular_faces: Vec::new(),
            transition_owner_faces: Vec::new(),
            transition_cells: Vec::new(),
            emitted_regular_triangles: Vec::new(),
            emitted_regular_triangles_ray_hit_count: 0,
            nearest_emitted_regular_triangle_ray_hit_distance: None,
            closest_emitted_regular_triangle_ray_distance: Some(0.13819484),
            source_chunk_skipped_lod_delta_gt_one: Some(0),
        }
    }

    fn visual_samples_with_mesher_iso(
        classification: VisualPixelClassification,
    ) -> CameraRayVisualSamples {
        CameraRayVisualSamples {
            mesher_iso: Some(VisualPointProbe {
                world_point: Vec3::new(190.2826, 19.445261, 132.31314).into(),
                screen_position: Some(Vec2Dump {
                    x: 845.9431,
                    y: 769.8731,
                }),
                screenshot_path: Some("synthetic.png".to_string()),
                pixel: Some(RgbaProbe {
                    r: 52,
                    g: 69,
                    b: 14,
                    a: 255,
                    luminance: pixel_luminance(52, 69, 14),
                }),
                pixel_window: None,
                nearby_pixel_window: None,
                classification,
                note: "test visual sample".to_string(),
            }),
            ..Default::default()
        }
    }

    fn possible_seam_terrace_probe() -> SeamTerraceProbe {
        SeamTerraceProbe {
            sample_point: Vec3::new(96.0, 32.0, 96.0).into(),
            threshold_voxels: 0.5,
            threshold_world: 0.5,
            pairs: vec![SeamTerracePairProbe {
                face: "pos_x".to_string(),
                source_chunk: IVec3::new(5, 2, 6).into(),
                neighbor_chunk: IVec3::new(6, 2, 6).into(),
                source_lod: "Lod0".to_string(),
                neighbor_lod: "Lod1".to_string(),
                fine_chunk: IVec3::new(5, 2, 6).into(),
                coarse_chunk: IVec3::new(6, 2, 6).into(),
                fine_lod: "Lod0".to_string(),
                coarse_lod: "Lod1".to_string(),
                fine_sample_point: Vec3::new(95.75, 32.0, 96.0).into(),
                coarse_sample_point: Vec3::new(96.25, 32.0, 96.0).into(),
                fine_iso_height: Some(31.0),
                coarse_iso_height: Some(32.25),
                signed_height_delta_coarse_minus_fine: Some(1.25),
                abs_height_delta: Some(1.25),
                source_chunk_skipped_lod_delta_gt_one: Some(0),
                neighbor_chunk_skipped_lod_delta_gt_one: Some(0),
            }],
            worst_abs_height_delta: Some(1.25),
            classification: SeamTerraceClassification::PossibleTerrace,
            note: "test seam terrace".to_string(),
        }
    }

    #[test]
    fn lit_mesher_iso_visual_overrides_case3_triangle_miss_classification() {
        let gap = SeeThroughGap {
            voxel_surface_distance: 95.5,
            first_front_render_hit_distance: Some(102.165565),
            gap_length: 6.6655655,
            note: "test".to_string(),
        };
        let hit = classification_test_hit(102.165565);
        let cell = classification_test_cell();
        let visual_samples =
            visual_samples_with_mesher_iso(VisualPixelClassification::LitOrNonDark);

        assert_eq!(
            classify_camera_gap(
                &Some(gap),
                &Some(hit.clone()),
                &Some(hit),
                &None,
                Some(98.228195),
                Some(&cell),
                None,
                &visual_samples,
            ),
            GapClassification::RawOccupancyVsMesherIsoFalsePositive
        );
    }

    #[test]
    fn possible_seam_terrace_is_distinct_from_raw_occupancy_false_positive() {
        let gap = SeeThroughGap {
            voxel_surface_distance: 95.5,
            first_front_render_hit_distance: Some(98.25),
            gap_length: 2.75,
            note: "test".to_string(),
        };
        let hit = classification_test_hit(98.25);
        let cell = classification_test_cell();
        let visual_samples =
            visual_samples_with_mesher_iso(VisualPixelClassification::LitOrNonDark);
        let terrace = possible_seam_terrace_probe();

        assert_eq!(
            classify_camera_gap(
                &Some(gap),
                &Some(hit.clone()),
                &Some(hit),
                &None,
                Some(98.0),
                Some(&cell),
                Some(&terrace),
                &visual_samples,
            ),
            GapClassification::SeamTerraceOrLodSurfaceDisplacement
        );
    }

    #[test]
    fn dark_mesher_iso_keeps_case3_triangle_miss_as_vertex_decode_suspect() {
        let gap = SeeThroughGap {
            voxel_surface_distance: 95.5,
            first_front_render_hit_distance: Some(102.165565),
            gap_length: 6.6655655,
            note: "test".to_string(),
        };
        let hit = classification_test_hit(102.165565);
        let cell = classification_test_cell();
        let visual_samples =
            visual_samples_with_mesher_iso(VisualPixelClassification::DarkOrMissing);

        assert_eq!(
            classify_camera_gap(
                &Some(gap),
                &Some(hit.clone()),
                &Some(hit),
                &None,
                Some(98.228195),
                Some(&cell),
                None,
                &visual_samples,
            ),
            GapClassification::VertexPositionOrTableDecodeError
        );
    }

    #[test]
    fn missing_regular_geometry_requires_known_zero_source_count() {
        let gap = SeeThroughGap {
            voxel_surface_distance: 95.5,
            first_front_render_hit_distance: None,
            gap_length: 6.6655655,
            note: "test".to_string(),
        };
        let mut cell = classification_test_cell();
        cell.actual_regular_triangle_count = None;

        assert_eq!(
            classify_camera_gap(
                &Some(gap),
                &None,
                &None,
                &None,
                None,
                Some(&cell),
                None,
                &CameraRayVisualSamples::default(),
            ),
            GapClassification::Unknown
        );
    }

    #[test]
    fn known_zero_regular_source_count_classifies_missing_geometry() {
        let gap = SeeThroughGap {
            voxel_surface_distance: 95.5,
            first_front_render_hit_distance: None,
            gap_length: 6.6655655,
            note: "test".to_string(),
        };
        let mut cell = classification_test_cell();
        cell.actual_regular_triangle_count = Some(0);

        assert_eq!(
            classify_camera_gap(
                &Some(gap),
                &None,
                &None,
                &None,
                None,
                Some(&cell),
                None,
                &CameraRayVisualSamples::default(),
            ),
            GapClassification::MissingRegularMcGeometry
        );
    }

    #[cfg(feature = "mc_transvoxel")]
    #[test]
    fn mesher_iso_oracle_matches_flat_plane_sdf() {
        let padded = 4usize;
        let mut values = vec![0.0_f32; padded * padded * padded];
        for z in 0..padded {
            for y in 0..padded {
                for x in 0..padded {
                    values[x + y * padded + z * padded * padded] = z as f32 - 2.0;
                }
            }
        }

        let (distance, point) = first_mesher_iso_in_sdf_grid(
            Vec3::new(0.5, 0.5, -0.5),
            Vec3::Z,
            4.0,
            Vec3::ZERO,
            padded,
            &values,
            1,
        )
        .expect("ray should cross the flat SDF plane");

        assert!((distance - 1.5).abs() < 1.0e-5);
        assert!((point.z - 1.0).abs() < 1.0e-5);
    }

    #[cfg(feature = "mc_transvoxel")]
    #[test]
    fn seam_terrace_vertical_iso_height_matches_flat_plane_sdf() {
        let padded = 4usize;
        let mut values = vec![0.0_f32; padded * padded * padded];
        for z in 0..padded {
            for y in 0..padded {
                for x in 0..padded {
                    values[x + y * padded + z * padded * padded] = y as f32 - 2.0;
                }
            }
        }
        let grid = McSdfGridProbe {
            chunk_position: IVec3::ZERO,
            lod: LodLevel::Lod0,
            neighbor_lods: NeighborLods::default(),
            padded,
            values,
            step: 1,
            source_chunk_skipped_lod_delta_gt_one: Some(0),
        };

        let height = highest_vertical_iso_height_in_grid(&grid, 0.5, 0.5)
            .expect("vertical probe should cross the flat SDF plane");

        assert!((height - 1.0).abs() < 1.0e-5);
    }

    #[cfg(feature = "mc_transvoxel")]
    #[test]
    fn seam_terrace_vertical_iso_height_samples_upper_padded_boundary() {
        let padded = 4usize;
        let mut values = vec![0.0_f32; padded * padded * padded];
        for z in 0..padded {
            for y in 0..padded {
                for x in 0..padded {
                    values[x + y * padded + z * padded * padded] = y as f32 - 2.0;
                }
            }
        }
        let grid = McSdfGridProbe {
            chunk_position: IVec3::ZERO,
            lod: LodLevel::Lod0,
            neighbor_lods: NeighborLods::default(),
            padded,
            values,
            step: 1,
            source_chunk_skipped_lod_delta_gt_one: Some(0),
        };

        let height = highest_vertical_iso_height_in_grid(&grid, 2.0, 0.5)
            .expect("vertical probe should sample the upper padded X boundary");

        assert!((height - 1.0).abs() < 1.0e-5);
    }

    #[cfg(feature = "mc_transvoxel")]
    #[test]
    fn seam_face_sample_point_covers_y_face_as_2d_grid() {
        let point = seam_face_sample_point(Vec3::ZERO, ChunkFace::PosY, 0.25, 0.75);

        assert!((point.x - CHUNK_SIZE_I32 as f32 * 0.25).abs() < 1.0e-5);
        assert!((point.y - CHUNK_SIZE_I32 as f32).abs() < 1.0e-5);
        assert!((point.z - CHUNK_SIZE_I32 as f32 * 0.75).abs() < 1.0e-5);
    }

    #[cfg(feature = "mc_transvoxel")]
    #[test]
    fn face_normal_iso_offset_matches_flat_x_plane_sdf() {
        let padded = 6usize;
        let mut values = vec![0.0_f32; padded * padded * padded];
        for z in 0..padded {
            for y in 0..padded {
                for x in 0..padded {
                    values[x + y * padded + z * padded * padded] = x as f32 - 3.0;
                }
            }
        }
        let grid = McSdfGridProbe {
            chunk_position: IVec3::ZERO,
            lod: LodLevel::Lod0,
            neighbor_lods: NeighborLods::default(),
            padded,
            values,
            step: 1,
            source_chunk_skipped_lod_delta_gt_one: Some(0),
        };

        let offset =
            nearest_face_normal_iso_offset_in_grid(&grid, Vec3::new(2.0, 1.0, 1.0), Vec3::X)
                .expect("face-normal probe should cross the flat SDF plane");

        assert!((offset - 0.0).abs() < 1.0e-5);
    }

    #[cfg(feature = "mc_transvoxel")]
    #[test]
    fn split_boundary_edges_cover_long_opposite_edge() {
        let edges = vec![
            BoundaryEdgeAccum {
                source: None,
                start: Vec3::ZERO,
                end: Vec3::new(2.0, 0.0, 0.0),
                length: 2.0,
                transition: false,
            },
            BoundaryEdgeAccum {
                source: None,
                start: Vec3::ZERO,
                end: Vec3::new(1.0, 0.0, 0.0),
                length: 1.0,
                transition: true,
            },
            BoundaryEdgeAccum {
                source: None,
                start: Vec3::new(1.0, 0.0, 0.0),
                end: Vec3::new(2.0, 0.0, 0.0),
                length: 1.0,
                transition: true,
            },
        ];

        assert!(edge_has_opposite_side_coverage(&edges[0], &edges));
    }

    #[cfg(feature = "mc_transvoxel")]
    #[test]
    fn same_chunk_duplicate_boundary_edge_counts_as_covered() {
        let edges = vec![
            BoundaryEdgeAccum {
                source: None,
                start: Vec3::ZERO,
                end: Vec3::new(1.0, 0.0, 0.0),
                length: 1.0,
                transition: false,
            },
            BoundaryEdgeAccum {
                source: None,
                start: Vec3::new(1.0, 0.0, 0.0),
                end: Vec3::ZERO,
                length: 1.0,
                transition: true,
            },
        ];

        assert!(edge_has_opposite_side_coverage(&edges[0], &edges));
    }

    #[cfg(feature = "mc_transvoxel")]
    #[test]
    fn missing_split_boundary_edge_half_remains_unmatched() {
        let edges = vec![
            BoundaryEdgeAccum {
                source: None,
                start: Vec3::ZERO,
                end: Vec3::new(2.0, 0.0, 0.0),
                length: 2.0,
                transition: false,
            },
            BoundaryEdgeAccum {
                source: None,
                start: Vec3::ZERO,
                end: Vec3::new(1.0, 0.0, 0.0),
                length: 1.0,
                transition: true,
            },
        ];

        assert!(!edge_has_opposite_side_coverage(&edges[0], &edges));
    }

    #[cfg(feature = "mc_transvoxel")]
    #[test]
    fn mesher_iso_crossing_interpolates_across_chunk_sample_boundary() {
        let (distance, point) =
            mesher_iso_crossing_between_samples(Vec3::ZERO, Vec3::X, 15.5, -1.0, 16.5, 1.0)
                .expect("opposite signs should produce an iso crossing");

        assert!((distance - 16.0).abs() < 1.0e-5);
        assert!((point.x - 16.0).abs() < 1.0e-5);
    }

    #[cfg(feature = "mc_transvoxel")]
    #[test]
    fn oracle_cell_selection_uses_mesher_iso_point() {
        let cell = mc_cell_for_point(Vec3::new(14.9, 4.1, 7.0), Vec3::ZERO, 16, 1);

        assert_eq!(cell, [14, 4, 7]);
    }

    #[cfg(feature = "mc_transvoxel")]
    #[test]
    fn oracle_cell_selection_keeps_lod1_positive_boundary_band() {
        let chunk_origin = Vec3::new(96.0, 32.0, 96.0);
        let cell = mc_cell_for_point(Vec3::new(96.60327, 46.26485, 96.79657), chunk_origin, 8, 2);

        assert_eq!(cell, [0, 7, 0]);
    }
}
