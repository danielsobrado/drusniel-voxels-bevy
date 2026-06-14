use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MaterialContent {
    pub id: String,
    pub legacy_material_id: Option<u16>,
    pub name: String,
    pub material_type_id: String,
    pub default_voxel: Option<String>,
    pub color_rgb: [u8; 3],
    pub metallic: f32,
    pub smooth: f32,
    pub emissive: f32,
    pub surface_transmission: f32,
    pub absorption_length: f32,
    pub scatter_length: f32,
    pub index_of_refraction: f32,
    pub phase: f32,
    pub strength: f32,
    pub transparent: bool,
    pub liquid: bool,
    pub solid: bool,
    pub diggable: bool,
    pub paintable: bool,
    pub texture_slot_id: Option<String>,
    pub allow_transparent_digging: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MaterialTypeContent {
    pub id: String,
    pub name: String,
    pub material_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MaterialPaletteContent {
    pub id: String,
    pub name: String,
    pub material_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TextureSlotContent {
    pub id: String,
    pub name: String,
    pub slot_index: u32,
    pub material_id: Option<String>,
    pub top_tile: Option<u32>,
    pub side_tile: Option<u32>,
    pub bottom_tile: Option<u32>,
    pub tags: Vec<String>,
    pub alias: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AtlasMappingContent {
    pub id: String,
    pub name: String,
    pub material_id: String,
    pub top: u32,
    pub side: u32,
    pub bottom: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BiomeContent {
    pub id: String,
    pub legacy_biome_id: u8,
    pub name: String,
    pub selection_priority: u8,
    pub biome_noise_min: Option<f32>,
    pub biome_noise_max: Option<f32>,
    pub detail_noise_min: Option<f32>,
    pub detail_noise_max: Option<f32>,
    pub default_material_id: String,
    pub water_material_id: Option<String>,
    pub surface_material_ids: Vec<String>,
    pub underground_material_ids: Vec<String>,
    pub shoreline_surface_material_ids: Vec<String>,
    pub shoreline_underground_material_ids: Vec<String>,
    pub prop_palette_ids: Vec<String>,
    pub tags: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PropContent {
    pub id: String,
    pub name: String,
    pub category: String,
    pub asset_path: Option<String>,
    pub biome_ids: Vec<String>,
    pub footprint: [f32; 3],
    pub spawn_weight: f32,
    pub can_spawn_on_material_ids: Vec<String>,
    pub blocked_by_protected_area: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SnapPointContent {
    pub id: String,
    pub local_offset: [f32; 3],
    pub direction: [f32; 3],
    pub snap_group: String,
    pub compatible_groups: Vec<String>,
    pub compatible_piece_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SupportProfileContent {
    pub max_support: f32,
    pub decay_per_hop: f32,
    pub class: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BuildingPieceContent {
    pub id: String,
    pub legacy_piece_type_id: Option<u32>,
    pub name: String,
    pub category: String,
    pub dimensions: [f32; 3],
    pub snap_points: Vec<SnapPointContent>,
    pub mesh_path: Option<String>,
    pub can_ground: bool,
    pub material_type: String,
    pub material_id: Option<String>,
    #[serde(default)]
    pub support_profile: Option<SupportProfileContent>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProtectedAreaShapeContent {
    #[serde(rename = "box")]
    Box {
        center: [f32; 3],
        half_extents: [f32; 3],
    },
    Cylinder {
        center: [f32; 3],
        radius: f32,
        height: f32,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ProtectedAreaContent {
    pub id: String,
    pub name: String,
    pub shape: ProtectedAreaShapeContent,
    pub rule: String,
    pub material_overrides: Vec<String>,
    pub allow_building: bool,
    pub allow_terrain_edit: bool,
    pub allow_prop_edit: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ObjectiveContent {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub required_material_ids: Vec<String>,
    pub required_prop_ids: Vec<String>,
    pub required_biome_ids: Vec<String>,
    pub next_objective_ids: Vec<String>,
    pub notes: Option<String>,
}
