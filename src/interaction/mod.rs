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
mod targeting;

// Re-export public types and functions from sub-modules
pub use debug::{DebugDetailToggles, DebugOverlay, DebugOverlayState};
pub use editing::{DeleteMode, DragState, DraggedBlock, EditMode};
pub use error::{BreakError, CombatError, DragError, LastGameplayError, PlacementError};
pub use targeting::{raycast_blocks, TargetedBlock, TargetedEntity};

use crate::camera::controller::PlayerCamera;
use crate::constants::ATTACK_DAMAGE;
use crate::entity::Health;
use crate::menu::PauseMenuState;
use crate::particles::{ParticleType, SpawnParticleEvent};
use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::world::VoxelWorld;
use bevy::prelude::*;
use palette::{PlacementPaletteState, PlacementSelection};

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
pub fn attack_entity_system(
    mouse: Res<ButtonInput<MouseButton>>,
    edit_mode: Res<EditMode>,
    targeted_entity: Res<TargetedEntity>,
    mut entity_query: Query<&mut Health>,
) {
    if edit_mode.enabled {
        return;
    }

    if mouse.just_pressed(MouseButton::Left) {
        if let Some(entity) = targeted_entity.entity {
            if let Ok(mut health) = entity_query.get_mut(entity) {
                health.damage(ATTACK_DAMAGE);
                info!("Attacked entity! Health: {}/{}", health.current, health.max);
            }
        }
    }
}

/// Handles block breaking when the player left-clicks.
///
/// Removes the targeted block (unless it's bedrock) and updates the held block type.
pub fn break_block_system(
    mouse: Res<ButtonInput<MouseButton>>,
    edit_mode: Res<EditMode>,
    targeted_block: Res<TargetedBlock>,
    targeted_entity: Res<TargetedEntity>,
    mut world: ResMut<VoxelWorld>,
    mut held: ResMut<HeldBlock>,
    mut particle_events: MessageWriter<SpawnParticleEvent>,
) {
    if edit_mode.enabled {
        return;
    }

    if !mouse.just_pressed(MouseButton::Left) || targeted_entity.entity.is_some() {
        return;
    }

    let (Some(pos), Some(voxel_type)) = (targeted_block.position, targeted_block.voxel_type) else {
        return;
    };

    if voxel_type == VoxelType::Bedrock {
        return;
    }

    held.block_type = voxel_type;
    world.set_voxel(pos, VoxelType::Air);
    editing::mark_neighbors_dirty(&mut world, pos);

    let center = Vec3::new(pos.x as f32 + 0.5, pos.y as f32 + 0.5, pos.z as f32 + 0.5);
    particle_events.write(SpawnParticleEvent {
        position: center,
        particle_type: ParticleType::Dig,
    });
}

/// Handles block placing when the player right-clicks.
///
/// Places the held block type at the targeted surface, if valid.
pub fn place_block_system(
    mouse: Res<ButtonInput<MouseButton>>,
    edit_mode: Res<EditMode>,
    delete_mode: Res<DeleteMode>,
    targeted: Res<TargetedBlock>,
    mut world: ResMut<VoxelWorld>,
    held: Res<HeldBlock>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    drag_state: Res<DragState>,
    palette: Res<PlacementPaletteState>,
) {
    let placing_in_edit_mode = edit_mode.enabled
        && palette
            .active_selection
            .as_ref()
            .is_some_and(|selection| matches!(selection, PlacementSelection::Voxel(_)));

    if edit_mode.enabled && !placing_in_edit_mode {
        return;
    }

    if delete_mode.enabled || drag_state.dragged_block.is_some() {
        return;
    }

    if !mouse.just_pressed(MouseButton::Right) {
        return;
    }

    let (Some(block_pos), Some(normal)) = (targeted.position, targeted.normal) else {
        return;
    };

    let place_pos = block_pos + normal;

    if is_player_blocking_position(&camera_query, place_pos) {
        return;
    }

    if let Some(existing) = world.get_voxel(place_pos) {
        if existing == VoxelType::Air || existing == VoxelType::Water {
            world.set_voxel(place_pos, held.block_type);
            editing::mark_neighbors_dirty(&mut world, place_pos);
        }
    }
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

    gizmos.cuboid(
        Transform::from_translation(center).with_scale(half_size * 2.0),
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

/// Plugin for block and entity interaction systems.
pub struct InteractionPlugin;

impl Plugin for InteractionPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<TargetedBlock>()
            .init_resource::<TargetedEntity>()
            .init_resource::<HeldBlock>()
            .init_resource::<EditMode>()
            .init_resource::<DeleteMode>()
            .init_resource::<DragState>()
            .init_resource::<DebugOverlayState>()
            .init_resource::<DebugDetailToggles>()
            .init_resource::<palette::PaletteItems>()
            .init_resource::<PlacementPaletteState>()
            .init_resource::<palette::BookmarkStore>()
            .add_systems(Startup, debug::setup_debug_overlay)
            .add_systems(Startup, palette::load_bookmarks)
            .add_systems(
                Update,
                (
                    targeting::update_targeted_block,
                    targeting::update_targeted_entity,
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
                    debug_voxel_info_system,
                    debug::toggle_debug_overlay,
                    debug::toggle_debug_details,
                    debug::update_debug_overlay,
                )
                    .run_if(|state: Res<PauseMenuState>| !state.open),
            );
    }
}
