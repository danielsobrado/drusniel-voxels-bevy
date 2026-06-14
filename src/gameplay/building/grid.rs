//! Spatial grid and snap point indexing for the building system.

use bevy::prelude::*;
use std::collections::{HashMap, HashSet};

use super::types::{BuildingPiece, PieceTypeId, SnapGroup};

/// Configuration for snap detection.
#[derive(Resource)]
pub struct SnapConfig {
    /// Maximum distance to detect snap points (in world units).
    pub snap_radius: f32,
    /// Cell size for spatial hash (should match typical piece size).
    pub cell_size: f32,
    /// Weight for direction alignment in scoring (0-1).
    pub alignment_weight: f32,
    /// Weight for distance in scoring (0-1).
    pub distance_weight: f32,
    /// Minimum alignment score to consider a snap valid (dot product threshold).
    pub min_alignment: f32,
}

impl Default for SnapConfig {
    fn default() -> Self {
        Self {
            snap_radius: 0.75,
            cell_size: 2.0,
            alignment_weight: 0.6,
            distance_weight: 0.4,
            min_alignment: 0.7, // ~45 degrees
        }
    }
}

/// Grid for tracking placed building pieces.
#[derive(Resource, Default)]
pub struct BuildingGrid {
    /// Map from grid cell to placed piece entities. Snapped pieces may share a coarse cell.
    pub cells: HashMap<IVec3, HashSet<Entity>>,
    /// Reverse lookup used to remove despawned pieces without their component data.
    entity_cells: HashMap<Entity, IVec3>,
    /// Undirected structural connections created by successful snap placement.
    connections: HashMap<Entity, HashSet<Entity>>,
    /// Cell size in world units.
    pub cell_size: f32,
}

impl BuildingGrid {
    /// Convert world position to grid cell.
    pub fn world_to_cell(&self, pos: Vec3) -> IVec3 {
        let cell_size = if self.cell_size > 0.0 {
            self.cell_size
        } else {
            2.0
        };
        IVec3::new(
            (pos.x / cell_size).floor() as i32,
            (pos.y / cell_size).floor() as i32,
            (pos.z / cell_size).floor() as i32,
        )
    }

    /// Convert grid cell to world position (center of cell).
    pub fn cell_to_world(&self, cell: IVec3) -> Vec3 {
        let cell_size = if self.cell_size > 0.0 {
            self.cell_size
        } else {
            2.0
        };
        Vec3::new(
            (cell.x as f32 + 0.5) * cell_size,
            (cell.y as f32 + 0.5) * cell_size,
            (cell.z as f32 + 0.5) * cell_size,
        )
    }

    /// Insert a piece into the grid.
    pub fn insert(&mut self, cell: IVec3, entity: Entity) {
        if let Some(previous_cell) = self.entity_cells.insert(entity, cell) {
            if let Some(occupants) = self.cells.get_mut(&previous_cell) {
                occupants.remove(&entity);
                if occupants.is_empty() {
                    self.cells.remove(&previous_cell);
                }
            }
        }
        self.cells.entry(cell).or_default().insert(entity);
        self.connections.entry(entity).or_default();
    }

    /// Check if a cell is occupied.
    pub fn is_occupied(&self, cell: IVec3) -> bool {
        self.cells
            .get(&cell)
            .is_some_and(|entities| !entities.is_empty())
    }

    /// Add an undirected structural edge between two snapped pieces.
    pub fn connect(&mut self, a: Entity, b: Entity) {
        if a == b || !self.entity_cells.contains_key(&a) || !self.entity_cells.contains_key(&b) {
            return;
        }
        self.connections.entry(a).or_default().insert(b);
        self.connections.entry(b).or_default().insert(a);
    }

    /// Return the structural neighbors of an entity.
    pub fn neighbors(&self, entity: Entity) -> Vec<Entity> {
        self.connections
            .get(&entity)
            .map(|neighbors| neighbors.iter().copied().collect())
            .unwrap_or_default()
    }

    /// Remove an entity, its occupied cell, and all structural edges.
    pub fn remove_entity(&mut self, entity: Entity) -> Vec<Entity> {
        if let Some(cell) = self.entity_cells.remove(&entity) {
            if let Some(occupants) = self.cells.get_mut(&cell) {
                occupants.remove(&entity);
                if occupants.is_empty() {
                    self.cells.remove(&cell);
                }
            }
        }
        self.disconnect_entity(entity)
    }

    fn disconnect_entity(&mut self, entity: Entity) -> Vec<Entity> {
        let neighbors: Vec<_> = self
            .connections
            .remove(&entity)
            .map(|neighbors| neighbors.into_iter().collect())
            .unwrap_or_default();
        for neighbor in &neighbors {
            if let Some(edges) = self.connections.get_mut(neighbor) {
                edges.remove(&entity);
            }
        }
        neighbors
    }
}

#[cfg(test)]
mod building_grid_tests {
    use super::*;

