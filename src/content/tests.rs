#[cfg(test)]
mod tests {
    use super::super::defaults::get_default_registry;
    use super::super::types::*;
    use super::super::validate::validate_content_registry;
    use crate::gameplay::building::types::{BuildingPieceRegistry, PieceTypeId};
    use crate::rendering::array_loader::AtlasMapping;
    use crate::voxel::materials::{MaterialCatalog, MaterialId};

    // Test 1: default content registry validates ok
    #[test]
    fn test_default_registry_validates_ok() {
        let registry = get_default_registry();
        let report = validate_content_registry(&registry);
        assert!(
            report.ok(),
            "Default registry validation failed: {:?}",
            report.errors
        );
    }

    // Test 2: materials YAML roundtrips
    #[test]
    fn test_materials_yaml_roundtrips() {
        let registry = get_default_registry();

        #[derive(serde::Serialize, serde::Deserialize)]
        struct MaterialsFile {
            material_types: Vec<MaterialTypeContent>,
            materials: Vec<MaterialContent>,
            palettes: Vec<MaterialPaletteContent>,
        }

        let original = MaterialsFile {
            material_types: registry.material_types.values().cloned().collect(),
            materials: registry.materials.values().cloned().collect(),
            palettes: registry.palettes.values().cloned().collect(),
        };

        let yaml_str = serde_yaml::to_string(&original).unwrap();
        let deserialized: MaterialsFile = serde_yaml::from_str(&yaml_str).unwrap();

        assert_eq!(original.materials.len(), deserialized.materials.len());
        assert_eq!(
            original.material_types.len(),
            deserialized.material_types.len()
        );
        assert_eq!(original.palettes.len(), deserialized.palettes.len());
    }

    // Test 3: all legacy material IDs map to valid current VoxelType discriminants
    #[test]
    fn test_legacy_material_ids_valid_voxel_type() {
        let mut registry = get_default_registry();
        if let Some(mat) = registry.materials.get_mut("rock") {
            mat.legacy_material_id = Some(15); // > 11
        }
        let report = validate_content_registry(&registry);
        assert!(report.has_errors());
        assert!(
            report
                .errors
                .iter()
                .any(|e| e.code == "INVALID_VOXEL_TYPE_DISCRIMINANT")
        );
    }

    // Test 4: missing material type fails
    #[test]
    fn test_missing_material_type_fails() {
        let mut registry = get_default_registry();
        if let Some(mat) = registry.materials.get_mut("rock") {
            mat.material_type_id = "non-existent-type".to_string();
        }
        let report = validate_content_registry(&registry);
        assert!(report.has_errors());
        assert!(
            report
                .errors
                .iter()
                .any(|e| e.code == "MISSING_MATERIAL_TYPE_REF")
        );
    }

    // Test 5: palette referencing missing material fails
    #[test]
    fn test_palette_referencing_missing_material_fails() {
        let mut registry = get_default_registry();
        if let Some(palette) = registry.palettes.get_mut("default") {
            palette.material_ids.push("missing-material".to_string());
        }
        let report = validate_content_registry(&registry);
        assert!(report.has_errors());
        assert!(
            report
                .errors
                .iter()
                .any(|e| e.code == "MISSING_MATERIAL_REF")
        );
    }

    // Test 6: water not transparent fails
    #[test]
    fn test_water_not_transparent_fails() {
        let mut registry = get_default_registry();
        if let Some(water) = registry.materials.get_mut("water") {
            water.transparent = false;
        }
        let report = validate_content_registry(&registry);
        assert!(report.has_errors());
        assert!(
            report
                .errors
                .iter()
                .any(|e| e.code == "INVALID_WATER_PROPERTIES")
        );
    }

    // Test 7: bedrock diggable fails
    #[test]
    fn test_bedrock_diggable_fails() {
        let mut registry = get_default_registry();
        if let Some(bedrock) = registry.materials.get_mut("bedrock") {
            bedrock.diggable = true;
        }
        let report = validate_content_registry(&registry);
        assert!(report.has_errors());
        assert!(
            report
                .errors
                .iter()
                .any(|e| e.code == "BEDROCK_IS_DIGGABLE")
        );
    }

