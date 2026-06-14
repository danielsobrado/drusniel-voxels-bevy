use bevy::prelude::*;
use std::path::Path;

use super::loader::load_content_registry;
use super::validate::validate_content_registry;
use crate::rendering::array_loader::AtlasMapping;
use crate::voxel::materials::MaterialCatalog;
use crate::voxel::terrain::BiomeTable;

pub struct ContentPlugin;

impl Plugin for ContentPlugin {
    fn build(&self, app: &mut App) {
        let strict_mode = std::env::var("DRUSNIEL_CONTENT_STRICT").unwrap_or_default() == "1";
        let content_dir = Path::new("assets/content");

        let registry = match load_content_registry(content_dir, strict_mode) {
            Ok(reg) => reg,
            Err(e) => {
                error!("Failed to load content registry: {}", e);
                if strict_mode {
                    panic!("Strict content loading failed: {:?}", e);
                }
                super::defaults::get_default_registry()
            }
        };

        let report = validate_content_registry(&registry);

        if report.has_errors() {
            for err in &report.errors {
                error!(
                    "Validation Error: [{}] at {}: {}",
                    err.code, err.path, err.message
                );
            }
            if strict_mode {
                panic!(
                    "Strict content validation failed with {} errors.",
                    report.errors.len()
                );
            }
        }

        for warn in &report.warnings {
            warn!(
                "Validation Warning: [{}] at {}: {}",
                warn.code, warn.path, warn.message
            );
        }

        info!(
            "Content registry loaded: materials={}, material_types={}, palettes={}, texture_slots={}, atlas_mappings={}, biomes={}, props={}, building_pieces={}, protected_areas={}, objectives={}. Issues: {} errors, {} warnings.",
            registry.materials.len(),
            registry.material_types.len(),
            registry.palettes.len(),
            registry.texture_slots.len(),
            registry.atlas_mappings.len(),
            registry.biomes.len(),
            registry.props.len(),
            registry.building_pieces.len(),
            registry.protected_areas.len(),
            registry.objectives.len(),
            report.errors.len(),
            report.warnings.len()
        );

        let biome_table = match BiomeTable::from_content_registry(&registry) {
            Ok(table) => table,
            Err(e) => {
                error!("Failed to build BiomeTable from registry: {}", e);
                if strict_mode {
                    panic!("Strict content biome table build failed: {:?}", e);
                }
                BiomeTable::default()
            }
        };

        // Map and insert catalog resources
        match MaterialCatalog::from_content_registry(&registry) {
            Ok(catalog) => {
                app.insert_resource(catalog);
            }
            Err(e) => {
                error!("Failed to build MaterialCatalog from registry: {}", e);
                if strict_mode {
                    panic!("Strict content catalog build failed: {:?}", e);
                }
                app.insert_resource(MaterialCatalog::default());
            }
        }

        if let Some(mapping) = AtlasMapping::from_content_registry(&registry) {
            app.insert_resource(mapping);
        } else {
            error!("Failed to build AtlasMapping from registry.");
            if strict_mode {
                panic!("Strict content atlas mapping build failed.");
            }
            app.insert_resource(AtlasMapping::default());
        }

        app.insert_resource(registry);
        app.insert_resource(report);
        app.insert_resource(biome_table);
    }
}
