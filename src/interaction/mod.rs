//! Block and entity interaction systems.
//!
//! This module provides player interaction with the voxel world including:
//! - Block targeting and raycasting
//! - Block breaking and placing
//! - Edit mode (drag & drop blocks)
//! - Entity targeting and attacking
//! - Debug overlays

mod debug;
mod editing;
pub mod error;
pub mod palette;
pub mod radial_menu;
mod targeting;

// Re-export public types and functions from sub-modules
pub use debug::{DebugDetailToggles, DebugOverlay, DebugOverlayState};
pub use editing::{DeleteMode, DragState, DraggedBlock, EditMode, mark_neighbors_dirty};
pub use error::{BreakError, CombatError, DragError, LastGameplayError, PlacementError};
pub use targeting::{raycast_blocks, TargetedBlock, TargetedEntity, TargetedProp};

use crate::atmosphere::{FogCamera, FogConfig, GlobalFogVolume};
use crate::camera::controller::PlayerCamera;
use crate::constants::{ATTACK_DAMAGE, BEDROCK_DEPTH};
use crate::entity::Health;
use crate::environment::Sun;
use crate::menu::PauseMenuState;
use crate::particles::{ParticleType, SpawnParticleEvent};
use crate::performance::{AreaTimingCapture, AreaTimingRecorder};
use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::world::VoxelWorld;
use bevy::ecs::schedule::IntoScheduleConfigs;
use bevy::math::{Isometry3d, primitives::Cuboid};
use bevy::light::{FogVolume, VolumetricFog, VolumetricLight};
use bevy::prelude::*;
use palette::PlacementPaletteState;
use crate::terrain::tools::{TerrainTool, TerrainToolState};

/// Duration in seconds before gameplay errors are automatically cleared.
const ERROR_DISPLAY_DURATION: f64 = 3.0;

// ============================================================================
// Components
// ============================================================================

/// Component to mark the block highlight entity.
#[derive(Component)]
pub struct BlockHighlight;

// ============================================================================
// Resources
// ============================================================================

/// Resource for the player's held block type.
#[derive(Resource)]
pub struct HeldBlock {
    /// The type of block the player is currently holding.
    pub block_type: VoxelType,
}

impl Default for HeldBlock {
    fn default() -> Self {
        Self {
            block_type: VoxelType::Rock,
        }
    }
}

// ============================================================================
// Combat & Block Interaction
// ============================================================================

/// Handles attacking entities when the player left-clicks.
///
/// Applies damage to targeted entities when not in edit mode.
/// Reports combat errors via the `LastGameplayError` resource.
pub fn attack_entity_system(
    mouse: Res<ButtonInput<MouseButton>>,
    edit_mode: Res<EditMode>,
    targeted_entity: Res<TargetedEntity>,
    mut entity_query: Query<&mut Health>,
    mut last_error: ResMut<LastGameplayError>,
    time: Res<Time>,
) {
    if edit_mode.enabled {
        return;
    }

    if !mouse.just_pressed(MouseButton::Left) {
        return;
    }

    let result = try_attack_entity(&targeted_entity, &mut entity_query);
    if let Err(err) = result {
        last_error.set(err.to_string(), time.elapsed_secs_f64());
    }
}

/// Attempts to attack the targeted entity.
fn try_attack_entity(
    targeted_entity: &TargetedEntity,
    entity_query: &mut Query<&mut Health>,
) -> Result<(), CombatError> {
    let entity = targeted_entity.entity.ok_or(CombatError::EntityNotFound)?;

    let mut health = entity_query
        .get_mut(entity)
        .map_err(|_| CombatError::NoHealthComponent)?;

    if health.current <= 0.0 {
        return Err(CombatError::AlreadyDead);
    }

    health.damage(ATTACK_DAMAGE);
    info!("Attacked entity! Health: {}/{}", health.current, health.max);
    Ok(())
}