    // Test 8: atlas mapping referencing missing material fails
    #[test]
    fn test_atlas_mapping_referencing_missing_material_fails() {
        let mut registry = get_default_registry();
        if let Some(mapping) = registry.atlas_mappings.get_mut("grass") {
            mapping.material_id = "missing-mat".to_string();
        }
        let report = validate_content_registry(&registry);
        assert!(report.has_errors());
        assert!(
            report
                .errors
                .iter()
                .any(|e| e.code == "MISSING_MATERIAL_REF")
        );
    }

    // Test 9: invalid atlas tile index fails
    #[test]
    fn test_invalid_atlas_tile_index_fails() {
        let mut registry = get_default_registry();
        if let Some(mapping) = registry.atlas_mappings.get_mut("grass") {
            mapping.top = 20; // > 15
        }
        let report = validate_content_registry(&registry);
        assert!(report.has_errors());
        assert!(report.errors.iter().any(|e| e.code == "INVALID_TILE_INDEX"));
    }

    // Test 10: biome referencing missing material fails
    #[test]
    fn test_biome_referencing_missing_material_fails() {
        let mut registry = get_default_registry();
        if let Some(biome) = registry.biomes.get_mut("grassland") {
            biome.default_material_id = "missing-material".to_string();
        }
        let report = validate_content_registry(&registry);
        assert!(report.has_errors());
        assert!(
            report
                .errors
                .iter()
                .any(|e| e.code == "MISSING_MATERIAL_REF")
        );
    }

    // Test 11: prop referencing missing biome fails
    #[test]
    fn test_prop_referencing_missing_biome_fails() {
        let mut registry = get_default_registry();
        registry.props.insert(
            "pine-tree".to_string(),
            PropContent {
                id: "pine-tree".to_string(),
                name: "Pine Tree".to_string(),
                category: "tree".to_string(),
                asset_path: Some("models/pine.glb".to_string()),
                biome_ids: vec!["missing-biome".to_string()],
                footprint: [1.0, 5.0, 1.0],
                spawn_weight: 1.0,
                can_spawn_on_material_ids: vec!["top-soil".to_string()],
                blocked_by_protected_area: true,
            },
        );
        let report = validate_content_registry(&registry);
        assert!(report.has_errors());
        assert!(report.errors.iter().any(|e| e.code == "MISSING_BIOME_REF"));
    }

    // Test 12: building piece invalid dimensions fail
    #[test]
    fn test_building_piece_invalid_dimensions_fail() {
        let mut registry = get_default_registry();
        if let Some(piece) = registry.building_pieces.get_mut("wood-floor") {
            piece.dimensions = [-1.0, 0.2, 2.0];
        }
        let report = validate_content_registry(&registry);
        assert!(report.has_errors());
        assert!(report.errors.iter().any(|e| e.code == "INVALID_DIMENSIONS"));
    }

    // Test 13: snap point invalid direction fails
    #[test]
    fn test_snap_point_invalid_direction_fails() {
        let mut registry = get_default_registry();
        if let Some(piece) = registry.building_pieces.get_mut("wood-floor") {
            if let Some(sp) = piece.snap_points.first_mut() {
                sp.direction = [0.0, 0.0, 0.0];
            }
        }
        let report = validate_content_registry(&registry);
        assert!(report.has_errors());
        assert!(
            report
                .errors
                .iter()
                .any(|e| e.code == "UNNORMALIZABLE_SNAP_DIRECTION")
        );
    }

    // Test 14: snap compatible piece missing fails
    #[test]
    fn test_snap_compatible_piece_missing_fails() {
        let mut registry = get_default_registry();
        if let Some(piece) = registry.building_pieces.get_mut("wood-floor") {
            if let Some(sp) = piece.snap_points.first_mut() {
                sp.compatible_piece_ids.push("missing-piece".to_string());
            }
        }
        let report = validate_content_registry(&registry);
        assert!(report.has_errors());
        assert!(
            report
                .errors
                .iter()
                .any(|e| e.code == "MISSING_COMPATIBLE_PIECE_REF")
        );
    }

