//! Azgaar Fantasy Map Generator Full JSON import for Bevy `WorldSource`.
//!
//! Port of `tools/clod-poc/src/world_source/azgaar/` (itself migrated from SimCity-DnD).

mod biome_catalog;
mod heightmap_adapter;
mod json_importer;
mod macro_world_generator;
mod macro_world_source;

pub use biome_catalog::{
    AzgaarBiomeDefinition, AzgaarTerrainClass, create_azgaar_biome_definitions,
};
pub use heightmap_adapter::{AzgaarHeightmapOptions, azgaar_macro_to_luminance};
pub use json_importer::{
    AzgaarImportConfig, AzgaarImportOptions, AzgaarImportedWorld, import_azgaar_full_json,
    is_azgaar_full_json,
};
pub use macro_world_generator::{AzgaarMacroWorldGenerator, AzgaarProceduralMetadata};
pub use macro_world_source::{
    AZGAAR_MACRO_SOURCE_KIND, AzgaarMacroWorldSource, DecodedMacroAtlas, MacroAtlasPayload,
    create_macro_atlas_payload, decode_macro_atlas,
};

use crate::world::source::biome_region_field::BiomeId;
use crate::world::source::world_source::{
    TerrainFieldConfig, WorldSource, WorldSourceBounds, WorldSourceMetadata,
};

/// `WorldSource` backed by an imported Azgaar macro atlas.
pub struct AzgaarWorldSource {
    metadata: WorldSourceMetadata,
    generator: AzgaarMacroWorldGenerator,
    luminance: Vec<f32>,
    atlas_width: u32,
    atlas_height: u32,
    world_cells: f32,
    base_m: f32,
    span_m: f32,
    use_macro_generator_heights: bool,
    biome_by_tile: Vec<(u8, BiomeId)>,
}

pub struct AzgaarWorldSourceOptions {
    pub world_cells: f32,
    pub terrain: TerrainFieldConfig,
    pub base_m: f32,
    pub span_m: f32,
    pub use_macro_generator_heights: bool,
}

impl Default for AzgaarWorldSourceOptions {
    fn default() -> Self {
        Self {
            world_cells: 256.0,
            terrain: TerrainFieldConfig::default(),
            base_m: 0.0,
            span_m: 90.0,
            use_macro_generator_heights: false,
        }
    }
}

fn terrain_class_to_biome(class: AzgaarTerrainClass) -> BiomeId {
    match class {
        AzgaarTerrainClass::Water => BiomeId::Ocean,
        AzgaarTerrainClass::Forest => BiomeId::Forest,
        AzgaarTerrainClass::Swamp => BiomeId::Swamp,
        AzgaarTerrainClass::Snow => BiomeId::Mountain,
        AzgaarTerrainClass::Desert => BiomeId::Plains,
        AzgaarTerrainClass::Plains => BiomeId::Meadows,
    }
}

impl AzgaarWorldSource {
    pub fn new(source: AzgaarMacroWorldSource, options: AzgaarWorldSourceOptions) -> Result<Self, String> {
        let luminance = azgaar_macro_to_luminance(&source)?;
        let generator = AzgaarMacroWorldGenerator::new(
            source.clone(),
            AzgaarProceduralMetadata {
                seed: options.terrain.seed,
                version: 1,
                height_scale: 1.0,
                sea_level: options.terrain.sea_level,
            },
        )?;
        let biome_by_tile = source
            .biomes
            .iter()
            .map(|definition| (definition.tile_id, terrain_class_to_biome(definition.terrain_class)))
            .collect();
        let metadata = WorldSourceMetadata {
            seed: options.terrain.seed,
            sea_level: options.terrain.sea_level,
            bounds: WorldSourceBounds::RadiusM(options.world_cells),
            ocean_rim: false,
            terrain: options.terrain,
        };
        Ok(Self {
            metadata,
            generator,
            luminance,
            atlas_width: source.atlas.width,
            atlas_height: source.atlas.height,
            world_cells: options.world_cells.max(1.0),
            base_m: options.base_m,
            span_m: options.span_m,
            use_macro_generator_heights: options.use_macro_generator_heights,
            biome_by_tile,
        })
    }

    fn to_macro_cell(&self, x: f32, z: f32) -> (f32, f32) {
        let bounds = &self.generator.source().bounds;
        let cell_x = bounds.min_cell_x as f32
            + (x / self.world_cells) * bounds.width_cells as f32;
        let cell_z = bounds.min_cell_z as f32
            + (z / self.world_cells) * bounds.height_cells as f32;
        (cell_x, cell_z)
    }

