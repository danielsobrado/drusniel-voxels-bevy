//! Core types for the building system.

use bevy::prelude::*;
use std::collections::HashMap;

// ============================================================================
// Snap Result Types (needed by BuildingState)
// ============================================================================

/// Result of snap point detection.
#[derive(Clone, Debug)]
pub struct SnapResult {
    /// The target snap point on the existing piece.
    pub target_snap: SnapTarget,
    /// The snap point on the new piece that connects.
    pub source_snap_index: usize,
    /// Computed world position for the new piece.
    pub world_position: Vec3,
    /// Computed rotation for the new piece.
    pub world_rotation: Quat,
    /// Score of this snap (higher is better).
    pub score: f32,
}

/// Information about the snap target on an existing piece.
#[derive(Clone, Debug)]
pub struct SnapTarget {
    /// Entity of the piece being snapped to.
    pub entity: Entity,
    /// Type of the target piece.
    pub piece_type: PieceTypeId,
    /// Index of the snap point on the target piece.
    pub snap_index: usize,
    /// World position of the target snap point.
    pub position: Vec3,
    /// World direction of the target snap point.
    pub direction: Vec3,
    /// Snap group of the target.
    pub snap_group: SnapGroup,
}

// ============================================================================
// Core Building Types
// ============================================================================

/// Unique identifier for building piece types.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct PieceTypeId(pub u32);

/// Categories of building pieces.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum PieceCategory {
    Foundation,
    Wall,
    Floor,
    Ceiling,
    Roof,
    Stairs,
    Door,
    Window,
    Pillar,
    Beam,
    Fence,
}

/// Groups of snap points that can connect together.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum SnapGroup {
    /// Floor/foundation edges connect to each other
    FloorEdge,
    /// Wall bottoms connect to floor edges
    WallBottom,
    /// Wall tops connect to ceilings and other walls
    WallTop,
    /// Wall sides connect to each other
    WallSide,
    /// Roof edges connect to walls and other roofs
    RoofEdge,
    /// Generic connection point
    Generic,
}

impl SnapGroup {
    /// Check if two snap groups are compatible.
    pub fn is_compatible_with(&self, other: &SnapGroup) -> bool {
        use SnapGroup::*;
        matches!(
            (self, other),
            // Floor edges connect to each other and wall bottoms
            (FloorEdge, FloorEdge) | (FloorEdge, WallBottom) | (WallBottom, FloorEdge) |
            // Wall tops connect to each other and ceilings
            (WallTop, WallTop) | (WallTop, RoofEdge) | (RoofEdge, WallTop) |
            // Wall sides connect to each other
            (WallSide, WallSide) |
            // Roof edges connect
            (RoofEdge, RoofEdge) |
            // Generic connects to anything
            (Generic, _) | (_, Generic)
        )
    }
}

/// Definition of a snap point on a building piece.
#[derive(Clone, Debug)]
pub struct SnapPointDef {
    /// Position relative to the piece's origin.
    pub local_offset: Vec3,
    /// Outward-facing direction (normal) of the snap point.
    pub direction: Vec3,
    /// Snap group this point belongs to.
    pub snap_group: SnapGroup,
    /// Piece types that can connect to this snap point.
    pub compatible_pieces: Vec<PieceTypeId>,
}

impl SnapPointDef {
    /// Create a new snap point definition.
    pub fn new(offset: Vec3, direction: Vec3, group: SnapGroup) -> Self {
        Self {
            local_offset: offset,
            direction: direction.normalize(),
            snap_group: group,
            compatible_pieces: Vec::new(),
        }
    }

    /// Add compatible piece types.
    pub fn with_compatible(mut self, pieces: Vec<PieceTypeId>) -> Self {
        self.compatible_pieces = pieces;
        self
    }
}

/// Definition of a building piece type.
#[derive(Clone, Debug)]
pub struct PieceDefinition {
    /// Unique identifier.
    pub id: PieceTypeId,
    /// Display name.
    pub name: String,
    /// Category for UI organization.
    pub category: PieceCategory,
    /// Bounding box dimensions.
    pub dimensions: Vec3,
    /// Snap points on this piece.
    pub snap_points: Vec<SnapPointDef>,
    /// Path to the mesh asset.
    pub mesh_path: Option<String>,
    /// Whether this piece can be placed on terrain (grounded).
    pub can_ground: bool,
}

