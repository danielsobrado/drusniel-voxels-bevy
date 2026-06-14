//! Core types for the building system.

use bevy::prelude::*;
use std::collections::HashMap;

use crate::rendering::building_material::BuildingMaterialType;

use super::stability::{SupportClass, SupportProfile};

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
    /// Material type for this piece.
    pub material: BuildingMaterialType,
    /// Structural support tuning for this specific piece.
    pub support_profile: SupportProfile,
}

impl PieceDefinition {
    /// Create a basic wall piece (2m wide x 2m tall x 0.2m thick).
    pub fn wall(id: u32, name: &str, material: BuildingMaterialType) -> Self {
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
            material,
            support_profile: SupportProfile::for_material(material),
        }
    }

    /// Create a floor/foundation piece (2m x 2m).
    pub fn floor(id: u32, name: &str, material: BuildingMaterialType) -> Self {
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
                SnapPointDef::new(
                    Vec3::new(-1.0, 0.0, -1.0),
                    Vec3::new(-1.0, 0.0, -1.0).normalize(),
                    SnapGroup::FloorEdge,
                ),
                SnapPointDef::new(
                    Vec3::new(1.0, 0.0, -1.0),
                    Vec3::new(1.0, 0.0, -1.0).normalize(),
                    SnapGroup::FloorEdge,
                ),
                SnapPointDef::new(
                    Vec3::new(-1.0, 0.0, 1.0),
                    Vec3::new(-1.0, 0.0, 1.0).normalize(),
                    SnapGroup::FloorEdge,
                ),
                SnapPointDef::new(
                    Vec3::new(1.0, 0.0, 1.0),
                    Vec3::new(1.0, 0.0, 1.0).normalize(),
                    SnapGroup::FloorEdge,
                ),
            ],
            mesh_path: None,
            can_ground: true,
            material,
            support_profile: SupportProfile::for_material(material),
        }
    }

    /// Create a fence piece (2m wide x 1m tall).
    pub fn fence(id: u32, name: &str, material: BuildingMaterialType) -> Self {
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
            material,
            support_profile: SupportProfile::for_material(material),
        }
    }

    /// Create a pillar piece (0.4m x 0.4m x 2m tall).
    pub fn pillar(id: u32, name: &str, material: BuildingMaterialType) -> Self {
        let piece_id = PieceTypeId(id);
        let mut definition = Self {
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
            material,
            support_profile: SupportProfile::for_material(material),
        };
        definition.support_profile.decay_per_hop = match material {
            BuildingMaterialType::WoodPlank => 0.05,
            BuildingMaterialType::StoneBrick => 0.08,
            _ => definition.support_profile.decay_per_hop,
        };
        definition
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
    /// Create registry from ContentRegistry
    pub fn from_content_registry(registry: &crate::content::ContentRegistry) -> Self {
        use crate::rendering::building_material::BuildingMaterialType;
        let mut new_registry = Self::default();

        // Sort by legacy piece id so registration order (and the by_category
        // lists the building UI reads) is deterministic across runs. HashMap
        // iteration order is otherwise randomized.
        let mut pieces: Vec<_> = registry.building_pieces.values().collect();
        pieces.sort_by_key(|pc| pc.legacy_piece_type_id.unwrap_or(u32::MAX));

        for pc in pieces {
            let legacy_id = match pc.legacy_piece_type_id {
                Some(id) => id,
                None => continue,
            };

            let piece_id = PieceTypeId(legacy_id);

            let category = match pc.category.to_lowercase().as_str() {
                "foundation" => PieceCategory::Foundation,
                "wall" => PieceCategory::Wall,
                "floor" => PieceCategory::Floor,
                "ceiling" => PieceCategory::Ceiling,
                "roof" => PieceCategory::Roof,
                "stairs" => PieceCategory::Stairs,
                "door" => PieceCategory::Door,
                "window" => PieceCategory::Window,
                "pillar" => PieceCategory::Pillar,
                "beam" => PieceCategory::Beam,
                "fence" => PieceCategory::Fence,
                _ => PieceCategory::Wall,
            };

            let material = match pc.material_type.to_lowercase().as_str() {
                "wood-plank" | "wood_plank" | "wood" | "woodplank" => {
                    BuildingMaterialType::WoodPlank
                }
                "stone-brick" | "stone_brick" | "stone" | "stonebrick" => {
                    BuildingMaterialType::StoneBrick
                }
                "metal-plate" | "metal_plate" | "metal" | "metalplate" => {
                    BuildingMaterialType::MetalPlate
                }
                "thatch" => BuildingMaterialType::Thatch,
                _ => BuildingMaterialType::WoodPlank,
            };

            let mut snap_points = Vec::new();
            for sp in &pc.snap_points {
                let group = match sp.snap_group.to_lowercase().as_str() {
                    "floor-edge" | "floor_edge" => SnapGroup::FloorEdge,
                    "wall-bottom" | "wall_bottom" => SnapGroup::WallBottom,
                    "wall-top" | "wall_top" => SnapGroup::WallTop,
                    "wall-side" | "wall_side" => SnapGroup::WallSide,
                    "roof-edge" | "roof_edge" => SnapGroup::RoofEdge,
                    "generic" => SnapGroup::Generic,
                    _ => SnapGroup::Generic,
                };

                let direction = Vec3::from(sp.direction);
                let direction = if direction.length_squared() > 0.0 {
                    direction.normalize()
                } else {
                    Vec3::Y
                };

                let mut compatible_pieces = Vec::new();
                for comp_id in &sp.compatible_piece_ids {
                    if let Some(target_pc) = registry.building_pieces.get(comp_id) {
                        if let Some(target_legacy_id) = target_pc.legacy_piece_type_id {
                            compatible_pieces.push(PieceTypeId(target_legacy_id));
                        }
                    }
                }

                snap_points.push(SnapPointDef {
                    local_offset: Vec3::from(sp.local_offset),
                    direction,
                    snap_group: group,
                    compatible_pieces,
                });
            }

            let def = PieceDefinition {
                id: piece_id,
                name: pc.name.clone(),
                category,
                dimensions: Vec3::from(pc.dimensions),
                snap_points,
                mesh_path: pc.mesh_path.clone(),
                can_ground: pc.can_ground,
                material,
                support_profile: pc
                    .support_profile
                    .as_ref()
                    .and_then(|profile| {
                        SupportClass::parse(&profile.class).map(|class| SupportProfile {
                            max_support: profile.max_support,
                            decay_per_hop: profile.decay_per_hop,
                            class,
                        })
                    })
                    .unwrap_or_else(|| SupportProfile::for_material(material)),
            };

            new_registry.register(def);
        }

        new_registry
    }

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
    /// Material type of this piece.
    pub material: BuildingMaterialType,
}