    // Test 15: protected area invalid radius/half extents fail
    #[test]
    fn test_protected_area_invalid_dimensions_fail() {
        let mut registry = get_default_registry();
        registry.protected_areas.insert(
            "spawn-zone".to_string(),
            ProtectedAreaContent {
                id: "spawn-zone".to_string(),
                name: "Spawn Zone".to_string(),
                shape: ProtectedAreaShapeContent::Box {
                    center: [0.0, 0.0, 0.0],
                    half_extents: [-1.0, 2.0, 2.0],
                },
                rule: "protected".to_string(),
                material_overrides: vec![],
                allow_building: false,
                allow_terrain_edit: false,
                allow_prop_edit: false,
            },
        );
        let report = validate_content_registry(&registry);
        assert!(report.has_errors());
        assert!(
            report
                .errors
                .iter()
                .any(|e| e.code == "INVALID_HALF_EXTENTS")
        );
    }

    // Test 16: objective self-cycle fails
    #[test]
    fn test_objective_self_cycle_fails() {
        let mut registry = get_default_registry();
        registry.objectives.insert(
            "gather-wood".to_string(),
            ObjectiveContent {
                id: "gather-wood".to_string(),
                name: "Gather Wood".to_string(),
                kind: "gather".to_string(),
                required_material_ids: vec![],
                required_prop_ids: vec![],
                required_biome_ids: vec![],
                next_objective_ids: vec!["gather-wood".to_string()],
                notes: None,
            },
        );
        let report = validate_content_registry(&registry);
        assert!(report.has_errors());
        assert!(
            report
                .errors
                .iter()
                .any(|e| e.code == "OBJECTIVE_CYCLE_DETECTED")
        );
    }

    // Test 17: forbidden World of Claudecraft/MMO terms fail if present in production content
    #[test]
    fn test_forbidden_mmo_terms_fail() {
        let mut registry = get_default_registry();
        if let Some(mat) = registry.materials.get_mut("rock") {
            mat.name = "Claudecraft Rock".to_string();
        }
        let report = validate_content_registry(&registry);
        assert!(report.has_errors());
        assert!(report.errors.iter().any(|e| e.code == "BANNED_TERM"));
    }

    // Test 18: MaterialCatalog::from_content_registry preserves current default material count and active material behavior
    #[test]
    fn test_material_catalog_conversion() {
        let registry = get_default_registry();
        let converted = MaterialCatalog::from_content_registry(&registry).unwrap();
        let default_cat = MaterialCatalog::default();

        assert_eq!(converted.materials.len(), default_cat.materials.len());
        assert_eq!(
            converted.material_types.len(),
            default_cat.material_types.len()
        );
        assert_eq!(converted.active_material_id, MaterialId(1));
        assert!(converted.contains_material(MaterialId(0))); // Air
        assert!(converted.contains_material(MaterialId(1))); // Top Soil
        assert!(converted.contains_material(MaterialId(11))); // Dungeon Floor
    }

    // Test 19: AtlasMapping::from_content_registry preserves current grass/dirt/rock/sand defaults
    #[test]
    fn test_atlas_mapping_conversion() {
        let registry = get_default_registry();
        let converted = AtlasMapping::from_content_registry(&registry).unwrap();

        assert_eq!(converted.grass.top, 3);
        assert_eq!(converted.grass.side, 7);
        assert_eq!(converted.grass.bottom, 0);

        assert_eq!(converted.dirt.top, 0);
        assert_eq!(converted.dirt.side, 0);
        assert_eq!(converted.dirt.bottom, 0);

        assert_eq!(converted.rock.top, 1);
        assert_eq!(converted.rock.side, 1);
        assert_eq!(converted.rock.bottom, 1);

        assert_eq!(converted.sand.top, 4);
        assert_eq!(converted.sand.side, 4);
        assert_eq!(converted.sand.bottom, 4);
    }

    // Test 20: BuildingPieceRegistry::from_content_registry preserves current default piece IDs
    #[test]
    fn test_building_piece_registry_conversion() {
        use crate::gameplay::building::SupportClass;

        let registry = get_default_registry();
        let converted = BuildingPieceRegistry::from_content_registry(&registry);

        let expected_ids = vec![1, 2, 3, 4, 10, 11, 12, 20, 21, 30];
        for id in expected_ids {
            assert!(
                converted.get(PieceTypeId(id)).is_some(),
                "Default piece ID {} should be registered",
                id
            );
        }

        let floor = converted.get(PieceTypeId(1)).expect("wood floor");
        assert_eq!(floor.support_profile.class, SupportClass::Wood);
        assert_eq!(floor.support_profile.decay_per_hop, 0.08);

        let wood_pillar = converted.get(PieceTypeId(4)).expect("wood pillar");
        assert_eq!(wood_pillar.support_profile.decay_per_hop, 0.05);
        let stone_pillar = converted.get(PieceTypeId(12)).expect("stone pillar");
        assert_eq!(stone_pillar.support_profile.class, SupportClass::Stone);
        assert_eq!(stone_pillar.support_profile.decay_per_hop, 0.08);
    }