/// Handles block breaking when the player left-clicks.
///
/// Removes the targeted block (unless it's bedrock) and updates the held block type.
/// Reports break errors via the `LastGameplayError` resource.
pub fn break_block_system(
    mouse: Res<ButtonInput<MouseButton>>,
    edit_mode: Res<EditMode>,
    targeted_block: Res<TargetedBlock>,
    targeted_entity: Res<TargetedEntity>,
    mut world: ResMut<VoxelWorld>,
    mut held: ResMut<HeldBlock>,
    mut particle_events: MessageWriter<SpawnParticleEvent>,
    mut last_error: ResMut<LastGameplayError>,
    time: Res<Time>,
    terrain_tool_state: Res<TerrainToolState>,
) {
    if edit_mode.enabled {
        return;
    }

    // Do not break blocks if a terrain tool is active
    if terrain_tool_state.active_tool != TerrainTool::None {
        return;
    }

    if !mouse.just_pressed(MouseButton::Left) || targeted_entity.entity.is_some() {
        return;
    }

    let result = try_break_block(&targeted_block, &mut world, &mut held);
    match result {
        Ok(pos) => {
            // Spawn particles on successful break
            let center = Vec3::new(pos.x as f32 + 0.5, pos.y as f32 + 0.5, pos.z as f32 + 0.5);
            particle_events.write(SpawnParticleEvent {
                position: center,
                particle_type: ParticleType::Dig,
            });
        }
        Err(err) => {
            // Only show error for actual failure (not just no target)
            if !matches!(err, BreakError::NoTarget) {
                last_error.set(err.to_string(), time.elapsed_secs_f64());
            }
        }
    }
}

/// Attempts to break the targeted block.
///
/// Returns the position of the broken block on success.
fn try_break_block(
    targeted_block: &TargetedBlock,
    world: &mut VoxelWorld,
    held: &mut HeldBlock,
) -> Result<IVec3, BreakError> {
    let pos = targeted_block.position.ok_or(BreakError::NoTarget)?;
    let voxel_type = targeted_block.voxel_type.ok_or(BreakError::NoTarget)?;

    if !can_modify_at(pos) {
        return Err(BreakError::Unbreakable { position: pos });
    }

    if voxel_type == VoxelType::Bedrock {
        return Err(BreakError::Unbreakable { position: pos });
    }

    held.block_type = voxel_type;
    world.set_voxel(pos, VoxelType::Air);
    editing::mark_neighbors_dirty(world, pos);

    Ok(pos)
}

/// Handles block placing when the player right-clicks.
///
/// Places the held block type at the targeted surface, if valid.
/// Reports placement errors via the `LastGameplayError` resource.
pub fn place_block_system(
    mouse: Res<ButtonInput<MouseButton>>,
    edit_mode: Res<EditMode>,
    delete_mode: Res<DeleteMode>,
    targeted: Res<TargetedBlock>,
    mut world: ResMut<VoxelWorld>,
    held: Res<HeldBlock>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    drag_state: Res<DragState>,
    mut last_error: ResMut<LastGameplayError>,
    time: Res<Time>,
    terrain_tool_state: Res<TerrainToolState>,
) {
    if edit_mode.enabled {
        return;
    }

    // Do not place blocks if a terrain tool is active
    if terrain_tool_state.active_tool != TerrainTool::None {
        return;
    }

    if delete_mode.enabled || drag_state.dragged_block.is_some() {
        return;
    }

    if !mouse.just_pressed(MouseButton::Right) {
        return;
    }

    let result = try_place_block(&targeted, &mut world, &held, &camera_query);
    if let Err(err) = result {
        // Only show error for actual failure (not just no target)
        if !matches!(err, PlacementError::NoTarget) {
            last_error.set(err.to_string(), time.elapsed_secs_f64());
        }
    }
}

/// Attempts to place a block at the targeted surface.
fn try_place_block(
    targeted: &TargetedBlock,
    world: &mut VoxelWorld,
    held: &HeldBlock,
    camera_query: &Query<&Transform, With<PlayerCamera>>,
) -> Result<IVec3, PlacementError> {
    let block_pos = targeted.position.ok_or(PlacementError::NoTarget)?;
    let normal = targeted.normal.ok_or(PlacementError::NoTarget)?;

    let place_pos = block_pos + normal;

    if !can_modify_at(place_pos) {
        return Err(PlacementError::InvalidPosition {
            position: place_pos,
            reason: "Below bedrock depth".to_string(),
        });
    }

    // Check if player is blocking the position
    if is_player_blocking_position(camera_query, place_pos) {
        return Err(PlacementError::PlayerBlocking { position: place_pos });
    }

    // Check if position is valid for placement
    let existing = world.get_voxel(place_pos).ok_or(PlacementError::OutOfBounds {
        position: place_pos,
    })?;

    if existing != VoxelType::Air && existing != VoxelType::Water {
        return Err(PlacementError::PositionOccupied { position: place_pos });
    }

    // Place the block
    world.set_voxel(place_pos, held.block_type);
    editing::mark_neighbors_dirty(world, place_pos);

    Ok(place_pos)
}

