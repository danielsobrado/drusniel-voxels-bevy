use crate::voxel::types::VoxelType;
use bevy::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct MaterialId(pub u16);

impl MaterialId {
    pub const AIR: Self = Self(0);

    pub const fn from_voxel(voxel: VoxelType) -> Self {
        Self(voxel as u16)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoxelMaterialDefinition {
    pub id: MaterialId,
    pub name: String,
    pub material_type_id: String,
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
    pub default_voxel: VoxelType,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialTypeDefinition {
    pub id: String,
    pub name: String,
    pub material_ids: Vec<MaterialId>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialPaletteDefinition {
    pub id: String,
    pub name: String,
    pub material_ids: Vec<MaterialId>,
}

#[derive(Resource, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialCatalog {
    pub material_types: Vec<MaterialTypeDefinition>,
    pub materials: Vec<VoxelMaterialDefinition>,
    pub palettes: Vec<MaterialPaletteDefinition>,
    pub active_material_id: MaterialId,
}

impl Default for MaterialCatalog {
    fn default() -> Self {
        let materials = vec![
            material(
                MaterialId(0),
                "Air",
                "system",
                [0, 0, 0],
                0.0,
                VoxelType::Air,
            ),
            material(
                MaterialId(1),
                "Top Soil",
                "terrain",
                [83, 128, 62],
                1.0,
                VoxelType::TopSoil,
            ),
            material(
                MaterialId(2),
                "Sub Soil",
                "terrain",
                [112, 78, 48],
                1.0,
                VoxelType::SubSoil,
            ),
            material(
                MaterialId(3),
                "Rock",
                "terrain",
                [112, 112, 118],
                1.8,
                VoxelType::Rock,
            ),
            material(
                MaterialId(4),
                "Bedrock",
                "terrain",
                [52, 52, 58],
                10.0,
                VoxelType::Bedrock,
            ),
            material(
                MaterialId(5),
                "Sand",
                "terrain",
                [207, 184, 119],
                0.6,
                VoxelType::Sand,
            ),
            material(
                MaterialId(6),
                "Clay",
                "terrain",
                [142, 97, 86],
                0.8,
                VoxelType::Clay,
            ),
            transparent_material(
                MaterialId(7),
                "Water",
                "water",
                [66, 152, 210],
                0.3,
                VoxelType::Water,
            ),
            material(
                MaterialId(8),
                "Wood",
                "organic",
                [121, 82, 45],
                1.0,
                VoxelType::Wood,
            ),
            material(
                MaterialId(9),
                "Leaves",
                "organic",
                [65, 134, 59],
                0.4,
                VoxelType::Leaves,
            ),
            material(
                MaterialId(10),
                "Dungeon Wall",
                "dungeon",
                [84, 82, 96],
                2.0,
                VoxelType::DungeonWall,
            ),
            material(
                MaterialId(11),
                "Dungeon Floor",
                "dungeon",
                [91, 87, 78],
                1.6,
                VoxelType::DungeonFloor,
            ),
        ];

        let material_types = vec![
            material_type("system", "System", &[0]),
            material_type("terrain", "Terrain", &[1, 2, 3, 4, 5, 6]),
            material_type("water", "Water and Ice", &[7]),
            material_type("organic", "Organic", &[8, 9]),
            material_type("dungeon", "Dungeon", &[10, 11]),
        ];

        Self {
            material_types,
            materials,
            palettes: vec![MaterialPaletteDefinition {
                id: "default".to_string(),
                name: "Default".to_string(),
                material_ids: (1..=11).map(MaterialId).collect(),
            }],
            active_material_id: MaterialId(1),
        }
    }
}

impl MaterialCatalog {
    pub fn material(&self, id: MaterialId) -> Option<&VoxelMaterialDefinition> {
        self.materials.iter().find(|material| material.id == id)
    }

    pub fn material_mut(&mut self, id: MaterialId) -> Option<&mut VoxelMaterialDefinition> {
        self.materials.iter_mut().find(|material| material.id == id)
    }

    pub fn contains_material(&self, id: MaterialId) -> bool {
        self.material(id).is_some()
    }

    pub fn default_material_for_voxel(&self, voxel: VoxelType) -> MaterialId {
        let id = MaterialId::from_voxel(voxel);
        if self.contains_material(id) {
            id
        } else {
            MaterialId::AIR
        }
    }

    pub fn set_active_material(&mut self, id: MaterialId) -> bool {
        if self.contains_material(id) {
            self.active_material_id = id;
            true
        } else {
            false
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MaterialReplaceSummary {
    pub changed: u64,
    pub no_change: u64,
    pub skipped: u64,
    pub dirty_chunks: Vec<IVec3>,
}

fn material(
    id: MaterialId,
    name: &str,
    material_type_id: &str,
    color_rgb: [u8; 3],
    strength: f32,
    default_voxel: VoxelType,
) -> VoxelMaterialDefinition {
    VoxelMaterialDefinition {
        id,
        name: name.to_string(),
        material_type_id: material_type_id.to_string(),
        color_rgb,
        metallic: 0.0,
        smooth: 0.45,
        emissive: 0.0,
        surface_transmission: 0.0,
        absorption_length: 0.0,
        scatter_length: 0.0,
        index_of_refraction: 1.0,
        phase: 0.0,
        strength,
        default_voxel,
    }
}

fn transparent_material(
    id: MaterialId,
    name: &str,
    material_type_id: &str,
    color_rgb: [u8; 3],
    strength: f32,
    default_voxel: VoxelType,
) -> VoxelMaterialDefinition {
    VoxelMaterialDefinition {
        surface_transmission: 0.72,
        absorption_length: 24.0,
        scatter_length: 96.0,
        index_of_refraction: 1.33,
        smooth: 0.85,
        ..material(
            id,
            name,
            material_type_id,
            color_rgb,
            strength,
            default_voxel,
        )
    }
}

fn material_type(id: &str, name: &str, material_ids: &[u16]) -> MaterialTypeDefinition {
    MaterialTypeDefinition {
        id: id.to_string(),
        name: name.to_string(),
        material_ids: material_ids.iter().copied().map(MaterialId).collect(),
    }
}