/// Component marking an entity as a building ghost preview.
#[derive(Component)]
pub struct BuildingGhost {
    /// Whether the current position is valid for placement.
    pub valid: bool,
    /// Whether currently snapped to another piece.
    pub snapped: bool,
    /// Predicted support value if the current candidate were placed.
    pub stability_value: f32,
    /// Maximum support for the selected piece.
    pub max_support: f32,
    /// Whether the candidate directly touches terrain.
    pub grounded: bool,
}

/// Setup the building piece registry with default pieces.
pub fn setup_building_piece_registry(
    mut registry: ResMut<BuildingPieceRegistry>,
    content_registry: Option<Res<crate::content::ContentRegistry>>,
) {
    if let Some(cr) = content_registry {
        let loaded = BuildingPieceRegistry::from_content_registry(&cr);
        if !loaded.pieces.is_empty() {
            *registry = loaded;
            info!(
                "Building piece registry loaded from ContentRegistry with {} pieces",
                registry.pieces.len()
            );
            return;
        }
    }

    use BuildingMaterialType::*;

    // Wood pieces
    registry.register(PieceDefinition::floor(1, "Wood Floor", WoodPlank));
    registry.register(PieceDefinition::wall(2, "Wood Wall", WoodPlank));
    registry.register(PieceDefinition::fence(3, "Wood Fence", WoodPlank));
    registry.register(PieceDefinition::pillar(4, "Wood Pillar", WoodPlank));

    // Stone pieces
    registry.register(PieceDefinition::floor(10, "Stone Floor", StoneBrick));
    registry.register(PieceDefinition::wall(11, "Stone Wall", StoneBrick));
    registry.register(PieceDefinition::pillar(12, "Stone Pillar", StoneBrick));

    // Metal pieces
    registry.register(PieceDefinition::floor(20, "Metal Floor", MetalPlate));
    registry.register(PieceDefinition::wall(21, "Metal Wall", MetalPlate));

    // Thatch pieces
    registry.register(PieceDefinition::wall(30, "Thatch Wall", Thatch));

    info!(
        "Building piece registry initialized with {} pieces",
        registry.pieces.len()
    );
}