/// Checks if the player's body occupies the given position.
fn is_player_blocking_position(
    camera_query: &Query<&Transform, With<PlayerCamera>>,
    place_pos: IVec3,
) -> bool {
    let Ok(camera_transform) = camera_query.single() else {
        return false;
    };

    let player_pos = camera_transform.translation;
    let player_block = player_pos.floor().as_ivec3();
    let player_feet = IVec3::new(
        player_pos.x.floor() as i32,
        (player_pos.y - 1.8).floor() as i32,
        player_pos.z.floor() as i32,
    );

    place_pos == player_block || place_pos == player_feet
}

fn can_modify_at(world_pos: IVec3) -> bool {
    world_pos.y > BEDROCK_DEPTH
}

// ============================================================================
// Block Highlight Rendering
// ============================================================================

/// Renders a wireframe highlight around the targeted block.
///
/// Also renders a placement arrow when dragging blocks in edit mode.
pub fn render_block_highlight(
    targeted: Res<TargetedBlock>,
    drag_state: Res<DragState>,
    edit_mode: Res<EditMode>,
    world: Res<VoxelWorld>,
    mut gizmos: Gizmos,
) {
    let Some(pos) = targeted.position else {
        return;
    };

    let center = Vec3::new(pos.x as f32 + 0.5, pos.y as f32 + 0.5, pos.z as f32 + 0.5);
    let half_size = Vec3::splat(0.505);
    let cuboid = Cuboid::new(half_size.x * 2.0, half_size.y * 2.0, half_size.z * 2.0);

    gizmos.primitive_3d(
        &cuboid,
        Isometry3d::from_translation(center),
        Color::srgba(1.0, 1.0, 1.0, 0.8),
    );

    if edit_mode.enabled && drag_state.dragged_block.is_some() {
        render_placement_arrow(&targeted, &drag_state, &world, &mut gizmos);
    }
}

/// Renders an arrow indicating where the dragged block will be placed.
fn render_placement_arrow(
    targeted: &TargetedBlock,
    drag_state: &DragState,
    world: &VoxelWorld,
    gizmos: &mut Gizmos,
) {
    let (Some(pos), Some(normal)) = (targeted.position, targeted.normal) else {
        return;
    };

    let desired = pos + normal;
    let Some(grounded) = editing::find_grounded_position(desired, world) else {
        return;
    };

    let placement_center = Vec3::new(
        grounded.x as f32 + 0.5,
        grounded.y as f32 + 0.5,
        grounded.z as f32 + 0.5,
    );
    let rotation = Quat::from_rotation_y(drag_state.rotation_degrees.to_radians());
    let forward = rotation * Vec3::Z;
    gizmos.arrow(
        placement_center,
        placement_center + forward * 0.75,
        Color::srgb(1.0, 0.27, 0.0),
    );
}

// ============================================================================
// Detailed Debug Logging (G key)
// ============================================================================

/// Prints detailed voxel debug information when G is pressed.
///
/// This provides comprehensive block analysis including:
/// - Camera and targeted block positions
/// - 3x3x3 block cube visualization
/// - Neighbor analysis
/// - Water and air gap analysis
pub fn debug_voxel_info_system(
    keyboard: Res<ButtonInput<KeyCode>>,
    targeted: Res<TargetedBlock>,
    world: Res<VoxelWorld>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    time: Res<Time>,
    fog_config: Res<FogConfig>,
    debug_toggles: Res<DebugDetailToggles>,
    fog_volume_query: Query<(&FogVolume, &Transform), With<GlobalFogVolume>>,
    volumetric_fog_query: Query<&VolumetricFog, With<FogCamera>>,
    volumetric_light_query: Query<(&VolumetricLight, &DirectionalLight), With<Sun>>,
    fog_camera_query: Query<&Transform, With<FogCamera>>,
) {
    if !keyboard.just_pressed(KeyCode::KeyG) {
        return;
    }

    print_debug_header();
    print_camera_position(&camera_query);

    let (Some(pos), Some(voxel_type)) = (targeted.position, targeted.voxel_type) else {
        info!("|  No block targeted - look at a block first");
        info!("==================================================================");
        return;
    };

    print_targeted_block_info(pos, voxel_type);
    print_3x3_cube(&world, pos);
    print_neighbor_analysis(&world, pos);
    print_water_analysis(&world, pos);
    print_air_gap_analysis(&world, pos);
    print_fog_debug(
        &time,
        &fog_config,
        &debug_toggles,
        fog_config.is_changed(),
        debug_toggles.is_changed(),
        &fog_volume_query,
        &volumetric_fog_query,
        &volumetric_light_query,
        &fog_camera_query,
    );

    info!("==================================================================");
}

