use bevy::prelude::Resource;
use std::collections::HashMap;

use super::types::*;

#[derive(Resource, Clone, Debug, Default)]
pub struct ContentRegistry {
    pub material_types: HashMap<String, MaterialTypeContent>,
    pub materials: HashMap<String, MaterialContent>,
    pub palettes: HashMap<String, MaterialPaletteContent>,
    pub texture_slots: HashMap<String, TextureSlotContent>,
    pub atlas_mappings: HashMap<String, AtlasMappingContent>,
    pub biomes: HashMap<String, BiomeContent>,
    pub props: HashMap<String, PropContent>,
    pub building_pieces: HashMap<String, BuildingPieceContent>,
    pub protected_areas: HashMap<String, ProtectedAreaContent>,
    pub objectives: HashMap<String, ObjectiveContent>,
}

impl ContentRegistry {
    pub fn merge(&mut self, other: ContentRegistry) {
        self.material_types.extend(other.material_types);
        self.materials.extend(other.materials);
        self.palettes.extend(other.palettes);
        self.texture_slots.extend(other.texture_slots);
        self.atlas_mappings.extend(other.atlas_mappings);
        self.biomes.extend(other.biomes);
        self.props.extend(other.props);
        self.building_pieces.extend(other.building_pieces);
        self.protected_areas.extend(other.protected_areas);
        self.objectives.extend(other.objectives);
    }
}