    // Test 21: converted pieces keep their full snap-point sets so building
    // snapping matches the legacy PieceDefinition constructors (regression
    // guard against thinning floors/walls down to one or two snaps).
    #[test]
    fn test_building_piece_snap_points_preserved() {
        use crate::gameplay::building::types::SnapGroup;

        let registry = get_default_registry();
        let converted = BuildingPieceRegistry::from_content_registry(&registry);

        // Floors expose 4 edges + 4 corners.
        let floor = converted.get(PieceTypeId(1)).expect("wood-floor");
        assert_eq!(
            floor.snap_points.len(),
            8,
            "wood-floor should expose 8 snap points (4 edges + 4 corners)"
        );

        // Walls expose bottom, top, and two wall-side points so they snap
        // edge-to-edge.
        let wall = converted.get(PieceTypeId(2)).expect("wood-wall");
        assert_eq!(
            wall.snap_points.len(),
            4,
            "wood-wall should expose 4 snap points"
        );
        let wall_sides = wall
            .snap_points
            .iter()
            .filter(|sp| sp.snap_group == SnapGroup::WallSide)
            .count();
        assert_eq!(
            wall_sides, 2,
            "wood-wall must keep its two wall-side snaps for edge-to-edge placement"
        );

        // Every floor/wall variant should match its template, not regress to a
        // single snap point.
        assert_eq!(converted.get(PieceTypeId(10)).unwrap().snap_points.len(), 8);
        assert_eq!(converted.get(PieceTypeId(20)).unwrap().snap_points.len(), 8);
        assert_eq!(converted.get(PieceTypeId(11)).unwrap().snap_points.len(), 4);
        assert_eq!(converted.get(PieceTypeId(21)).unwrap().snap_points.len(), 4);
        assert_eq!(converted.get(PieceTypeId(30)).unwrap().snap_points.len(), 4);
    }

    // Test 22: the shipped YAML in assets/content parses (strict) and validates
    // cleanly. Guards hand-edited content files, including the oak-tree asset
    // path and the wall snap-point set.
    #[test]
    fn test_shipped_content_yaml_loads_and_validates() {
        use super::super::loader::load_content_registry;
        use std::path::Path;

        let registry = load_content_registry(Path::new("assets/content"), true)
            .expect("assets/content should load in strict mode");
        let report = validate_content_registry(&registry);
        assert!(
            report.ok(),
            "shipped content validation failed: {:?}",
            report.errors
        );

        // asset_path must be a plain path, not leaked Rust Option syntax.
        let oak = registry.props.get("oak-tree").expect("oak-tree prop");
        assert_eq!(oak.asset_path.as_deref(), Some("models/oak_tree.glb"));

        // Walls keep all four snap points (incl. the two wall-side ones) when
        // loaded from YAML.
        let wall = registry
            .building_pieces
            .get("wood-wall")
            .expect("wood-wall piece");
        assert_eq!(wall.snap_points.len(), 4);

        let wood_pillar = registry
            .building_pieces
            .get("wood-pillar")
            .and_then(|piece| piece.support_profile.as_ref())
            .expect("wood pillar support profile");
        assert_eq!(wood_pillar.decay_per_hop, 0.05);
        assert_eq!(wood_pillar.class, "wood");

        let stone_pillar = registry
            .building_pieces
            .get("stone-pillar")
            .and_then(|piece| piece.support_profile.as_ref())
            .expect("stone pillar support profile");
        assert_eq!(stone_pillar.decay_per_hop, 0.08);
        assert_eq!(stone_pillar.class, "stone");
    }