impl PieceDefinition {
    /// Create a basic wall piece (2m wide x 2m tall x 0.2m thick).
    pub fn wall(id: u32, name: &str) -> Self {
        let piece_id = PieceTypeId(id);
        Self {
            id: piece_id,
            name: name.to_string(),
            category: PieceCategory::Wall,
            dimensions: Vec3::new(2.0, 2.0, 0.2),
            snap_points: vec![
                // Bottom edge (connects to floor)
                SnapPointDef::new(Vec3::new(0.0, 0.0, 0.0), Vec3::NEG_Y, SnapGroup::WallBottom),
                // Top edge (connects to ceiling/roof)
                SnapPointDef::new(Vec3::new(0.0, 2.0, 0.0), Vec3::Y, SnapGroup::WallTop),
                // Left edge
                SnapPointDef::new(Vec3::new(-1.0, 1.0, 0.0), Vec3::NEG_X, SnapGroup::WallSide),
                // Right edge
                SnapPointDef::new(Vec3::new(1.0, 1.0, 0.0), Vec3::X, SnapGroup::WallSide),
            ],
            mesh_path: None,
            can_ground: false,
        }
    }

    /// Create a floor/foundation piece (2m x 2m).
    pub fn floor(id: u32, name: &str) -> Self {
        let piece_id = PieceTypeId(id);
        Self {
            id: piece_id,
            name: name.to_string(),
            category: PieceCategory::Floor,
            dimensions: Vec3::new(2.0, 0.2, 2.0),
            snap_points: vec![
                // Four edges for connecting to other floors/walls
                SnapPointDef::new(Vec3::new(0.0, 0.0, -1.0), Vec3::NEG_Z, SnapGroup::FloorEdge),
                SnapPointDef::new(Vec3::new(0.0, 0.0, 1.0), Vec3::Z, SnapGroup::FloorEdge),
                SnapPointDef::new(Vec3::new(-1.0, 0.0, 0.0), Vec3::NEG_X, SnapGroup::FloorEdge),
                SnapPointDef::new(Vec3::new(1.0, 0.0, 0.0), Vec3::X, SnapGroup::FloorEdge),
                // Corner points for diagonal connections
                SnapPointDef::new(Vec3::new(-1.0, 0.0, -1.0), Vec3::new(-1.0, 0.0, -1.0).normalize(), SnapGroup::FloorEdge),
                SnapPointDef::new(Vec3::new(1.0, 0.0, -1.0), Vec3::new(1.0, 0.0, -1.0).normalize(), SnapGroup::FloorEdge),
                SnapPointDef::new(Vec3::new(-1.0, 0.0, 1.0), Vec3::new(-1.0, 0.0, 1.0).normalize(), SnapGroup::FloorEdge),
                SnapPointDef::new(Vec3::new(1.0, 0.0, 1.0), Vec3::new(1.0, 0.0, 1.0).normalize(), SnapGroup::FloorEdge),
            ],
            mesh_path: None,
            can_ground: true,
        }
    }

    /// Create a fence piece (2m wide x 1m tall).
    pub fn fence(id: u32, name: &str) -> Self {
        let piece_id = PieceTypeId(id);
        Self {
            id: piece_id,
            name: name.to_string(),
            category: PieceCategory::Fence,
            dimensions: Vec3::new(2.0, 1.0, 0.1),
            snap_points: vec![
                // Bottom (can connect to floor edge)
                SnapPointDef::new(Vec3::new(0.0, 0.0, 0.0), Vec3::NEG_Y, SnapGroup::WallBottom),
                // Left end
                SnapPointDef::new(Vec3::new(-1.0, 0.5, 0.0), Vec3::NEG_X, SnapGroup::Generic),
                // Right end
                SnapPointDef::new(Vec3::new(1.0, 0.5, 0.0), Vec3::X, SnapGroup::Generic),
            ],
            mesh_path: None,
            can_ground: true,
        }
    }

