use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AzgaarTerrainClass {
    Water,
    Desert,
    Plains,
    Forest,
    Snow,
    Swamp,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AzgaarBiomeDefinition {
    pub source_id: u8,
    pub tile_id: u8,
    pub key: String,
    pub name: String,
    pub color: String,
    pub icon: String,
    pub standard: bool,
    pub terrain_class: AzgaarTerrainClass,
    pub supports_grass: bool,
    pub supports_trees: bool,
    pub habitability: f32,
    pub movement_cost: f32,
    pub relief_icon_density: i32,
    pub relief_icons: Vec<String>,
}

const CUSTOM_TILE_ID_START: u8 = 32;
const CUSTOM_TILE_ID_END: u8 = 254;

struct StandardBiome {
    name: &'static str,
    color: &'static str,
    icon: &'static str,
    terrain_class: AzgaarTerrainClass,
    supports_grass: bool,
    supports_trees: bool,
    habitability: f32,
    movement_cost: f32,
    relief_icon_density: i32,
}

const STANDARD: [StandardBiome; 13] = [
    StandardBiome { name: "Marine", color: "#466eab", icon: "🌊", terrain_class: AzgaarTerrainClass::Water, supports_grass: false, supports_trees: false, habitability: 0.0, movement_cost: 10.0, relief_icon_density: 0 },
    StandardBiome { name: "Hot desert", color: "#fbe79f", icon: "🏜️", terrain_class: AzgaarTerrainClass::Desert, supports_grass: false, supports_trees: false, habitability: 4.0, movement_cost: 200.0, relief_icon_density: 3 },
    StandardBiome { name: "Cold desert", color: "#b5b887", icon: "🏜️", terrain_class: AzgaarTerrainClass::Desert, supports_grass: false, supports_trees: false, habitability: 10.0, movement_cost: 150.0, relief_icon_density: 2 },
    StandardBiome { name: "Savanna", color: "#d2d082", icon: "🌾", terrain_class: AzgaarTerrainClass::Plains, supports_grass: true, supports_trees: true, habitability: 22.0, movement_cost: 60.0, relief_icon_density: 120 },
    StandardBiome { name: "Grassland", color: "#c8d68f", icon: "🌿", terrain_class: AzgaarTerrainClass::Plains, supports_grass: true, supports_trees: false, habitability: 30.0, movement_cost: 50.0, relief_icon_density: 120 },
    StandardBiome { name: "Tropical seasonal forest", color: "#b6d95d", icon: "🌴", terrain_class: AzgaarTerrainClass::Forest, supports_grass: true, supports_trees: true, habitability: 50.0, movement_cost: 70.0, relief_icon_density: 120 },
    StandardBiome { name: "Temperate deciduous forest", color: "#29bc56", icon: "🌳", terrain_class: AzgaarTerrainClass::Forest, supports_grass: true, supports_trees: true, habitability: 100.0, movement_cost: 70.0, relief_icon_density: 120 },
    StandardBiome { name: "Tropical rainforest", color: "#7dcb35", icon: "🌴", terrain_class: AzgaarTerrainClass::Forest, supports_grass: true, supports_trees: true, habitability: 80.0, movement_cost: 80.0, relief_icon_density: 150 },
    StandardBiome { name: "Temperate rainforest", color: "#409c43", icon: "🌲", terrain_class: AzgaarTerrainClass::Forest, supports_grass: true, supports_trees: true, habitability: 90.0, movement_cost: 90.0, relief_icon_density: 150 },
    StandardBiome { name: "Taiga", color: "#4b6b32", icon: "🌲", terrain_class: AzgaarTerrainClass::Forest, supports_grass: true, supports_trees: true, habitability: 12.0, movement_cost: 200.0, relief_icon_density: 100 },
    StandardBiome { name: "Tundra", color: "#96784b", icon: "🌱", terrain_class: AzgaarTerrainClass::Snow, supports_grass: false, supports_trees: false, habitability: 4.0, movement_cost: 1000.0, relief_icon_density: 5 },
    StandardBiome { name: "Glacier", color: "#d5e7eb", icon: "🧊", terrain_class: AzgaarTerrainClass::Snow, supports_grass: false, supports_trees: false, habitability: 0.0, movement_cost: 5000.0, relief_icon_density: 0 },
    StandardBiome { name: "Wetland", color: "#0b9131", icon: "🪷", terrain_class: AzgaarTerrainClass::Swamp, supports_grass: true, supports_trees: true, habitability: 12.0, movement_cost: 150.0, relief_icon_density: 250 },
];

fn key_for_name(name: &str) -> String {
    let snake = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '_' })
        .collect::<String>();
    snake.trim_matches('_').to_string()
}

fn valid_color(color: Option<&str>) -> Option<String> {
    let color = color?;
    if color.len() == 7 && color.starts_with('#') && color[1..].chars().all(|c| c.is_ascii_hexdigit()) {
        Some(color.to_ascii_lowercase())
    } else {
        None
    }
}

