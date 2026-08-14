use serde::{Deserialize, Serialize};

use super::macro_world_source::{
    AzgaarImportSummary, AzgaarMacroWorldSource, build_azgaar_import_summary,
    create_azgaar_macro_world_source,
};

#[derive(Debug, Clone)]
pub struct AzgaarImportConfig {
    pub tile_size: f64,
    pub atlas_long_edge: Option<u32>,
    pub target_width: Option<u32>,
    pub target_height: Option<u32>,
    pub ocean_transition_kilometers: f64,
    pub min_height: f32,
    pub max_height: f32,
    pub sea_level: f32,
    pub vertical_exaggeration: f32,
    pub relief_exponent: f32,
}

impl Default for AzgaarImportConfig {
    fn default() -> Self {
        Self {
            tile_size: 1.0,
            atlas_long_edge: Some(1024),
            target_width: None,
            target_height: None,
            ocean_transition_kilometers: 50.0,
            min_height: 0.0,
            max_height: 90.0,
            sea_level: 18.0,
            vertical_exaggeration: 1.0,
            relief_exponent: 1.0,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct AzgaarImportOptions {
    pub physical_width_meters: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AzgaarImportedWorld {
    pub format: String,
    pub version: u32,
    pub base_terrain: AzgaarMacroWorldSource,
    pub import_warnings: Vec<String>,
    pub map_name: String,
    pub summary: ImportSummaryDto,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ImportSummaryDto {
    pub atlas_width: u32,
    pub atlas_height: u32,
    pub physical_width_meters: f64,
    pub physical_height_meters: f64,
    pub distance_unit: String,
}

fn valid_grid_dimensions(document: &serde_json::Value) -> Option<(i32, i32)> {
    let cells_x = document
        .pointer("/grid/cellsX")
        .and_then(|value| value.as_i64())
        .filter(|value| (1..=i32::MAX as i64).contains(value))? as i32;
    let cells_y = document
        .pointer("/grid/cellsY")
        .and_then(|value| value.as_i64())
        .filter(|value| (1..=i32::MAX as i64).contains(value))? as i32;
    cells_x.checked_mul(cells_y)?;
    Some((cells_x, cells_y))
}

fn has_valid_grid(document: &serde_json::Value) -> bool {
    let cells = document
        .pointer("/grid/cells")
        .and_then(|value| value.as_array());
    matches!(cells, Some(cells) if !cells.is_empty()) && valid_grid_dimensions(document).is_some()
}

pub fn is_azgaar_full_json(document: &serde_json::Value) -> bool {
    let description = document
        .pointer("/info/description")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    description.contains("azgaar's fantasy map generator") && has_valid_grid(document)
}

fn assert_azgaar_document(document: &serde_json::Value) -> Result<(), String> {
    let description = document
        .pointer("/info/description")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !description.contains("azgaar's fantasy map generator") {
        return Err("The selected JSON is not an Azgaar Full JSON export.".into());
    }
    if !has_valid_grid(document) {
        return Err(
            "Azgaar Full JSON must include non-empty grid cells and supported positive grid dimensions."
                .into(),
        );
    }
    Ok(())
}

fn validate_import_config(config: &AzgaarImportConfig) -> Result<(), String> {
    if !(config.tile_size.is_finite() && config.tile_size > 0.0) {
        return Err("Azgaar tile size must be positive.".into());
    }
    if !(config.ocean_transition_kilometers.is_finite()
        && config.ocean_transition_kilometers >= 0.0)
    {
        return Err("Azgaar ocean transition distance must be non-negative.".into());
    }
    if !(config.min_height.is_finite()
        && config.max_height.is_finite()
        && config.min_height < config.max_height)
    {
        return Err("Azgaar terrain height range is invalid.".into());
    }
    if !config.sea_level.is_finite() {
        return Err("Azgaar sea level must be finite.".into());
    }
    Ok(())
}

pub fn import_azgaar_full_json(
    document: &serde_json::Value,
    config: &AzgaarImportConfig,
    options: &AzgaarImportOptions,
) -> Result<AzgaarImportedWorld, String> {
    assert_azgaar_document(document)?;
    validate_import_config(config)?;
    let summary: AzgaarImportSummary = build_azgaar_import_summary(
        document,
        config.atlas_long_edge,
        config.target_width,
        config.target_height,
        options.physical_width_meters,
    )?;
    let base_terrain = create_azgaar_macro_world_source(
        document,
        config.tile_size,
        config.atlas_long_edge,
        config.target_width,
        config.target_height,
        config.ocean_transition_kilometers,
        config.min_height,
        config.max_height,
        config.sea_level,
        config.vertical_exaggeration,
        config.relief_exponent,
        options.physical_width_meters,
    )?;
    let mut warnings = vec![
        format!(
            "Azgaar macro atlas {}×{}; {}×{} km; {:.1} MiB raw.",
            summary.atlas_width,
            summary.atlas_height,
            (summary.physical_width_meters / 1000.0).round(),
            (summary.physical_height_meters / 1000.0).round(),
            summary.estimated_raw_bytes as f64 / 1024.0 / 1024.0
        ),
        "Terrain is generated and streamed on demand; edits remain sparse.".to_string(),
    ];
    if summary.used_custom_unit_fallback {
        warnings.push(format!(
            "Unknown distance unit \"{}\" was interpreted as kilometers.",
            summary.distance_unit
        ));
    }
    Ok(AzgaarImportedWorld {
        format: "azgaar-imported-v1".to_string(),
        version: 1,
        map_name: base_terrain.source.map_name.clone(),
        base_terrain,
        import_warnings: warnings,
        summary: ImportSummaryDto {
            atlas_width: summary.atlas_width,
            atlas_height: summary.atlas_height,
            physical_width_meters: summary.physical_width_meters,
            physical_height_meters: summary.physical_height_meters,
            distance_unit: summary.distance_unit,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample_document() -> serde_json::Value {
        json!({
            "info": {
                "description": "Azgaar's Fantasy Map Generator output: azgaar.github.io/Fantasy-map-generator",
                "width": 100,
                "height": 100
            },
            "grid": {
                "cellsX": 1,
                "cellsY": 1,
                "cells": [{ "i": 0, "h": 50 }]
            },
            "pack": {
                "cells": [{ "i": 0, "g": 0, "h": 50, "biome": 1 }]
            }
        })
    }

    #[test]
    fn rejects_empty_grid() {
        let mut document = sample_document();
        document["grid"]["cells"] = json!([]);

        assert!(!is_azgaar_full_json(&document));
        let error = import_azgaar_full_json(
            &document,
            &AzgaarImportConfig::default(),
            &AzgaarImportOptions::default(),
        )
        .expect_err("empty grid must be rejected");
        assert!(error.contains("non-empty grid cells"));
    }

    #[test]
    fn rejects_grid_dimension_overflow() {
        let mut document = sample_document();
        document["grid"]["cellsX"] = json!(i32::MAX);
        document["grid"]["cellsY"] = json!(2);

        assert!(!is_azgaar_full_json(&document));
    }

    #[test]
    fn rejects_invalid_tile_size() {
        let mut config = AzgaarImportConfig::default();
        config.tile_size = 0.0;

        let error = import_azgaar_full_json(
            &sample_document(),
            &config,
            &AzgaarImportOptions::default(),
        )
        .expect_err("invalid tile size must be rejected");
        assert!(error.contains("tile size must be positive"));
    }

    #[test]
    fn rejects_oversized_atlas_before_allocation() {
        let mut config = AzgaarImportConfig::default();
        config.atlas_long_edge = Some(5000);

        let error = import_azgaar_full_json(
            &sample_document(),
            &config,
            &AzgaarImportOptions::default(),
        )
        .expect_err("oversized atlas must be rejected");
        assert!(error.contains("supported raw size limit"));
    }
}