    #[test]
    fn removing_one_piece_preserves_other_occupants_in_the_same_cell() {
        let mut grid = BuildingGrid::default();
        let cell = IVec3::ZERO;
        let first = Entity::from_raw_u32(1).unwrap();
        let second = Entity::from_raw_u32(2).unwrap();

        grid.insert(cell, first);
        grid.insert(cell, second);
        grid.connect(first, second);

        assert_eq!(grid.cells[&cell].len(), 2);
        assert_eq!(grid.remove_entity(second), vec![first]);
        assert!(grid.is_occupied(cell));
        assert!(grid.neighbors(first).is_empty());
    }
}

/// A snap point in world space, indexed for quick lookup.
#[derive(Clone, Debug)]
pub struct IndexedSnapPoint {
    /// Entity this snap point belongs to.
    pub entity: Entity,
    /// Piece type of the owner.
    pub piece_type: PieceTypeId,
    /// Index of this snap point in the piece definition.
    pub snap_index: usize,
    /// World position of the snap point.
    pub world_position: Vec3,
    /// World-space direction (after rotation).
    pub world_direction: Vec3,
    /// Snap group for compatibility checking.
    pub snap_group: SnapGroup,
}

/// Spatial hash index for snap points.
#[derive(Resource, Default)]
pub struct SnapPointIndex {
    /// Snap points organized by grid cell for O(1) queries.
    cells: HashMap<IVec3, Vec<IndexedSnapPoint>>,
    /// Cell size for the spatial hash (smaller than building grid for precision).
    cell_size: f32,
}

impl SnapPointIndex {
    /// Create a new snap point index with the given cell size.
    pub fn new(cell_size: f32) -> Self {
        Self {
            cells: HashMap::new(),
            cell_size,
        }
    }

    /// Convert world position to index cell.
    fn world_to_cell(&self, pos: Vec3) -> IVec3 {
        let cell_size = if self.cell_size > 0.0 {
            self.cell_size
        } else {
            1.0
        };
        IVec3::new(
            (pos.x / cell_size).floor() as i32,
            (pos.y / cell_size).floor() as i32,
            (pos.z / cell_size).floor() as i32,
        )
    }

    /// Add a snap point to the index.
    pub fn insert(&mut self, snap_point: IndexedSnapPoint) {
        let cell = self.world_to_cell(snap_point.world_position);
        self.cells.entry(cell).or_default().push(snap_point);
    }

    /// Remove all snap points belonging to an entity.
    pub fn remove_entity(&mut self, entity: Entity) {
        for points in self.cells.values_mut() {
            points.retain(|p| p.entity != entity);
        }
        // Clean up empty cells
        self.cells.retain(|_, v| !v.is_empty());
    }

    /// Clear the entire index.
    pub fn clear(&mut self) {
        self.cells.clear();
    }

    /// Query snap points within a radius of a world position.
    pub fn query_radius(&self, center: Vec3, radius: f32) -> Vec<&IndexedSnapPoint> {
        let cell_size = if self.cell_size > 0.0 {
            self.cell_size
        } else {
            1.0
        };
        let cell_radius = (radius / cell_size).ceil() as i32;
        let center_cell = self.world_to_cell(center);

        let mut results = Vec::new();
        let radius_sq = radius * radius;

        // Check all cells within radius
        for dx in -cell_radius..=cell_radius {
            for dy in -cell_radius..=cell_radius {
                for dz in -cell_radius..=cell_radius {
                    let cell =
                        IVec3::new(center_cell.x + dx, center_cell.y + dy, center_cell.z + dz);

                    if let Some(points) = self.cells.get(&cell) {
                        for point in points {
                            let dist_sq = center.distance_squared(point.world_position);
                            if dist_sq <= radius_sq {
                                results.push(point);
                            }
                        }
                    }
                }
            }
        }

        results
    }

    /// Get the number of indexed snap points.
    pub fn len(&self) -> usize {
        self.cells.values().map(|v| v.len()).sum()
    }

    /// Check if the index is empty.
    pub fn is_empty(&self) -> bool {
        self.cells.is_empty()
    }
}

/// System to update the snap point index when pieces are added/removed.
pub fn update_snap_point_index(
    mut snap_index: ResMut<SnapPointIndex>,
    registry: Res<super::types::BuildingPieceRegistry>,
    added_pieces: Query<(Entity, &BuildingPiece, &Transform), Added<BuildingPiece>>,
    mut removed_pieces: RemovedComponents<BuildingPiece>,
) {
    // Remove snap points for despawned pieces
    for entity in removed_pieces.read() {
        snap_index.remove_entity(entity);
    }

    // Add snap points for new pieces
    for (entity, piece, transform) in added_pieces.iter() {
        let Some(def) = registry.get(piece.piece_type) else {
            continue;
        };

        let rotation = Quat::from_rotation_y((piece.rotation as f32) * std::f32::consts::FRAC_PI_2);

        for (index, snap_def) in def.snap_points.iter().enumerate() {
            // Transform snap point to world space
            let local_pos = snap_def.local_offset;
            let world_pos = transform.translation + rotation * local_pos;
            let world_dir = rotation * snap_def.direction;

            snap_index.insert(IndexedSnapPoint {
                entity,
                piece_type: piece.piece_type,
                snap_index: index,
                world_position: world_pos,
                world_direction: world_dir,
                snap_group: snap_def.snap_group,
            });
        }
    }
}