fn print_debug_header() {
    info!("+================================================================+");
    info!("|              DETAILED BLOCK DEBUG INFO [G]                     |");
    info!("+================================================================+");
}

fn print_camera_position(camera_query: &Query<&Transform, With<PlayerCamera>>) {
    if let Ok(camera) = camera_query.single() {
        let pos = camera.translation;
        info!("Camera: ({:.2}, {:.2}, {:.2})", pos.x, pos.y, pos.z);
    }
}

fn print_targeted_block_info(pos: IVec3, voxel_type: VoxelType) {
    let chunk_pos = VoxelWorld::world_to_chunk(pos);
    let local_pos = VoxelWorld::world_to_local(pos);

    info!("+---------------------------------------------------------------+");
    info!("| TARGETED BLOCK                                                |");
    info!("+---------------------------------------------------------------+");
    info!("| World pos: {:?}", pos);
    info!("| Chunk pos: {:?}  Local: {:?}", chunk_pos, local_pos);
    info!(
        "| Type: {:?} (atlas: {})",
        voxel_type,
        voxel_type.atlas_index()
    );
    info!(
        "| Solid: {}  Transparent: {}  Liquid: {}",
        voxel_type.is_solid(),
        voxel_type.is_transparent(),
        voxel_type.is_liquid()
    );
    info!("+---------------------------------------------------------------+");
}

fn print_3x3_cube(world: &VoxelWorld, pos: IVec3) {
    info!("+---------------------------------------------------------------+");
    info!("| 3x3x3 BLOCK CUBE (centered on target)                         |");
    info!("+---------------------------------------------------------------+");

    for dy in (-1..=1).rev() {
        info!("| Y={:+} layer:", dy);
        for dz in -1..=1 {
            let mut row = String::from("|   ");
            for dx in -1..=1 {
                let scan_pos = pos + IVec3::new(dx, dy, dz);
                let symbol = get_voxel_symbol(world, scan_pos, dx == 0 && dy == 0 && dz == 0);
                row.push_str(symbol);
            }
            row.push_str(&format!("  (z={:+})", dz));
            info!("{}", row);
        }
    }
    info!("| Legend: [X]=target  #=solid  ~W~=water  .=air  -=outside     |");
    info!("+---------------------------------------------------------------+");
}

fn get_voxel_symbol(world: &VoxelWorld, pos: IVec3, is_target: bool) -> &'static str {
    match world.get_voxel(pos) {
        Some(v) => {
            if is_target {
                "[X]"
            } else if v.is_liquid() {
                "~W~"
            } else if v == VoxelType::Air {
                " . "
            } else if v.is_solid() {
                " # "
            } else {
                " ? "
            }
        }
        None => " - ",
    }
}

