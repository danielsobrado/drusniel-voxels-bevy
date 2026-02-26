//! Ghost preview and placement systems for building.

use bevy::prelude::*;
use bevy::math::{Isometry3d, primitives::Cuboid};

use crate::interaction::TargetedBlock;
use crate::rendering::building_material::{BuildingMaterialHandle, BuildingMesh};
use crate::voxel::world::VoxelWorld;
use crate::voxel::types::{Voxel, VoxelType};

use super::grid::BuildingGrid;
use super::types::{BuildingGhost, BuildingPiece, BuildingPieceRegistry, BuildingState, PieceTypeId};

/// Materials for the building ghost.
#[derive(Resource)]
pub struct BuildingGhostMaterials {
    /// Green material for valid placement.
    pub valid: Handle<StandardMaterial>,
    /// Red material for invalid placement.
    pub invalid: Handle<StandardMaterial>,
    /// Blue material for snapped placement.
    pub snapped: Handle<StandardMaterial>,
}

/// Setup ghost materials.
pub fn setup_ghost_materials(
    mut commands: Commands,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    let valid = materials.add(StandardMaterial {
        base_color: Color::srgba(0.2, 0.9, 0.2, 0.5),
        unlit: true,
        alpha_mode: AlphaMode::Blend,
        ..default()
    });

    let invalid = materials.add(StandardMaterial {
        base_color: Color::srgba(0.9, 0.2, 0.2, 0.5),
        unlit: true,
        alpha_mode: AlphaMode::Blend,
        ..default()
    });

    let snapped = materials.add(StandardMaterial {
        base_color: Color::srgba(0.2, 0.5, 0.9, 0.5),
        unlit: true,
        alpha_mode: AlphaMode::Blend,
        ..default()
    });

    commands.insert_resource(BuildingGhostMaterials {
        valid,
        invalid,
        snapped,
    });
}

/// Update the building ghost position and validity.
pub fn update_building_ghost(
    state: Res<BuildingState>,
    registry: Res<BuildingPieceRegistry>,
    targeted: Res<TargetedBlock>,
    world: Res<VoxelWorld>,
    grid: Res<BuildingGrid>,
    mut ghost_query: Query<(&mut Transform, &mut BuildingGhost, &mut Visibility)>,
    mut gizmos: Gizmos,
) {
    // If no piece selected or not in building mode, hide ghost
    if !state.active {
        for (_, _, mut vis) in ghost_query.iter_mut() {
            *vis = Visibility::Hidden;
        }
        return;
    }

    let Some(piece_type) = state.selected_piece else {
        for (_, _, mut vis) in ghost_query.iter_mut() {
            *vis = Visibility::Hidden;
        }
        return;
    };

    let Some(piece_def) = registry.get(piece_type) else {
        return;
    };

    // Calculate ghost position
    let (ghost_pos, ghost_rot, valid, snapped) = if let Some(ref snap) = state.current_snap {
        // Use snap result
        (snap.world_position, snap.world_rotation, true, true)
    } else if let (Some(block_pos), Some(normal)) = (targeted.position, targeted.normal) {
        // Free placement on terrain
        let place_pos = block_pos + normal;
        let pos = Vec3::new(
            place_pos.x as f32 + 0.5,
            place_pos.y as f32 + 0.5,
            place_pos.z as f32 + 0.5,
        );
        let rot = state.rotation_quat();

        // Check validity
        let valid = validate_placement(
            pos,
            piece_type,
            state.rotation,
            &world,
            &grid,
            &registry,
        );

        (pos, rot, valid, false)
    } else {
        // No valid target
        for (_, _, mut vis) in ghost_query.iter_mut() {
            *vis = Visibility::Hidden;
        }
        return;
    };

    // Update ghost entity
    for (mut transform, mut ghost, mut vis) in ghost_query.iter_mut() {
        transform.translation = ghost_pos;
        transform.rotation = ghost_rot;
        ghost.valid = valid;
        ghost.snapped = snapped;
        *vis = Visibility::Visible;
    }

    // Draw ghost outline with gizmos (temporary visualization)
    let color = if snapped {
        Color::srgba(0.2, 0.5, 0.9, 0.8)
    } else if valid {
        Color::srgba(0.2, 0.9, 0.2, 0.8)
    } else {
        Color::srgba(0.9, 0.2, 0.2, 0.8)
    };

    let half_size = piece_def.dimensions * 0.5;
    let cuboid = Cuboid::new(half_size.x * 2.0, half_size.y * 2.0, half_size.z * 2.0);
    gizmos.primitive_3d(
        &cuboid,
        Isometry3d::new(ghost_pos, ghost_rot),
        color,
    );

    // Draw snap points when snapped
    if snapped {
        if let Some(ref snap) = state.current_snap {
            // Draw line connecting the snap points
            gizmos.line(
                snap.target_snap.position,
                ghost_pos + (ghost_rot * piece_def.snap_points[snap.source_snap_index].local_offset),
                Color::srgba(1.0, 1.0, 0.0, 0.8),
            );
        }
    }
}