fn fallback_custom_color(source_id: u8) -> String {
    let mut value = (source_id as i32).wrapping_add(1).wrapping_mul(0x45d9f3b);
    value = (value ^ (value >> 16)).wrapping_mul(0x45d9f3b);
    value ^= value >> 16;
    let red = 64 + (((value >> 16) as u32) & 0x7f);
    let green = 64 + (((value >> 8) as u32) & 0x7f);
    let blue = 64 + ((value as u32) & 0x7f);
    format!("#{red:02x}{green:02x}{blue:02x}")
}

fn array_str<'a>(biomes_data: &'a serde_json::Value, key: &str, index: usize) -> Option<&'a str> {
    biomes_data.get(key)?.as_array()?.get(index)?.as_str()
}

fn array_f32(biomes_data: &serde_json::Value, key: &str, index: usize) -> Option<f32> {
    biomes_data.get(key)?.as_array()?.get(index)?.as_f64().map(|v| v as f32)
}

pub fn create_azgaar_biome_definitions(
    biomes_data: Option<&serde_json::Value>,
    observed_source_ids: impl IntoIterator<Item = u8>,
) -> Result<Vec<AzgaarBiomeDefinition>, String> {
    let empty = serde_json::Value::Null;
    let data = biomes_data.unwrap_or(&empty);
    let mut definitions = Vec::with_capacity(13);
    for (source_id, standard) in STANDARD.iter().enumerate() {
        let source_id = source_id as u8;
        let name = array_str(data, "name", source_id as usize)
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .unwrap_or(standard.name)
            .to_string();
        let color = valid_color(array_str(data, "color", source_id as usize))
            .unwrap_or_else(|| standard.color.to_string());
        definitions.push(AzgaarBiomeDefinition {
            source_id,
            tile_id: source_id,
            key: format!("azgaar_{}", key_for_name(&name)),
            name,
            color,
            icon: standard.icon.to_string(),
            standard: true,
            terrain_class: standard.terrain_class,
            supports_grass: standard.supports_grass,
            supports_trees: standard.supports_trees,
            habitability: array_f32(data, "habitability", source_id as usize)
                .unwrap_or(standard.habitability)
                .max(0.0),
            movement_cost: array_f32(data, "cost", source_id as usize)
                .unwrap_or(standard.movement_cost)
                .max(0.0),
            relief_icon_density: array_f32(data, "iconsDensity", source_id as usize)
                .map(|v| v.round() as i32)
                .unwrap_or(standard.relief_icon_density)
                .max(0),
            relief_icons: Vec::new(),
        });
    }

    let mut custom_ids = std::collections::BTreeSet::new();
    let names_len = data.get("name").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
    let colors_len = data.get("color").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
    let metadata_len = names_len.max(colors_len);
    for source_id in STANDARD.len()..metadata_len {
        let has_name = array_str(data, "name", source_id)
            .map(str::trim)
            .is_some_and(|name| !name.is_empty());
        let has_color = valid_color(array_str(data, "color", source_id)).is_some();
        if has_name || has_color {
            if source_id > 255 {
                return Err("Azgaar biome source ids must fit in an unsigned byte (0–255).".into());
            }
            custom_ids.insert(source_id as u8);
        }
    }
    for source_id in observed_source_ids {
        if source_id >= STANDARD.len() as u8 {
            custom_ids.insert(source_id);
        }
    }
    let max_custom = (CUSTOM_TILE_ID_END - CUSTOM_TILE_ID_START + 1) as usize;
    if custom_ids.len() > max_custom {
        return Err(format!(
            "Azgaar map defines {} custom biomes; at most {max_custom} are supported.",
            custom_ids.len()
        ));
    }
    for (index, source_id) in custom_ids.into_iter().enumerate() {
        let name = array_str(data, "name", source_id as usize)
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("Custom biome {source_id}"));
        definitions.push(AzgaarBiomeDefinition {
            source_id,
            tile_id: CUSTOM_TILE_ID_START + index as u8,
            key: format!("azgaar_custom_{source_id}"),
            name,
            color: valid_color(array_str(data, "color", source_id as usize))
                .unwrap_or_else(|| fallback_custom_color(source_id)),
            icon: "🗺️".to_string(),
            standard: false,
            terrain_class: AzgaarTerrainClass::Plains,
            supports_grass: true,
            supports_trees: false,
            habitability: array_f32(data, "habitability", source_id as usize).unwrap_or(0.0).max(0.0),
            movement_cost: array_f32(data, "cost", source_id as usize).unwrap_or(0.0).max(0.0),
            relief_icon_density: array_f32(data, "iconsDensity", source_id as usize)
                .map(|v| v.round() as i32)
                .unwrap_or(0)
                .max(0),
            relief_icons: Vec::new(),
        });
    }
    Ok(definitions)
}