fn print_neighbor_analysis(world: &VoxelWorld, pos: IVec3) {
    let chunk_pos = VoxelWorld::world_to_chunk(pos);

    info!("+---------------------------------------------------------------+");
    info!("| DIRECT NEIGHBORS (6 faces)                                    |");
    info!("+---------------------------------------------------------------+");

    let neighbors = [
        ("Top    (+Y)", IVec3::Y),
        ("Bottom (-Y)", IVec3::NEG_Y),
        ("North  (+Z)", IVec3::Z),
        ("South  (-Z)", IVec3::NEG_Z),
        ("East   (+X)", IVec3::X),
        ("West   (-X)", IVec3::NEG_X),
    ];

    for (name, offset) in neighbors {
        let neighbor_pos = pos + offset;
        let neighbor_chunk = VoxelWorld::world_to_chunk(neighbor_pos);
        let cross_chunk = neighbor_chunk != chunk_pos;

        match world.get_voxel(neighbor_pos) {
            Some(n_type) => {
                let flags = format!(
                    "{}{}{}",
                    if n_type.is_solid() { "S" } else { "-" },
                    if n_type.is_transparent() { "T" } else { "-" },
                    if n_type.is_liquid() { "L" } else { "-" }
                );
                info!(
                    "| {}: {:?} [{}] {:?}{}",
                    name,
                    n_type,
                    flags,
                    neighbor_pos,
                    if cross_chunk { " (CROSS-CHUNK)" } else { "" }
                );
            }
            None => {
                info!("| {}: OUTSIDE WORLD at {:?}", name, neighbor_pos);
            }
        }
    }
    info!("| Flags: S=solid, T=transparent, L=liquid                       |");
    info!("+---------------------------------------------------------------+");
}

fn print_water_analysis(world: &VoxelWorld, pos: IVec3) {
    info!("+---------------------------------------------------------------+");
    info!("| WATER ANALYSIS (5x5x5 area) - Blue Crack Debug                |");
    info!("+---------------------------------------------------------------+");

    let (water_voxels, water_exposed_to_air, water_adjacent_to_solid) =
        analyze_water_in_area(world, pos);

    info!("| Total water voxels: {}", water_voxels.len());
    info!(
        "| Water exposed to AIR: {} (potential visible faces)",
        water_exposed_to_air
    );
    info!(
        "| Water adjacent to SOLID: {} (terrain contact)",
        water_adjacent_to_solid
    );

    if !water_voxels.is_empty() {
        info!("|");
        info!("| Water positions (showing up to 15):");
        for (water_pos, dx, dy, dz) in water_voxels.iter().take(15) {
            let adj_details = get_water_adjacency_details(world, *water_pos);
            info!(
                "|   {:?} (off:{:+},{:+},{:+}) -> [{}]",
                water_pos,
                dx,
                dy,
                dz,
                adj_details.join(" ")
            );
        }
        if water_voxels.len() > 15 {
            info!("| ... and {} more water voxels", water_voxels.len() - 15);
        }
    } else {
        info!("| No water found near targeted block");
    }
    info!("+---------------------------------------------------------------+");
}

fn analyze_water_in_area(
    world: &VoxelWorld,
    center: IVec3,
) -> (Vec<(IVec3, i32, i32, i32)>, usize, usize) {
    let mut water_voxels = Vec::new();
    let mut water_exposed_to_air = 0;
    let mut water_adjacent_to_solid = 0;

    let face_offsets = [
        IVec3::X,
        IVec3::NEG_X,
        IVec3::Y,
        IVec3::NEG_Y,
        IVec3::Z,
        IVec3::NEG_Z,
    ];

    for dx in -2..=2 {
        for dy in -2..=2 {
            for dz in -2..=2 {
                let scan_pos = center + IVec3::new(dx, dy, dz);
                let Some(voxel) = world.get_voxel(scan_pos) else {
                    continue;
                };

                if !voxel.is_liquid() {
                    continue;
                }

                water_voxels.push((scan_pos, dx, dy, dz));

                let mut has_air = false;
                let mut has_solid = false;
                for offset in face_offsets {
                    if let Some(adj) = world.get_voxel(scan_pos + offset) {
                        if adj == VoxelType::Air {
                            has_air = true;
                        }
                        if adj.is_solid() {
                            has_solid = true;
                        }
                    }
                }
                if has_air {
                    water_exposed_to_air += 1;
                }
                if has_solid {
                    water_adjacent_to_solid += 1;
                }
            }
        }
    }

    (water_voxels, water_exposed_to_air, water_adjacent_to_solid)
}

fn get_water_adjacency_details(world: &VoxelWorld, water_pos: IVec3) -> Vec<String> {
    let directions = [
        ("+X", IVec3::X),
        ("-X", IVec3::NEG_X),
        ("+Y", IVec3::Y),
        ("-Y", IVec3::NEG_Y),
        ("+Z", IVec3::Z),
        ("-Z", IVec3::NEG_Z),
    ];

    let mut details = Vec::new();
    for (dir_name, offset) in directions {
        if let Some(adj) = world.get_voxel(water_pos + offset) {
            if adj == VoxelType::Air {
                details.push(format!("{}:Air", dir_name));
            } else if adj.is_solid() {
                details.push(format!("{}:Sld", dir_name));
            }
        }
    }
    details
}

