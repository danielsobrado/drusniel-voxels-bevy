const PROCEDURAL_GRASS_ID: u32 = 0u;
const PROCEDURAL_ROCK_ID: u32 = 1u;
const PROCEDURAL_SAND_ID: u32 = 2u;
const PROCEDURAL_DIRT_ID: u32 = 3u;

fn procedural_material_roughness(material_id: u32) -> f32 {
    if (material_id == PROCEDURAL_GRASS_ID) {
        return 0.85;
    }
    if (material_id == PROCEDURAL_ROCK_ID) {
        return 0.78;
    }
    if (material_id == PROCEDURAL_SAND_ID) {
        return 0.95;
    }
    return 0.92;
}