    fn sample_luminance_height(&self, x: f32, z: f32) -> f32 {
        let u = (x / self.world_cells).clamp(0.0, 1.0);
        let v = (z / self.world_cells).clamp(0.0, 1.0);
        let fx = u * (self.atlas_width.saturating_sub(1) as f32);
        let fy = v * (self.atlas_height.saturating_sub(1) as f32);
        let x0 = fx.floor() as u32;
        let y0 = fy.floor() as u32;
        let x1 = (x0 + 1).min(self.atlas_width.saturating_sub(1));
        let y1 = (y0 + 1).min(self.atlas_height.saturating_sub(1));
        let tx = fx - x0 as f32;
        let ty = fy - y0 as f32;
        let idx = |x: u32, y: u32| (y * self.atlas_width + x) as usize;
        let a = self.luminance[idx(x0, y0)];
        let b = self.luminance[idx(x1, y0)];
        let c = self.luminance[idx(x0, y1)];
        let d = self.luminance[idx(x1, y1)];
        let top = a + (b - a) * tx;
        let bot = c + (d - c) * tx;
        let lum = top + (bot - top) * ty;
        (self.base_m + lum * self.span_m).clamp(1.0, 117.5)
    }
}

impl WorldSource for AzgaarWorldSource {
    fn metadata(&self) -> &WorldSourceMetadata {
        &self.metadata
    }

    fn sample_height(&self, x: f32, z: f32) -> f32 {
        if self.use_macro_generator_heights {
            let (cell_x, cell_z) = self.to_macro_cell(x, z);
            self.generator.sample_height(cell_x, cell_z)
        } else {
            self.sample_luminance_height(x, z)
        }
    }

    fn sample_biome(&self, x: f32, z: f32) -> BiomeId {
        let (cell_x, cell_z) = self.to_macro_cell(x, z);
        let tile_id = self.generator.sample_tile(cell_x.floor() as i32, cell_z.floor() as i32);
        if tile_id == 0 {
            return BiomeId::Ocean;
        }
        self.biome_by_tile
            .iter()
            .find(|(id, _)| *id == tile_id)
            .map(|(_, biome)| *biome)
            .unwrap_or(BiomeId::Meadows)
    }

    fn ocean_mask(&self, x: f32, z: f32) -> f32 {
        if self.sample_height(x, z) < self.metadata.sea_level {
            1.0
        } else {
            0.0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample_document() -> serde_json::Value {
        json!({
            "info": {
                "description": "Azgaar's Fantasy Map Generator output: azgaar.github.io/Fantasy-map-generator",
                "version": "1.99",
                "mapId": "test-map",
                "mapName": "Test Realm",
                "width": 1000,
                "height": 800,
                "seed": "abc123"
            },
            "grid": {
                "cellsX": 2,
                "cellsY": 2,
                "seed": "abc123",
                "cells": [
                    { "i": 0, "h": 0 },
                    { "i": 1, "h": 35 },
                    { "i": 2, "h": 82 },
                    { "i": 3, "h": 45 }
                ]
            },
            "pack": {
                "cells": [
                    { "i": 0, "g": 0, "h": 0, "biome": 0, "p": [250, 200] },
                    { "i": 1, "g": 1, "h": 35, "biome": 1, "p": [750, 200] },
                    { "i": 2, "g": 2, "h": 82, "biome": 2, "p": [250, 600] },
                    { "i": 3, "g": 3, "h": 45, "biome": 3, "p": [750, 600] }
                ]
            },
            "biomesData": {
                "name": ["Marine", "Temperate deciduous forest", "Hot desert", "Wetland"]
            }
        })
    }

    fn import_sample() -> AzgaarImportedWorld {
        let config = AzgaarImportConfig {
            tile_size: 2.0,
            atlas_long_edge: Some(4),
            ocean_transition_kilometers: 50.0,
            min_height: -16.0,
            max_height: 48.0,
            sea_level: 18.0,
            vertical_exaggeration: 1.0,
            relief_exponent: 1.0,
            ..AzgaarImportConfig::default()
        };
        import_azgaar_full_json(&sample_document(), &config, &AzgaarImportOptions::default())
            .expect("import")
    }

    #[test]
    fn detects_and_imports_full_json() {
        let imported = import_sample();
        assert_eq!(imported.base_terrain.kind, AZGAAR_MACRO_SOURCE_KIND);
        assert_eq!(imported.base_terrain.atlas.width, 4);
        assert_eq!(imported.base_terrain.atlas.height, 3);
        let decoded = decode_macro_atlas(&imported.base_terrain).expect("decode");
        assert_eq!(decoded.heights.len(), 12);
        let world = AzgaarWorldSource::new(
            imported.base_terrain,
            AzgaarWorldSourceOptions {
                world_cells: 64.0,
                ..AzgaarWorldSourceOptions::default()
            },
        )
        .expect("world source");
        let h = world.sample_height(32.0, 32.0);
        assert!(h.is_finite());
    }

    #[test]
    fn rejects_corrupt_macro_atlas_during_world_source_construction() {
        let mut imported = import_sample();
        imported.base_terrain.atlas.height_data.data = "not-base64".to_string();

        let result = AzgaarWorldSource::new(
            imported.base_terrain,
            AzgaarWorldSourceOptions::default(),
        );

        assert!(result.is_err());
    }
}