fn print_air_gap_analysis(world: &VoxelWorld, pos: IVec3) {
    info!("+---------------------------------------------------------------+");
    info!("| AIR POCKET ANALYSIS (potential gap areas)                     |");
    info!("+---------------------------------------------------------------+");

    let air_gaps = find_air_gaps(world, pos);

    if air_gaps == 0 {
        info!("| No air gaps found between water and solid blocks");
    } else {
        info!("| FOUND {} air gaps between water and solid!", air_gaps);
    }
    info!("+---------------------------------------------------------------+");
}

fn print_fog_debug(
    time: &Time,
    fog_config: &FogConfig,
    debug_toggles: &DebugDetailToggles,
    config_changed: bool,
    toggles_changed: bool,
    fog_volume_query: &Query<(&FogVolume, &Transform), With<GlobalFogVolume>>,
    volumetric_fog_query: &Query<&VolumetricFog, With<FogCamera>>,
    volumetric_light_query: &Query<(&VolumetricLight, &DirectionalLight), With<Sun>>,
    fog_camera_query: &Query<&Transform, With<FogCamera>>,
) {
    let has_fog_volume = fog_volume_query.iter().next().is_some();
    let has_volumetric_fog = volumetric_fog_query.iter().next().is_some();
    let has_volumetric_light = volumetric_light_query.iter().next().is_some();
    let camera_count = fog_camera_query.iter().len();
    let fps = 1.0 / time.delta_secs().max(0.001);

    info!("+---------------------------------------------------------------+");
    info!("| FOG STATE                                                     |");
    info!("+---------------------------------------------------------------+");
    info!(
        "FOG STATE: config.enabled={}, toggle.enabled={}, FogVolume={}, CamVFog={}, toggle_changed={}, config_changed={}",
        fog_config.volumetric.enabled,
        debug_toggles.volumetric_fog_enabled,
        has_fog_volume,
        has_volumetric_fog,
        toggles_changed,
        config_changed
    );

    if has_fog_volume && has_volumetric_fog && has_volumetric_light {
        if let (Ok((volume, vol_tf)), Ok(_), Ok(vfog), Ok(_)) = (
            fog_volume_query.single(),
            fog_camera_query.single(),
            volumetric_fog_query.single(),
            volumetric_light_query.single(),
        ) {
            info!(
                "God rays ACTIVE (FPS={:.0}): density={:.4}, scattering={:.2}, absorption={:.5}, intensity={:.1}, scale={:.0}, steps={}",
                fps,
                volume.density_factor,
                volume.scattering,
                volume.absorption,
                volume.light_intensity,
                vol_tf.scale.x,
                vfog.step_count,
            );
        } else {
            info!("God rays ACTIVE (FPS={:.0})", fps);
        }
    } else {
        info!(
            "God rays MISSING (FPS={:.0}): FogVolume={}, VolumetricFog={}, VolumetricLight={}, CameraCount={}",
            fps, has_fog_volume, has_volumetric_fog, has_volumetric_light, camera_count
        );
    }
}

fn find_air_gaps(world: &VoxelWorld, center: IVec3) -> usize {
    let face_offsets = [
        IVec3::X,
        IVec3::NEG_X,
        IVec3::Y,
        IVec3::NEG_Y,
        IVec3::Z,
        IVec3::NEG_Z,
    ];

    let mut air_between_water_and_solid = 0;

    for dx in -2..=2 {
        for dy in -2..=2 {
            for dz in -2..=2 {
                let scan_pos = center + IVec3::new(dx, dy, dz);
                let Some(voxel) = world.get_voxel(scan_pos) else {
                    continue;
                };

                if voxel != VoxelType::Air {
                    continue;
                }

                let mut has_water_neighbor = false;
                let mut has_solid_neighbor = false;
                for offset in face_offsets {
                    if let Some(adj) = world.get_voxel(scan_pos + offset) {
                        if adj.is_liquid() {
                            has_water_neighbor = true;
                        }
                        if adj.is_solid() {
                            has_solid_neighbor = true;
                        }
                    }
                }
                if has_water_neighbor && has_solid_neighbor {
                    air_between_water_and_solid += 1;
                    info!(
                        "| AIR GAP at {:?} (off:{:+},{:+},{:+}) - water+solid neighbors!",
                        scan_pos, dx, dy, dz
                    );
                }
            }
        }
    }

    air_between_water_and_solid
}