/// Validate whether a piece can be placed at the given position.
pub fn validate_placement(
    position: Vec3,
    piece_type: PieceTypeId,
    rotation: u8,
    world: &VoxelWorld,
    grid: &BuildingGrid,
    registry: &BuildingPieceRegistry,
) -> bool {
    let Some(piece_def) = registry.get(piece_type) else {
        return false;
    };

    let rot = Quat::from_rotation_y((rotation as f32) * std::f32::consts::FRAC_PI_2);
    let half_size = piece_def.dimensions * 0.5;

    // Check all corners of the bounding box for collisions
    let corners = [
        Vec3::new(-half_size.x, -half_size.y, -half_size.z),
        Vec3::new(half_size.x, -half_size.y, -half_size.z),
        Vec3::new(-half_size.x, half_size.y, -half_size.z),
        Vec3::new(half_size.x, half_size.y, -half_size.z),
        Vec3::new(-half_size.x, -half_size.y, half_size.z),
        Vec3::new(half_size.x, -half_size.y, half_size.z),
        Vec3::new(-half_size.x, half_size.y, half_size.z),
        Vec3::new(half_size.x, half_size.y, half_size.z),
    ];

    for corner in corners {
        let world_corner = position + rot * corner;
        let block_pos = world_corner.floor().as_ivec3();

        // Check if inside solid voxel
        if let Some(voxel) = world.get_voxel(block_pos) {
            if voxel.is_solid() && voxel != VoxelType::Air {
                return false;
            }
        }
    }

    // Check grid for existing building pieces
    let grid_pos = grid.world_to_cell(position);
    if grid.is_occupied(grid_pos) {
        return false;
    }

    // If piece can be grounded, check for terrain support
    if piece_def.can_ground {
        let below_center = position - Vec3::Y * (half_size.y + 0.1);
        let below_block = below_center.floor().as_ivec3();
        if let Some(voxel) = world.get_voxel(below_block) {
            if voxel.is_solid() {
                return true;
            }
        }
    }

    true
}

/// Place a building piece at the current ghost position.
pub fn place_building_piece(
    mut commands: Commands,
    mouse: Res<ButtonInput<MouseButton>>,
    state: Res<BuildingState>,
    registry: Res<BuildingPieceRegistry>,
    mut grid: ResMut<BuildingGrid>,
    ghost_query: Query<(&Transform, &BuildingGhost)>,
    mut meshes: ResMut<Assets<Mesh>>,
    building_mat_handle: Option<Res<BuildingMaterialHandle>>,
    mut standard_materials: ResMut<Assets<StandardMaterial>>,
) {
    if !state.active || !mouse.just_pressed(MouseButton::Right) {
        return;
    }

    let Some(piece_type) = state.selected_piece else {
        return;
    };

    let Some(piece_def) = registry.get(piece_type) else {
        return;
    };

    // Get ghost state
    let Ok((transform, ghost)) = ghost_query.single() else {
        return;
    };

    if !ghost.valid {
        return;
    }

    let position = transform.translation;
    let rotation = state.rotation;
    let grid_pos = grid.world_to_cell(position);

    // Create the building piece entity
    let mesh = meshes.add(Cuboid::new(
        piece_def.dimensions.x,
        piece_def.dimensions.y,
        piece_def.dimensions.z,
    ));

    // Use BuildingMaterial if available, otherwise fall back to StandardMaterial
    let entity = if let Some(ref mat_handle) = building_mat_handle {
        commands
            .spawn((
                Mesh3d(mesh),
                MeshMaterial3d(mat_handle.handle.clone()),
                Transform::from_translation(position)
                    .with_rotation(state.rotation_quat()),
                BuildingPiece {
                    piece_type,
                    grid_position: grid_pos,
                    rotation,
                    material: piece_def.material,
                },
                BuildingMesh {
                    material_type: piece_def.material,
                },
            ))
            .id()
    } else {
        // Fallback to StandardMaterial with color based on material type
        let base_color = match piece_def.material {
            crate::rendering::building_material::BuildingMaterialType::WoodPlank => {
                Color::srgb(0.6, 0.4, 0.2)
            }
            crate::rendering::building_material::BuildingMaterialType::StoneBrick => {
                Color::srgb(0.5, 0.5, 0.5)
            }
            crate::rendering::building_material::BuildingMaterialType::MetalPlate => {
                Color::srgb(0.4, 0.4, 0.45)
            }
            crate::rendering::building_material::BuildingMaterialType::Thatch => {
                Color::srgb(0.7, 0.6, 0.3)
            }
        };

        let material = standard_materials.add(StandardMaterial {
            base_color,
            ..default()
        });

        commands
            .spawn((
                Mesh3d(mesh),
                MeshMaterial3d(material),
                Transform::from_translation(position)
                    .with_rotation(state.rotation_quat()),
                BuildingPiece {
                    piece_type,
                    grid_position: grid_pos,
                    rotation,
                    material: piece_def.material,
                },
            ))
            .id()
    };

    // Add to grid
    grid.insert(grid_pos, entity);

    info!(
        "Placed {} ({:?}) at {:?} (grid: {:?})",
        piece_def.name, piece_def.material, position, grid_pos
    );
}