    /// Create a pillar piece (0.4m x 0.4m x 2m tall).
    pub fn pillar(id: u32, name: &str) -> Self {
        let piece_id = PieceTypeId(id);
        Self {
            id: piece_id,
            name: name.to_string(),
            category: PieceCategory::Pillar,
            dimensions: Vec3::new(0.4, 2.0, 0.4),
            snap_points: vec![
                // Bottom (connects to floor corners)
                SnapPointDef::new(Vec3::ZERO, Vec3::NEG_Y, SnapGroup::FloorEdge),
                // Top (connects to ceiling corners)
                SnapPointDef::new(Vec3::new(0.0, 2.0, 0.0), Vec3::Y, SnapGroup::WallTop),
            ],
            mesh_path: None,
            can_ground: true,
        }
    }
}

/// Registry of all available building pieces.
#[derive(Resource, Default)]
pub struct BuildingPieceRegistry {
    /// All registered piece definitions.
    pub pieces: HashMap<PieceTypeId, PieceDefinition>,
    /// Pieces organized by category for UI.
    pub by_category: HashMap<PieceCategory, Vec<PieceTypeId>>,
}

impl BuildingPieceRegistry {
    /// Register a new piece definition.
    pub fn register(&mut self, piece: PieceDefinition) {
        let id = piece.id;
        let category = piece.category;
        self.pieces.insert(id, piece);
        self.by_category.entry(category).or_default().push(id);
    }

    /// Get a piece definition by ID.
    pub fn get(&self, id: PieceTypeId) -> Option<&PieceDefinition> {
        self.pieces.get(&id)
    }
}

/// Current state of the building system.
#[derive(Resource)]
pub struct BuildingState {
    /// Whether building mode is active.
    pub active: bool,
    /// Currently selected piece type.
    pub selected_piece: Option<PieceTypeId>,
    /// Current rotation (0-3 for 90° increments).
    pub rotation: u8,
    /// Whether snap-to-grid is enabled.
    pub snap_enabled: bool,
    /// Current detected snap point (if any).
    pub current_snap: Option<SnapResult>,
}

impl Default for BuildingState {
    fn default() -> Self {
        Self {
            active: false,
            selected_piece: None,
            rotation: 0,
            snap_enabled: true,
            current_snap: None,
        }
    }
}

impl BuildingState {
    /// Get the rotation as a quaternion.
    pub fn rotation_quat(&self) -> Quat {
        Quat::from_rotation_y((self.rotation as f32) * std::f32::consts::FRAC_PI_2)
    }

    /// Rotate 90° clockwise.
    pub fn rotate_cw(&mut self) {
        self.rotation = (self.rotation + 1) % 4;
    }

    /// Rotate 90° counter-clockwise.
    pub fn rotate_ccw(&mut self) {
        self.rotation = (self.rotation + 3) % 4;
    }
}

/// Component marking an entity as a placed building piece.
#[derive(Component)]
pub struct BuildingPiece {
    /// Type of this piece.
    pub piece_type: PieceTypeId,
    /// Grid position (for spatial queries).
    pub grid_position: IVec3,
    /// Rotation index (0-3).
    pub rotation: u8,
}

/// Component marking an entity as a building ghost preview.
#[derive(Component)]
pub struct BuildingGhost {
    /// Whether the current position is valid for placement.
    pub valid: bool,
    /// Whether currently snapped to another piece.
    pub snapped: bool,
}

/// Setup the building piece registry with default pieces.
pub fn setup_building_piece_registry(mut registry: ResMut<BuildingPieceRegistry>) {
    // Register basic building pieces
    registry.register(PieceDefinition::floor(1, "Wood Floor 2x2"));
    registry.register(PieceDefinition::wall(2, "Wood Wall"));
    registry.register(PieceDefinition::fence(3, "Wood Fence"));
    registry.register(PieceDefinition::pillar(4, "Wood Pillar"));

    info!(
        "Building piece registry initialized with {} pieces",
        registry.pieces.len()
    );
}