// ============================================================================
// Plugin
// ============================================================================

// ============================================================================
// Error Management
// ============================================================================

/// Clears expired gameplay errors.
fn clear_expired_errors(mut last_error: ResMut<LastGameplayError>, time: Res<Time>) {
    last_error.clear_if_expired(time.elapsed_secs_f64(), ERROR_DISPLAY_DURATION);
}

// ============================================================================
// Plugin
// ============================================================================

/// Plugin for block and entity interaction systems.
pub struct InteractionPlugin;

impl Plugin for InteractionPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<TargetedBlock>()
            .init_resource::<TargetedEntity>()
            .init_resource::<TargetedProp>()
            .init_resource::<HeldBlock>()
            .init_resource::<EditMode>()
            .init_resource::<DeleteMode>()
            .init_resource::<DragState>()
            .init_resource::<DebugOverlayState>()
            .init_resource::<DebugDetailToggles>()
            .init_resource::<debug::PerformanceMetrics>()
            .init_resource::<debug::SystemPerformanceMonitor>()
            .init_resource::<AreaTimingRecorder>()
            .init_resource::<AreaTimingCapture>()
            .init_resource::<LastGameplayError>()
            .init_resource::<palette::PaletteItems>()
            .init_resource::<PlacementPaletteState>()
            .init_resource::<palette::BookmarkStore>()
            .init_resource::<palette::GhostPreviewState>()
            .init_resource::<radial_menu::RadialMenuState>()
            .add_systems(Startup, debug::setup_debug_overlay)
            .add_systems(Startup, palette::load_bookmarks)
            .add_systems(Startup, palette::setup_ghost_materials)
            .add_systems(
                Update,
                (
                    targeting::update_targeted_block,
                    targeting::update_targeted_entity,
                    targeting::update_targeted_prop.run_if(
                        |state: Res<DebugOverlayState>, toggles: Res<DebugDetailToggles>| {
                            state.visible && toggles.show_prop_details
                        },
                    ),
                    palette::initialize_palette_items,
                    palette::toggle_palette,
                    palette::handle_palette_input,
                    palette::handle_bookmark_buttons,
                    editing::toggle_edit_mode,
                    editing::toggle_delete_mode,
                    editing::start_dragging_block,
                    palette::handle_palette_item_click,
                    editing::delete_block_in_edit_mode,
                    editing::update_drag_rotation,
                    palette::update_ghost_preview,
                    palette::sync_ghost_materials,
                    palette::sync_building_state_from_palette,
                    radial_menu::handle_radial_menu_interaction,
                    radial_menu::handle_radial_escape,
                )
                    .run_if(|state: Res<PauseMenuState>| !state.open),
            )
            .add_systems(
                Update,
                (
                    editing::finish_dragging_block,
                    palette::place_prop_from_palette,
                    palette::persist_bookmarks,
                    attack_entity_system,
                    break_block_system,
                    place_block_system,
                    palette::refresh_palette_ui,
                    render_block_highlight,
                )
                    .run_if(|state: Res<PauseMenuState>| !state.open),
            )
            .add_systems(
                Update,
                (
                    debug_voxel_info_system.run_if(|state: Res<PauseMenuState>| !state.open),
                    debug::toggle_debug_overlay.run_if(|state: Res<PauseMenuState>| !state.open),
                    debug::toggle_debug_details.run_if(|state: Res<PauseMenuState>| !state.open),
                    debug::toggle_mesh_mode.run_if(|state: Res<PauseMenuState>| !state.open),
                    debug::update_system_monitor.run_if(|state: Res<PauseMenuState>| !state.open),
                    debug::update_debug_overlay.run_if(|state: Res<PauseMenuState>| !state.open),
                    clear_expired_errors.run_if(|state: Res<PauseMenuState>| !state.open),
                )
            );
        app.add_systems(PreUpdate, crate::performance::reset_area_timing_frame);
        app.add_systems(PostUpdate, crate::performance::capture_area_timings);
    }
}
