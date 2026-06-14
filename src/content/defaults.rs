use std::collections::HashMap;

use super::registry::ContentRegistry;
use super::types::*;

pub fn get_default_registry() -> ContentRegistry {
    let mut material_types = HashMap::new();
    let mut materials = HashMap::new();
    let mut palettes = HashMap::new();
    let mut texture_slots = HashMap::new();
    let mut atlas_mappings = HashMap::new();
    let mut biomes = HashMap::new();
    let props = HashMap::new();
    let mut building_pieces = HashMap::new();
    let protected_areas = HashMap::new();
    let objectives = HashMap::new();

    // 1. Material Types
    material_types.insert(
        "system".to_string(),
        MaterialTypeContent {
            id: "system".to_string(),
            name: "System".to_string(),
            material_ids: vec!["air".to_string()],
        },
    );
    material_types.insert(
        "terrain".to_string(),
        MaterialTypeContent {
            id: "terrain".to_string(),
            name: "Terrain".to_string(),
            material_ids: vec![
                "top-soil".to_string(),
                "sub-soil".to_string(),
                "rock".to_string(),
                "bedrock".to_string(),
                "sand".to_string(),
                "clay".to_string(),
            ],
        },
    );
    material_types.insert(
        "water".to_string(),
        MaterialTypeContent {
            id: "water".to_string(),
            name: "Water".to_string(),
            material_ids: vec!["water".to_string()],
        },
    );
    material_types.insert(
        "organic".to_string(),
        MaterialTypeContent {
            id: "organic".to_string(),
            name: "Organic".to_string(),
            material_ids: vec!["wood".to_string(), "leaves".to_string()],
        },
    );
    material_types.insert(
        "dungeon".to_string(),
        MaterialTypeContent {
            id: "dungeon".to_string(),
            name: "Dungeon".to_string(),
            material_ids: vec!["dungeon-wall".to_string(), "dungeon-floor".to_string()],
        },
    );

    // 2. Materials
    let create_material = |id: &str,
                           legacy_id: u16,
                           name: &str,
                           type_id: &str,
                           voxel: &str,
                           rgb: [u8; 3],
                           strength: f32,
                           transparent: bool,
                           liquid: bool,
                           solid: bool,
                           diggable: bool,
                           paintable: bool| {
        MaterialContent {
            id: id.to_string(),
            legacy_material_id: Some(legacy_id),
            name: name.to_string(),
            material_type_id: type_id.to_string(),
            default_voxel: Some(voxel.to_string()),
            color_rgb: rgb,
            metallic: 0.0,
            smooth: if transparent { 0.85 } else { 0.45 },
            emissive: 0.0,
            surface_transmission: if transparent { 0.72 } else { 0.0 },
            absorption_length: if transparent { 24.0 } else { 0.0 },
            scatter_length: if transparent { 96.0 } else { 0.0 },
            index_of_refraction: if transparent { 1.33 } else { 1.0 },
            phase: 0.0,
            strength,
            transparent,
            liquid,
            solid,
            diggable,
            paintable,
            texture_slot_id: None,
            allow_transparent_digging: None,
        }
    };

    materials.insert(
        "air".to_string(),
        create_material(
            "air",
            0,
            "Air",
            "system",
            "Air",
            [0, 0, 0],
            0.0,
            true,
            false,
            false,
            false,
            false,
        ),
    );
    // Air is transparent but is the reference medium: IOR = 1.0, not water (1.33).
    if let Some(air) = materials.get_mut("air") {
        air.index_of_refraction = 1.0;
    }
    materials.insert(
        "top-soil".to_string(),
        create_material(
            "top-soil",
            1,
            "Top Soil",
            "terrain",
            "TopSoil",
            [83, 128, 62],
            1.0,
            false,
            false,
            true,
            true,
            true,
        ),
    );
    materials.insert(
        "sub-soil".to_string(),
        create_material(
            "sub-soil",
            2,
            "Sub Soil",
            "terrain",
            "SubSoil",
            [112, 78, 48],
            1.0,
            false,
            false,
            true,
            true,
            true,
        ),
    );
    materials.insert(
        "rock".to_string(),
        create_material(
            "rock",
            3,
            "Rock",
            "terrain",
            "Rock",
            [112, 112, 118],
            1.8,
            false,
            false,
            true,
            true,
            true,
        ),
    );
    materials.insert(
        "bedrock".to_string(),
        create_material(
            "bedrock",
            4,
            "Bedrock",
            "terrain",
            "Bedrock",
            [52, 52, 58],
            10.0,
            false,
            false,
            true,
            false,
            false,
        ),
    );
    materials.insert(
        "sand".to_string(),
        create_material(
            "sand",
            5,
            "Sand",
            "terrain",
            "Sand",
            [207, 184, 119],
            0.6,
            false,
            false,
            true,
            true,
            true,
        ),
    );
    materials.insert(
        "clay".to_string(),
        create_material(
            "clay",
            6,
            "Clay",
            "terrain",
            "Clay",
            [142, 97, 86],
            0.8,
            false,
            false,
            true,
            true,
            true,
        ),
    );
    materials.insert(
        "water".to_string(),
        create_material(
            "water",
            7,
            "Water",
            "water",
            "Water",
            [66, 152, 210],
            0.3,
            true,
            true,
            false,
            false,
            false,
        ),
    );
    materials.insert(
        "wood".to_string(),
        create_material(
            "wood",
            8,
            "Wood",
            "organic",
            "Wood",
            [121, 82, 45],
            1.0,
            false,
            false,
            true,
            true,
            true,
        ),
    );
    materials.insert(
        "leaves".to_string(),
        create_material(
            "leaves",
            9,
            "Leaves",
            "organic",
            "Leaves",
            [65, 134, 59],
            0.4,
            true,
            false,
            true,
            true,
            true,
        ),
    );
    materials.insert(
        "dungeon-wall".to_string(),
        create_material(
            "dungeon-wall",
            10,
            "Dungeon Wall",
            "dungeon",
            "DungeonWall",
            [84, 82, 96],
            2.0,
            false,
            false,
            true,
            true,
            true,
        ),
    );
    materials.insert(
        "dungeon-floor".to_string(),
        create_material(
            "dungeon-floor",
            11,
            "Dungeon Floor",
            "dungeon",
            "DungeonFloor",
            [91, 87, 78],
            1.6,
            false,
            false,
            true,
            true,
            true,
        ),
    );

    // 3. Palettes
    palettes.insert(
        "default".to_string(),
        MaterialPaletteContent {
            id: "default".to_string(),
            name: "Default".to_string(),
            material_ids: vec![
                "top-soil".to_string(),
                "sub-soil".to_string(),
                "rock".to_string(),
                "sand".to_string(),
                "clay".to_string(),
                "water".to_string(),
                "wood".to_string(),
                "leaves".to_string(),
                "dungeon-wall".to_string(),
                "dungeon-floor".to_string(),
            ],
        },
    );

    // 4. Texture Slots & Atlas Mappings
    let create_slot =
        |id: &str, index: u32, mat: &str, top: u32, side: u32, bottom: u32| TextureSlotContent {
            id: id.to_string(),
            name: id.to_string(),
            slot_index: index,
            material_id: Some(mat.to_string()),
            top_tile: Some(top),
            side_tile: Some(side),
            bottom_tile: Some(bottom),
            tags: vec!["terrain".to_string()],
            alias: None,
        };
    texture_slots.insert(
        "grass".to_string(),
        create_slot("grass", 0, "top-soil", 3, 7, 0),
    );
    texture_slots.insert(
        "dirt".to_string(),
        create_slot("dirt", 1, "sub-soil", 0, 0, 0),
    );
    texture_slots.insert("rock".to_string(), create_slot("rock", 2, "rock", 1, 1, 1));
    texture_slots.insert("sand".to_string(), create_slot("sand", 3, "sand", 4, 4, 4));

    let create_mapping =
        |id: &str, mat: &str, top: u32, side: u32, bottom: u32| AtlasMappingContent {
            id: id.to_string(),
            name: id.to_string(),
            material_id: mat.to_string(),
            top,
            side,
            bottom,
        };
    atlas_mappings.insert(
        "grass".to_string(),
        create_mapping("grass", "top-soil", 3, 7, 0),
    );
    atlas_mappings.insert(
        "dirt".to_string(),
        create_mapping("dirt", "sub-soil", 0, 0, 0),
    );
    atlas_mappings.insert("rock".to_string(), create_mapping("rock", "rock", 1, 1, 1));
    atlas_mappings.insert("sand".to_string(), create_mapping("sand", "sand", 4, 4, 4));

    // 5. Biomes
    let create_biome = |id: &str,
                        legacy_biome_id: u8,
                        name: &str,
                        selection_priority: u8,
                        biome_noise_min: Option<f32>,
                        biome_noise_max: Option<f32>,
                        detail_noise_min: Option<f32>,
                        detail_noise_max: Option<f32>,
                        surface: &[&str],
                        underground: &[&str],
                        shoreline_surface: &[&str],
                        shoreline_underground: &[&str]| BiomeContent {
        id: id.to_string(),
        legacy_biome_id,
        name: name.to_string(),
        selection_priority,
        biome_noise_min,
        biome_noise_max,
        detail_noise_min,
        detail_noise_max,
        default_material_id: surface[0].to_string(),
        water_material_id: Some("water".to_string()),
        surface_material_ids: surface.iter().map(|value| (*value).to_string()).collect(),
        underground_material_ids: underground
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
        shoreline_surface_material_ids: shoreline_surface
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
        shoreline_underground_material_ids: shoreline_underground
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
        prop_palette_ids: vec![],
        tags: vec![id.to_string()],
    };

    biomes.insert(
        "grassland".to_string(),
        create_biome(
            "grassland",
            0,
            "Grassland",
            0,
            None,
            None,
            None,
            None,
            &["top-soil"],
            &["sub-soil", "sub-soil", "rock"],
            &["sand"],
            &["sand", "sand", "sub-soil", "rock"],
        ),
    );
    biomes.insert(
        "sandy".to_string(),
        create_biome(
            "sandy",
            1,
            "Sandy",
            10,
            None,
            Some(0.25),
            None,
            None,
            &["sand"],
            &["sand", "sand", "sub-soil", "sub-soil", "sub-soil", "rock"],
            &["sand"],
            &["sand", "sand", "sub-soil", "sub-soil", "sub-soil", "rock"],
        ),
    );
    biomes.insert(
        "rocky".to_string(),
        create_biome(
            "rocky",
            2,
            "Rocky",
            30,
            Some(0.75),
            None,
            Some(0.5),
            None,
            &["rock"],
            &["rock", "sub-soil", "rock"],
            &["rock"],
            &["rock", "sub-soil", "rock"],
        ),
    );
    biomes.insert(
        "clay".to_string(),
        create_biome(
            "clay",
            3,
            "Clay",
            20,
            Some(0.4),
            Some(0.5),
            Some(0.6),
            None,
            &["top-soil"],
            &[
                "top-soil", "clay", "clay", "clay", "sub-soil", "sub-soil", "sub-soil", "rock",
            ],
            &["sand"],
            &["sand", "clay", "clay", "clay", "rock"],
        ),
    );

    // 6. Building Pieces
    let create_piece = |id: &str,
                        legacy_id: u32,
                        name: &str,
                        cat: &str,
                        dims: [f32; 3],
                        can_ground: bool,
                        mat_type: &str,
                        snap_points: Vec<SnapPointContent>| {
        BuildingPieceContent {
            id: id.to_string(),
            legacy_piece_type_id: Some(legacy_id),
            name: name.to_string(),
            category: cat.to_string(),
            dimensions: dims,
            snap_points,
            mesh_path: None,
            can_ground,
            material_type: mat_type.to_string(),
            material_id: None,
            support_profile: None,
        }
    };

    // Shared snap-point layouts that mirror the legacy PieceDefinition
    // constructors in gameplay/building/types.rs, so the content-driven
    // registry reproduces the same snapping behavior. Directions are stored
    // raw here and normalized at conversion time.
    let snap = |id: &str, offset: [f32; 3], dir: [f32; 3], group: &str, compat: &[&str]| {
        SnapPointContent {
            id: id.to_string(),
            local_offset: offset,
            direction: dir,
            snap_group: group.to_string(),
            compatible_groups: compat.iter().map(|s| s.to_string()).collect(),
            compatible_piece_ids: vec![],
        }
    };
    let floor_snaps = || {
        vec![
            snap(
                "edge-north",
                [0.0, 0.0, -1.0],
                [0.0, 0.0, -1.0],
                "floor-edge",
                &["floor-edge", "wall-bottom"],
            ),
            snap(
                "edge-south",
                [0.0, 0.0, 1.0],
                [0.0, 0.0, 1.0],
                "floor-edge",
                &["floor-edge", "wall-bottom"],
            ),
            snap(
                "edge-west",
                [-1.0, 0.0, 0.0],
                [-1.0, 0.0, 0.0],
                "floor-edge",
                &["floor-edge", "wall-bottom"],
            ),
            snap(
                "edge-east",
                [1.0, 0.0, 0.0],
                [1.0, 0.0, 0.0],
                "floor-edge",
                &["floor-edge", "wall-bottom"],
            ),
            snap(
                "corner-nw",
                [-1.0, 0.0, -1.0],
                [-1.0, 0.0, -1.0],
                "floor-edge",
                &["floor-edge"],
            ),
            snap(
                "corner-ne",
                [1.0, 0.0, -1.0],
                [1.0, 0.0, -1.0],
                "floor-edge",
                &["floor-edge"],
            ),
            snap(
                "corner-sw",
                [-1.0, 0.0, 1.0],
                [-1.0, 0.0, 1.0],
                "floor-edge",
                &["floor-edge"],
            ),
            snap(
                "corner-se",
                [1.0, 0.0, 1.0],
                [1.0, 0.0, 1.0],
                "floor-edge",
                &["floor-edge"],
            ),
        ]
    };
    let wall_snaps = || {
        vec![
            snap(
                "bottom",
                [0.0, 0.0, 0.0],
                [0.0, -1.0, 0.0],
                "wall-bottom",
                &["floor-edge"],
            ),
            snap(
                "top",
                [0.0, 2.0, 0.0],
                [0.0, 1.0, 0.0],
                "wall-top",
                &["wall-top", "roof-edge"],
            ),
            snap(
                "left",
                [-1.0, 1.0, 0.0],
                [-1.0, 0.0, 0.0],
                "wall-side",
                &["wall-side"],
            ),
            snap(
                "right",
                [1.0, 1.0, 0.0],
                [1.0, 0.0, 0.0],
                "wall-side",
                &["wall-side"],
            ),
        ]
    };
    let pillar_snaps = || {
        vec![
            snap(
                "bottom",
                [0.0, 0.0, 0.0],
                [0.0, -1.0, 0.0],
                "floor-edge",
                &["floor-edge"],
            ),
            snap(
                "top",
                [0.0, 2.0, 0.0],
                [0.0, 1.0, 0.0],
                "wall-top",
                &["wall-top", "roof-edge"],
            ),
        ]
    };
    let fence_snaps = || {
        vec![
            snap(
                "bottom",
                [0.0, 0.0, 0.0],
                [0.0, -1.0, 0.0],
                "wall-bottom",
                &["floor-edge"],
            ),
            snap("left", [-1.0, 0.5, 0.0], [-1.0, 0.0, 0.0], "generic", &[]),
            snap("right", [1.0, 0.5, 0.0], [1.0, 0.0, 0.0], "generic", &[]),
        ]
    };

    building_pieces.insert(
        "wood-floor".to_string(),
        create_piece(
            "wood-floor",
            1,
            "Wood Floor",
            "floor",
            [2.0, 0.2, 2.0],
            true,
            "wood",
            floor_snaps(),
        ),
    );
    building_pieces.insert(
        "wood-wall".to_string(),
        create_piece(
            "wood-wall",
            2,
            "Wood Wall",
            "wall",
            [2.0, 2.0, 0.2],
            false,
            "wood",
            wall_snaps(),
        ),
    );
    building_pieces.insert(
        "wood-fence".to_string(),
        create_piece(
            "wood-fence",
            3,
            "Wood Fence",
            "fence",
            [2.0, 1.0, 0.1],
            true,
            "wood",
            fence_snaps(),
        ),
    );
    building_pieces.insert("wood-pillar".to_string(), {
        let mut piece = create_piece(
            "wood-pillar",
            4,
            "Wood Pillar",
            "pillar",
            [0.4, 2.0, 0.4],
            true,
            "wood",
            pillar_snaps(),
        );
        piece.support_profile = Some(SupportProfileContent {
            max_support: 1.0,
            decay_per_hop: 0.05,
            class: "wood".to_string(),
        });
        piece
    });
    building_pieces.insert(
        "stone-floor".to_string(),
        create_piece(
            "stone-floor",
            10,
            "Stone Floor",
            "floor",
            [2.0, 0.2, 2.0],
            true,
            "stone",
            floor_snaps(),
        ),
    );
    building_pieces.insert(
        "stone-wall".to_string(),
        create_piece(
            "stone-wall",
            11,
            "Stone Wall",
            "wall",
            [2.0, 2.0, 0.2],
            false,
            "stone",
            wall_snaps(),
        ),
    );
    building_pieces.insert("stone-pillar".to_string(), {
        let mut piece = create_piece(
            "stone-pillar",
            12,
            "Stone Pillar",
            "pillar",
            [0.4, 2.0, 0.4],
            true,
            "stone",
            pillar_snaps(),
        );
        piece.support_profile = Some(SupportProfileContent {
            max_support: 1.0,
            decay_per_hop: 0.08,
            class: "stone".to_string(),
        });
        piece
    });
    building_pieces.insert(
        "metal-floor".to_string(),
        create_piece(
            "metal-floor",
            20,
            "Metal Floor",
            "floor",
            [2.0, 0.2, 2.0],
            true,
            "metal",
            floor_snaps(),
        ),
    );
    building_pieces.insert(
        "metal-wall".to_string(),
        create_piece(
            "metal-wall",
            21,
            "Metal Wall",
            "wall",
            [2.0, 2.0, 0.2],
            false,
            "metal",
            wall_snaps(),
        ),
    );
    building_pieces.insert(
        "thatch-wall".to_string(),
        create_piece(
            "thatch-wall",
            30,
            "Thatch Wall",
            "wall",
            [2.0, 2.0, 0.2],
            false,
            "thatch",
            wall_snaps(),
        ),
    );

    ContentRegistry {
        material_types,
        materials,
        palettes,
        texture_slots,
        atlas_mappings,
        biomes,
        props,
        building_pieces,
        protected_areas,
        objectives,
    }
}
