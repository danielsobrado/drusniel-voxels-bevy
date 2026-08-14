use std::collections::{HashMap, HashSet};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde::{Deserialize, Serialize};

use super::biome_catalog::{AzgaarBiomeDefinition, create_azgaar_biome_definitions};

pub const AZGAAR_MACRO_SOURCE_KIND: &str = "azgaar-macro-v1";
const MACRO_SOURCE_VERSION: u32 = 1;
const MAX_ATLAS_RAW_BYTES: usize = 64 * 1024 * 1024;
const UINT8_RAW: &str = "base64-u8-v1";
const UINT8_RLE: &str = "base64-rle-u8-v1";
const UINT16_RAW: &str = "base64-le-u16-v1";
const UINT16_RLE: &str = "base64-rle-u16-v1";

fn unit_meters(unit: &str) -> (f64, bool) {
    match unit {
        "km" => (1000.0, false),
        "mi" => (1609.344, false),
        "lg" => (4828.032, false),
        "vr" => (1066.8, false),
        "nmi" => (1852.0, false),
        "nlg" => (5556.0, false),
        _ => (1000.0, true),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MacroAtlasPayload {
    pub encoding: String,
    pub data: String,
    pub length: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AzgaarMacroWorldSource {
    pub kind: String,
    pub version: u32,
    pub source: MacroSourceInfo,
    pub atlas: MacroAtlas,
    pub physical: MacroPhysical,
    pub bounds: MacroBounds,
    pub ocean_transition_cells: i32,
    pub terrain: MacroTerrain,
    pub biomes: Vec<AzgaarBiomeDefinition>,
    pub rivers: Vec<MacroRiver>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MacroSourceInfo {
    pub version: Option<String>,
    pub map_id: Option<String>,
    pub map_name: String,
    pub seed: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MacroAtlas {
    pub width: u32,
    pub height: u32,
    pub height_data: MacroAtlasPayload,
    pub biome_data: MacroAtlasPayload,
    pub feature_data: MacroAtlasPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MacroPhysical {
    pub width_meters: f64,
    pub height_meters: f64,
    pub distance_scale: f64,
    pub distance_unit: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MacroBounds {
    pub min_cell_x: i32,
    pub min_cell_z: i32,
    pub width_cells: i32,
    pub height_cells: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MacroTerrain {
    pub min_height: f32,
    pub max_height: f32,
    pub sea_level: f32,
    pub vertical_exaggeration: f32,
    pub relief_exponent: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MacroRiver {
    pub id: i64,
    pub width_atlas: f64,
    pub points: Vec<[f64; 2]>,
}

#[derive(Debug, Clone)]
pub struct DecodedMacroAtlas {
    pub heights: Vec<u8>,
    pub biomes: Vec<u8>,
    pub features: Vec<u16>,
}

#[derive(Debug, Clone)]
pub struct AzgaarImportSummary {
    pub atlas_width: u32,
    pub atlas_height: u32,
    pub physical_width_meters: f64,
    pub physical_height_meters: f64,
    pub distance_scale: f64,
    pub distance_unit: String,
    pub used_custom_unit_fallback: bool,
    pub standard_biome_count: usize,
    pub custom_biome_count: usize,
    pub estimated_raw_bytes: usize,
}

fn clamp_i32(value: i32, minimum: i32, maximum: i32) -> i32 {
    value.max(minimum).min(maximum)
}

fn atlas_sample_count(width: u32, height: u32) -> Result<usize, String> {
    if width == 0 || height == 0 {
        return Err("Macro atlas dimensions must be positive.".into());
    }
    let samples = (width as usize)
        .checked_mul(height as usize)
        .ok_or_else(|| "Macro atlas dimensions are too large.".to_string())?;
    let raw_bytes = samples
        .checked_mul(4)
        .ok_or_else(|| "Macro atlas dimensions are too large.".to_string())?;
    if raw_bytes > MAX_ATLAS_RAW_BYTES {
        return Err("Macro atlas exceeds the supported raw size limit.".into());
    }
    Ok(samples)
}

fn maximum_base64_length(decoded_bytes: usize) -> Result<usize, String> {
    decoded_bytes
        .checked_add(2)
        .map(|value| value / 3)
        .and_then(|groups| groups.checked_mul(4))
        .ok_or_else(|| "Macro atlas payload size is invalid.".to_string())
}

fn encode_runs_u8(values: &[u8]) -> Vec<u8> {
    let mut bytes = Vec::new();
    let mut offset = 0usize;
    while offset < values.len() {
        let value = values[offset];
        let mut count = 1u16;
        while offset + (count as usize) < values.len()
            && values[offset + count as usize] == value
            && count < 0xffff
        {
            count += 1;
        }
        bytes.extend_from_slice(&count.to_le_bytes());
        bytes.push(value);
        offset += count as usize;
    }
    bytes
}

fn encode_runs_u16(values: &[u16]) -> Vec<u8> {
    let mut bytes = Vec::new();
    let mut offset = 0usize;
    while offset < values.len() {
        let value = values[offset];
        let mut count = 1u16;
        while offset + (count as usize) < values.len()
            && values[offset + count as usize] == value
            && count < 0xffff
        {
            count += 1;
        }
        bytes.extend_from_slice(&count.to_le_bytes());
        bytes.extend_from_slice(&value.to_le_bytes());
        offset += count as usize;
    }
    bytes
}

fn encode_values_u8(values: &[u8]) -> MacroAtlasPayload {
    let raw = values.to_vec();
    let runs = encode_runs_u8(values);
    let use_runs = runs.len() < raw.len();
    MacroAtlasPayload {
        encoding: if use_runs { UINT8_RLE } else { UINT8_RAW }.to_string(),
        data: BASE64.encode(if use_runs { &runs } else { &raw }),
        length: values.len(),
    }
}

fn encode_values_u16(values: &[u16]) -> MacroAtlasPayload {
    let mut raw = Vec::with_capacity(values.len() * 2);
    for value in values {
        raw.extend_from_slice(&value.to_le_bytes());
    }
    let runs = encode_runs_u16(values);
    let use_runs = runs.len() < raw.len();
    MacroAtlasPayload {
        encoding: if use_runs { UINT16_RLE } else { UINT16_RAW }.to_string(),
        data: BASE64.encode(if use_runs { &runs } else { &raw }),
        length: values.len(),
    }
}

fn decode_values_u8(
    payload: &MacroAtlasPayload,
    expected_length: usize,
) -> Result<Vec<u8>, String> {
    if payload.length != expected_length {
        return Err("Macro atlas dimensions do not match its payloads.".into());
    }
    let maximum_decoded_bytes = match payload.encoding.as_str() {
        UINT8_RAW => expected_length,
        UINT8_RLE => expected_length
            .checked_mul(3)
            .ok_or_else(|| "Macro atlas payload size is invalid.".to_string())?,
        _ => {
            return Err(format!(
                "Unsupported macro atlas encoding: {}.",
                payload.encoding
            ));
        }
    };
    if payload.data.len() > maximum_base64_length(maximum_decoded_bytes)? {
        return Err("Macro atlas payload exceeds its expected size.".into());
    }

    let bytes = BASE64
        .decode(payload.data.as_bytes())
        .map_err(|error| format!("invalid base64: {error}"))?;
    if payload.encoding == UINT8_RAW {
        if bytes.len() != expected_length {
            return Err("Macro atlas raw payload has an invalid size.".into());
        }
        return Ok(bytes);
    }
    if bytes.len() % 3 != 0 {
        return Err("Macro atlas RLE payload is invalid.".into());
    }

    let mut result = vec![0u8; expected_length];
    let mut target = 0usize;
    let mut offset = 0usize;
    while offset < bytes.len() {
        let count = u16::from_le_bytes([bytes[offset], bytes[offset + 1]]) as usize;
        let value = bytes[offset + 2];
        offset += 3;
        let end = target
            .checked_add(count)
            .filter(|end| *end <= result.len())
            .ok_or_else(|| "Macro atlas RLE payload is invalid.".to_string())?;
        if count < 1 {
            return Err("Macro atlas RLE payload is invalid.".into());
        }
        result[target..end].fill(value);
        target = end;
    }
    if target != result.len() {
        return Err("Macro atlas RLE payload is incomplete.".into());
    }
    Ok(result)
}

fn decode_values_u16(
    payload: &MacroAtlasPayload,
    expected_length: usize,
) -> Result<Vec<u16>, String> {
    if payload.length != expected_length {
        return Err("Macro atlas dimensions do not match its payloads.".into());
    }
    let raw_bytes = expected_length
        .checked_mul(2)
        .ok_or_else(|| "Macro atlas payload size is invalid.".to_string())?;
    let maximum_decoded_bytes = match payload.encoding.as_str() {
        UINT16_RAW => raw_bytes,
        UINT16_RLE => expected_length
            .checked_mul(4)
            .ok_or_else(|| "Macro atlas payload size is invalid.".to_string())?,
        _ => {
            return Err(format!(
                "Unsupported macro atlas encoding: {}.",
                payload.encoding
            ));
        }
    };
    if payload.data.len() > maximum_base64_length(maximum_decoded_bytes)? {
        return Err("Macro atlas payload exceeds its expected size.".into());
    }

    let bytes = BASE64
        .decode(payload.data.as_bytes())
        .map_err(|error| format!("invalid base64: {error}"))?;
    if payload.encoding == UINT16_RAW {
        if bytes.len() != raw_bytes {
            return Err("Macro atlas raw payload has an invalid size.".into());
        }
        let mut result = Vec::with_capacity(expected_length);
        for chunk in bytes.chunks_exact(2) {
            result.push(u16::from_le_bytes([chunk[0], chunk[1]]));
        }
        return Ok(result);
    }
    if bytes.len() % 4 != 0 {
        return Err("Macro atlas RLE payload is invalid.".into());
    }

    let mut result = vec![0u16; expected_length];
    let mut target = 0usize;
    let mut offset = 0usize;
    while offset < bytes.len() {
        let count = u16::from_le_bytes([bytes[offset], bytes[offset + 1]]) as usize;
        let value = u16::from_le_bytes([bytes[offset + 2], bytes[offset + 3]]);
        offset += 4;
        let end = target
            .checked_add(count)
            .filter(|end| *end <= result.len())
            .ok_or_else(|| "Macro atlas RLE payload is invalid.".to_string())?;
        if count < 1 {
            return Err("Macro atlas RLE payload is invalid.".into());
        }
        result[target..end].fill(value);
        target = end;
    }
    if target != result.len() {
        return Err("Macro atlas RLE payload is incomplete.".into());
    }
    Ok(result)
}

pub fn create_macro_atlas_payload(
    heights: &[u8],
    biomes: &[u8],
    features: &[u16],
) -> (MacroAtlasPayload, MacroAtlasPayload, MacroAtlasPayload) {
    (
        encode_values_u8(heights),
        encode_values_u8(biomes),
        encode_values_u16(features),
    )
}

pub fn decode_macro_atlas(source: &AzgaarMacroWorldSource) -> Result<DecodedMacroAtlas, String> {
    if source.kind != AZGAAR_MACRO_SOURCE_KIND || source.version != MACRO_SOURCE_VERSION {
        return Err(format!(
            "Unsupported base terrain source: {}.",
            source.kind
        ));
    }
    let expected = atlas_sample_count(source.atlas.width, source.atlas.height)?;
    let heights = decode_values_u8(&source.atlas.height_data, expected)?;
    let biomes = decode_values_u8(&source.atlas.biome_data, expected)?;
    let features = decode_values_u16(&source.atlas.feature_data, expected)?;
    Ok(DecodedMacroAtlas {
        heights,
        biomes,
        features,
    })
}

fn resolve_atlas_dimensions(
    document: &serde_json::Value,
    atlas_long_edge: Option<u32>,
    target_width: Option<u32>,
    target_height: Option<u32>,
) -> Result<(u32, u32), String> {
    let source_width = document
        .pointer("/info/width")
        .and_then(|v| v.as_f64())
        .filter(|v| *v > 0.0)
        .ok_or_else(|| "Azgaar Full JSON must include positive map dimensions.".to_string())?;
    let source_height = document
        .pointer("/info/height")
        .and_then(|v| v.as_f64())
        .filter(|v| *v > 0.0)
        .ok_or_else(|| "Azgaar Full JSON must include positive map dimensions.".to_string())?;
    if let Some(long_edge) = atlas_long_edge.filter(|v| *v > 0) {
        if source_width >= source_height {
            let height = ((long_edge as f64) * source_height / source_width)
                .round()
                .max(1.0) as u32;
            return Ok((long_edge, height));
        }
        let width = ((long_edge as f64) * source_width / source_height)
            .round()
            .max(1.0) as u32;
        return Ok((width, long_edge));
    }
    match (target_width, target_height) {
        (Some(width), Some(height)) if width >= 1 && height >= 1 => Ok((width, height)),
        _ => Err("Azgaar import requires a positive atlas long edge or target dimensions.".into()),
    }
}

fn resolve_physical_dimensions(
    document: &serde_json::Value,
    physical_width_meters: Option<f64>,
) -> Result<(f64, f64, f64, String, bool), String> {
    let source_width = document
        .pointer("/info/width")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let source_height = document
        .pointer("/info/height")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let distance_scale = document
        .pointer("/settings/distanceScale")
        .and_then(|v| v.as_f64())
        .unwrap_or(1.0);
    if !(distance_scale.is_finite() && distance_scale > 0.0) {
        return Err("Azgaar distance scale must be positive.".into());
    }
    let distance_unit = document
        .pointer("/settings/distanceUnit")
        .and_then(|v| v.as_str())
        .unwrap_or("km")
        .to_string();
    let (unit_meters, used_fallback) = unit_meters(&distance_unit);
    let default_width = source_width * distance_scale * unit_meters;
    let width_meters = physical_width_meters.unwrap_or(default_width);
    if !(width_meters.is_finite() && width_meters > 0.0) {
        return Err("Azgaar physical width override must be positive.".into());
    }
    let height_meters = width_meters * source_height / source_width;
    if !(height_meters.is_finite() && height_meters > 0.0) {
        return Err("Azgaar physical height must be positive.".into());
    }
    Ok((
        width_meters,
        height_meters,
        distance_scale,
        distance_unit,
        used_fallback,
    ))
}

pub fn build_azgaar_import_summary(
    document: &serde_json::Value,
    atlas_long_edge: Option<u32>,
    target_width: Option<u32>,
    target_height: Option<u32>,
    physical_width_meters: Option<f64>,
) -> Result<AzgaarImportSummary, String> {
    let (atlas_width, atlas_height) =
        resolve_atlas_dimensions(document, atlas_long_edge, target_width, target_height)?;
    let sample_count = atlas_sample_count(atlas_width, atlas_height)?;
    let (width_meters, height_meters, distance_scale, distance_unit, used_fallback) =
        resolve_physical_dimensions(document, physical_width_meters)?;
    let biomes = create_azgaar_biome_definitions(document.get("biomesData"), std::iter::empty())?;
    Ok(AzgaarImportSummary {
        atlas_width,
        atlas_height,
        physical_width_meters: width_meters.round(),
        physical_height_meters: height_meters.round(),
        distance_scale,
        distance_unit,
        used_custom_unit_fallback: used_fallback,
        standard_biome_count: biomes.iter().filter(|b| b.standard).count(),
        custom_biome_count: biomes.iter().filter(|b| !b.standard).count(),
        estimated_raw_bytes: sample_count * 4,
    })
}

fn checked_cell_count(meters: f64, tile_size: f64, label: &str) -> Result<i32, String> {
    let cells = (meters / tile_size).round().max(1.0);
    if !(cells.is_finite() && cells <= i32::MAX as f64) {
        return Err(format!("Azgaar {label} exceeds supported world bounds."));
    }
    Ok(cells as i32)
}

pub fn create_azgaar_macro_world_source(
    document: &serde_json::Value,
    tile_size: f64,
    atlas_long_edge: Option<u32>,
    target_width: Option<u32>,
    target_height: Option<u32>,
    ocean_transition_kilometers: f64,
    min_height: f32,
    max_height: f32,
    sea_level: f32,
    vertical_exaggeration: f32,
    relief_exponent: f32,
    physical_width_meters: Option<f64>,
) -> Result<AzgaarMacroWorldSource, String> {
    if !(tile_size.is_finite() && tile_size > 0.0) {
        return Err("Azgaar tile size must be positive.".into());
    }
    if !(ocean_transition_kilometers.is_finite() && ocean_transition_kilometers >= 0.0) {
        return Err("Azgaar ocean transition distance must be non-negative.".into());
    }
    if !(min_height.is_finite() && max_height.is_finite() && min_height < max_height) {
        return Err("Azgaar terrain height range is invalid.".into());
    }
    if !sea_level.is_finite() {
        return Err("Azgaar sea level must be finite.".into());
    }

    let summary = build_azgaar_import_summary(
        document,
        atlas_long_edge,
        target_width,
        target_height,
        physical_width_meters,
    )?;
    let length = atlas_sample_count(summary.atlas_width, summary.atlas_height)?;
    let mut heights = vec![0u8; length];
    let mut biomes = vec![0u8; length];
    let mut features = vec![0u16; length];
    let mut observed = HashSet::new();

    let cells_x = document
        .pointer("/grid/cellsX")
        .and_then(|v| v.as_i64())
        .filter(|value| (1..=i32::MAX as i64).contains(value))
        .ok_or("invalid grid.cellsX")? as i32;
    let cells_y = document
        .pointer("/grid/cellsY")
        .and_then(|v| v.as_i64())
        .filter(|value| (1..=i32::MAX as i64).contains(value))
        .ok_or("invalid grid.cellsY")? as i32;
    let grid_cells = document
        .pointer("/grid/cells")
        .and_then(|v| v.as_array())
        .filter(|cells| !cells.is_empty())
        .ok_or("missing grid.cells")?;
    let mut lookup = HashMap::new();
    for cell in grid_cells {
        if let Some(id) = cell
            .get("i")
            .and_then(|v| v.as_i64())
            .filter(|value| (i32::MIN as i64..=i32::MAX as i64).contains(value))
        {
            lookup.insert(id as i32, cell);
        }
    }
    let mut pack_by_grid: HashMap<i32, &serde_json::Value> = HashMap::new();
    if let Some(pack_cells) = document.pointer("/pack/cells").and_then(|v| v.as_array()) {
        for cell in pack_cells {
            if let Some(g) = cell
                .get("g")
                .and_then(|v| v.as_i64())
                .filter(|value| (i32::MIN as i64..=i32::MAX as i64).contains(value))
            {
                let g = g as i32;
                let previous = pack_by_grid.get(&g).copied();
                let h = cell.get("h").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let prev_h = previous
                    .and_then(|p| p.get("h").and_then(|v| v.as_f64()))
                    .unwrap_or(f64::NEG_INFINITY);
                if previous.is_none() || h > prev_h {
                    pack_by_grid.insert(g, cell);
                }
            }
        }
    }

    for y in 0..summary.atlas_height {
        let normalized_y = (y as f64 + 0.5) / summary.atlas_height as f64;
        for x in 0..summary.atlas_width {
            let normalized_x = (x as f64 + 0.5) / summary.atlas_width as f64;
            let column = clamp_i32(
                (normalized_x * cells_x as f64).floor() as i32,
                0,
                cells_x - 1,
            );
            let row = clamp_i32(
                (normalized_y * cells_y as f64).floor() as i32,
                0,
                cells_y - 1,
            );
            let id = row * cells_x + column;
            let grid_cell = lookup
                .get(&id)
                .copied()
                .or_else(|| grid_cells.get(id.clamp(0, grid_cells.len() as i32 - 1) as usize));
            let pack_cell = grid_cell
                .and_then(|cell| cell.get("i").and_then(|v| v.as_i64()))
                .filter(|value| (i32::MIN as i64..=i32::MAX as i64).contains(value))
                .and_then(|gid| pack_by_grid.get(&(gid as i32)).copied());
            let index = (y * summary.atlas_width + x) as usize;
            let raw_h = pack_cell
                .and_then(|c| c.get("h"))
                .or_else(|| grid_cell.and_then(|c| c.get("h")))
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0)
                .round()
                .clamp(0.0, 100.0) as u8;
            let biome = pack_cell
                .and_then(|c| c.get("biome"))
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0)
                .clamp(0.0, 255.0) as u8;
            let feature = pack_cell
                .and_then(|c| c.get("f"))
                .or_else(|| grid_cell.and_then(|c| c.get("f")))
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0)
                .clamp(0.0, 65535.0) as u16;
            heights[index] = raw_h;
            biomes[index] = biome;
            features[index] = feature;
            observed.insert(biome);
        }
    }

    let (height_data, biome_data, feature_data) =
        create_macro_atlas_payload(&heights, &biomes, &features);
    let width_cells = checked_cell_count(summary.physical_width_meters, tile_size, "width")?;
    let height_cells = checked_cell_count(summary.physical_height_meters, tile_size, "height")?;
    let transition_cells = checked_cell_count(
        ocean_transition_kilometers * 1000.0,
        tile_size,
        "ocean transition distance",
    )?;
    let biome_defs =
        create_azgaar_biome_definitions(document.get("biomesData"), observed.into_iter())?;
    let rivers = create_river_data(
        document,
        summary.atlas_width,
        summary.atlas_height,
        summary.physical_width_meters,
    );

    Ok(AzgaarMacroWorldSource {
        kind: AZGAAR_MACRO_SOURCE_KIND.to_string(),
        version: MACRO_SOURCE_VERSION,
        source: MacroSourceInfo {
            version: document
                .pointer("/info/version")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            map_id: document
                .pointer("/info/mapId")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            map_name: document
                .pointer("/info/mapName")
                .and_then(|v| v.as_str())
                .or_else(|| {
                    document
                        .pointer("/settings/mapName")
                        .and_then(|v| v.as_str())
                })
                .unwrap_or("Azgaar world")
                .to_string(),
            seed: document
                .pointer("/info/seed")
                .cloned()
                .or_else(|| document.pointer("/grid/seed").cloned()),
        },
        atlas: MacroAtlas {
            width: summary.atlas_width,
            height: summary.atlas_height,
            height_data,
            biome_data,
            feature_data,
        },
        physical: MacroPhysical {
            width_meters: summary.physical_width_meters,
            height_meters: summary.physical_height_meters,
            distance_scale: summary.distance_scale,
            distance_unit: summary.distance_unit,
        },
        bounds: MacroBounds {
            min_cell_x: -(width_cells / 2),
            min_cell_z: -(height_cells / 2),
            width_cells,
            height_cells,
        },
        ocean_transition_cells: transition_cells,
        terrain: MacroTerrain {
            min_height,
            max_height,
            sea_level,
            vertical_exaggeration: if vertical_exaggeration.is_finite() && vertical_exaggeration > 0.0 {
                vertical_exaggeration
            } else {
                1.0
            },
            relief_exponent: if relief_exponent.is_finite() && relief_exponent > 0.0 {
                relief_exponent
            } else {
                1.0
            },
        },
        biomes: biome_defs,
        rivers,
    })
}

fn create_river_data(
    document: &serde_json::Value,
    atlas_width: u32,
    atlas_height: u32,
    physical_width_meters: f64,
) -> Vec<MacroRiver> {
    let source_width = document
        .pointer("/info/width")
        .and_then(|v| v.as_f64())
        .unwrap_or(1.0);
    let source_height = document
        .pointer("/info/height")
        .and_then(|v| v.as_f64())
        .unwrap_or(1.0);
    let distance_scale = document
        .pointer("/settings/distanceScale")
        .and_then(|v| v.as_f64())
        .unwrap_or(1.0);
    let distance_unit = document
        .pointer("/settings/distanceUnit")
        .and_then(|v| v.as_str())
        .unwrap_or("km");
    let (unit_meters, _) = unit_meters(distance_unit);
    let meters_per_atlas_pixel = physical_width_meters / atlas_width as f64;
    let pack_by_id: HashMap<i64, &serde_json::Value> = document
        .pointer("/pack/cells")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter_map(|cell| {
            cell.get("i")
                .and_then(|v| v.as_i64())
                .map(|id| (id, cell))
        })
        .collect();
    let mut rivers = Vec::new();
    let Some(source_rivers) = document
        .pointer("/pack/rivers")
        .and_then(|v| v.as_array())
    else {
        return rivers;
    };
    for river in source_rivers {
        let mut points: Vec<[f64; 2]> = Vec::new();
        if let Some(raw_points) = river.get("points").and_then(|v| v.as_array()) {
            if raw_points.len() > 1 {
                for point in raw_points {
                    if let (Some(x), Some(y)) = (
                        point.get(0).and_then(|v| v.as_f64()),
                        point.get(1).and_then(|v| v.as_f64()),
                    ) {
                        points.push([x, y]);
                    }
                }
            }
        }
        if points.len() < 2 {
            if let Some(cells) = river.get("cells").and_then(|v| v.as_array()) {
                for cell_id in cells {
                    if let Some(id) = cell_id.as_i64() {
                        if let Some(point) = pack_by_id
                            .get(&id)
                            .and_then(|cell| cell.get("p"))
                            .and_then(|v| v.as_array())
                        {
                            if let (Some(x), Some(y)) = (
                                point.get(0).and_then(|v| v.as_f64()),
                                point.get(1).and_then(|v| v.as_f64()),
                            ) {
                                points.push([x, y]);
                            }
                        }
                    }
                }
            }
        }
        if points.len() < 2 {
            continue;
        }
        let width = river
            .get("width")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.1);
        rivers.push(MacroRiver {
            id: river.get("i").and_then(|v| v.as_i64()).unwrap_or(0),
            width_atlas: (width * distance_scale * unit_meters / meters_per_atlas_pixel)
                .max(1.0 / 256.0),
            points: points
                .into_iter()
                .map(|[x, y]| {
                    [
                        x / source_width * atlas_width as f64,
                        y / source_height * atlas_height as f64,
                    ]
                })
                .collect(),
        });
    }
    rivers
}