    #[test]
    fn test_building_support_profile_validation() {
        let mut registry = get_default_registry();
        let piece = registry
            .building_pieces
            .get_mut("wood-floor")
            .expect("wood floor");
        piece.support_profile = Some(SupportProfileContent {
            max_support: 0.0,
            decay_per_hop: -0.1,
            class: "iron".to_string(),
        });

        let report = validate_content_registry(&registry);
        assert!(
            report
                .errors
                .iter()
                .any(|issue| issue.code == "INVALID_MAX_SUPPORT")
        );
        assert!(
            report
                .errors
                .iter()
                .any(|issue| issue.code == "INVALID_SUPPORT_DECAY")
        );
        assert!(
            report
                .errors
                .iter()
                .any(|issue| issue.code == "INVALID_SUPPORT_CLASS")
        );
    }

    #[test]
    fn test_biome_legacy_ids_are_unique_complete_and_in_range() {
        let mut duplicate = get_default_registry();
        duplicate.biomes.get_mut("sandy").unwrap().legacy_biome_id = 0;
        let duplicate_report = validate_content_registry(&duplicate);
        assert!(
            duplicate_report
                .errors
                .iter()
                .any(|issue| issue.code == "DUPLICATE_LEGACY_BIOME_ID")
        );
        assert!(
            duplicate_report
                .errors
                .iter()
                .any(|issue| issue.code == "MISSING_LEGACY_BIOME_ID")
        );

        let mut out_of_range = get_default_registry();
        out_of_range.biomes.get_mut("clay").unwrap().legacy_biome_id = 4;
        let range_report = validate_content_registry(&out_of_range);
        assert!(
            range_report
                .errors
                .iter()
                .any(|issue| issue.code == "INVALID_LEGACY_BIOME_ID")
        );
    }

    #[test]
    fn test_biome_material_bands_require_resolvable_voxel_materials() {
        let mut empty = get_default_registry();
        empty
            .biomes
            .get_mut("grassland")
            .unwrap()
            .shoreline_underground_material_ids
            .clear();
        let empty_report = validate_content_registry(&empty);
        assert!(
            empty_report
                .errors
                .iter()
                .any(|issue| issue.code == "EMPTY_BIOME_MATERIAL_BANDS")
        );

        let mut missing_mapping = get_default_registry();
        missing_mapping
            .materials
            .get_mut("top-soil")
            .unwrap()
            .legacy_material_id = None;
        let mapping_report = validate_content_registry(&missing_mapping);
        assert!(
            mapping_report
                .errors
                .iter()
                .any(|issue| issue.code == "MISSING_LEGACY_MATERIAL_ID")
        );
    }

    #[test]
    fn test_biome_selection_requires_valid_ranges_and_priorities() {
        let mut invalid_range = get_default_registry();
        let sandy = invalid_range.biomes.get_mut("sandy").unwrap();
        sandy.biome_noise_min = Some(0.5);
        sandy.biome_noise_max = Some(0.25);
        let range_report = validate_content_registry(&invalid_range);
        assert!(
            range_report
                .errors
                .iter()
                .any(|issue| issue.code == "INVALID_BIOME_SELECTION_RANGE")
        );

        let mut duplicate_priority = get_default_registry();
        duplicate_priority
            .biomes
            .get_mut("clay")
            .unwrap()
            .selection_priority = 30;
        let priority_report = validate_content_registry(&duplicate_priority);
        assert!(
            priority_report
                .errors
                .iter()
                .any(|issue| issue.code == "DUPLICATE_BIOME_SELECTION_PRIORITY")
        );
    }

    #[test]
    fn test_biome_selection_requires_exactly_one_low_priority_fallback() {
        let mut missing_fallback = get_default_registry();
        let grassland = missing_fallback.biomes.get_mut("grassland").unwrap();
        grassland.biome_noise_min = Some(0.0);
        grassland.selection_priority = 1;
        let missing_report = validate_content_registry(&missing_fallback);
        assert!(
            missing_report
                .errors
                .iter()
                .any(|issue| issue.code == "INVALID_BIOME_FALLBACK_COUNT")
        );

        let mut invalid_priority = get_default_registry();
        invalid_priority
            .biomes
            .get_mut("grassland")
            .unwrap()
            .selection_priority = 4;
        let priority_report = validate_content_registry(&invalid_priority);
        assert!(
            priority_report
                .errors
                .iter()
                .any(|issue| issue.code == "INVALID_BIOME_FALLBACK_PRIORITY")
        );
    }
}
