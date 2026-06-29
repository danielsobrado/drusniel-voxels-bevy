#![cfg(test)]

use std::path::PathBuf;

use serde::Deserialize;

use super::{
    IslandShapeConfig, MaterialLayerId, ProceduralWorldSource, TerrainFieldConfig, WorldSource,
    sample_biome_splat,
};

const SUPPORTED_CONTRACT_VERSION: u32 = 1;
const HEIGHT_TOLERANCE_M: f32 = 0.75;
const OCEAN_MASK_TOLERANCE: f32 = 0.01;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenFixture {
    contract_version: u32,
    terrain: GoldenTerrainConfig,
    rows: Vec<GoldenRow>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenTerrainConfig {
    seed: i32,
    sea_level: f32,
    island_shape: GoldenIslandShapeConfig,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenIslandShapeConfig {
    enabled: bool,
    sea_level: f32,
    seed: i32,
    spacing_m: f32,
    radius_m: f32,
    blend_m: f32,
    warp_strength_m: f32,
    beach_width_m: f32,
    cliff_width_m: f32,
    world_radius_m: f32,
    ocean_rim: bool,
    ocean_rim_drop_m: f32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenRow {
    x: f32,
    z: f32,
    height: f32,
    biome_id: u8,
    ocean_mask: f32,
    dominant_layer: String,
    splat_weights: Vec<GoldenSplatWeight>,
}

#[derive(Debug, Deserialize)]
struct GoldenSplatWeight {
    material: String,
    weight: f32,
}

impl From<GoldenIslandShapeConfig> for IslandShapeConfig {
    fn from(value: GoldenIslandShapeConfig) -> Self {
        Self {
            enabled: value.enabled,
            sea_level: value.sea_level,
            seed: value.seed,
            spacing_m: value.spacing_m,
            radius_m: value.radius_m,
            blend_m: value.blend_m,
            warp_strength_m: value.warp_strength_m,
            beach_width_m: value.beach_width_m,
            cliff_width_m: value.cliff_width_m,
            world_radius_m: value.world_radius_m,
            ocean_rim: value.ocean_rim,
            ocean_rim_drop_m: value.ocean_rim_drop_m,
        }
    }
}

impl From<GoldenTerrainConfig> for TerrainFieldConfig {
    fn from(value: GoldenTerrainConfig) -> Self {
        TerrainFieldConfig::new(value.seed, value.sea_level, value.island_shape.into())
    }
}

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tools/clod-poc/fixtures/world_source_golden_samples.json")
}

fn load_fixture() -> GoldenFixture {
    let path = fixture_path();
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.display()));
    serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("failed to parse {}: {error}", path.display()))
}

fn dominant_material_layer(name: &str) -> MaterialLayerId {
    match name {
        "meadows-ground" => MaterialLayerId::Grass,
        "forest-floor" => MaterialLayerId::ForestFloor,
        "swamp-muck" => MaterialLayerId::Mud,
        "mountain-scree" => MaterialLayerId::Rock,
        "plains-grass" => MaterialLayerId::DryGrass,
        "coast-sand" => MaterialLayerId::Sand,
        "ocean-floor" => MaterialLayerId::OceanBed,
        other => panic!("unsupported fixture dominant layer {other}"),
    }
}

#[test]
fn bevy_world_source_matches_clod_poc_golden_fixture() {
    let fixture = load_fixture();
    assert_eq!(fixture.contract_version, SUPPORTED_CONTRACT_VERSION);
    assert!(fixture.rows.len() >= 64);

    let source = ProceduralWorldSource::new(fixture.terrain.into());
    for row in &fixture.rows {
        assert!(
            !row.splat_weights.is_empty(),
            "fixture row at {},{} has no splat weights",
            row.x,
            row.z
        );
        let weight_sum: f32 = row.splat_weights.iter().map(|entry| entry.weight).sum();
        assert!(
            (weight_sum - 1.0).abs() <= 0.0001,
            "fixture row at {},{} has splat weight sum {}",
            row.x,
            row.z,
            weight_sum
        );
        assert!(
            row.splat_weights
                .iter()
                .any(|entry| entry.material == row.dominant_layer)
        );

        let height = source.sample_height(row.x, row.z);
        assert!(
            (height - row.height).abs() <= HEIGHT_TOLERANCE_M,
            "height drift at {},{}: bevy={} fixture={}",
            row.x,
            row.z,
            height,
            row.height,
        );

        let biome = source.sample_biome(row.x, row.z) as u8;
        assert_eq!(biome, row.biome_id, "biome drift at {},{}", row.x, row.z);

        let ocean_mask = source.ocean_mask(row.x, row.z);
        assert!(
            (ocean_mask - row.ocean_mask).abs() <= OCEAN_MASK_TOLERANCE,
            "ocean-mask drift at {},{}: bevy={} fixture={}",
            row.x,
            row.z,
            ocean_mask,
            row.ocean_mask,
        );

        let splat = sample_biome_splat(
            source.sample_biome(row.x, row.z),
            height,
            source.metadata().sea_level,
            0.0,
        );
        assert_eq!(
            splat.dominant_layer(),
            dominant_material_layer(&row.dominant_layer)
        );
    }
}
