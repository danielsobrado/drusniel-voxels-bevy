use bevy::prelude::*;
use serde::Deserialize;
use std::fs;
use std::path::Path;

use super::errors::ContentLoadError;
use super::registry::ContentRegistry;
use super::types::*;

pub fn load_content_registry(
    dir: &Path,
    strict: bool,
) -> Result<ContentRegistry, ContentLoadError> {
    let mut registry = crate::content::defaults::get_default_registry();

    // 1. Load and merge materials.yaml
    let materials_path = dir.join("materials.yaml");
    if materials_path.exists() {
        let contents =
            fs::read_to_string(&materials_path).map_err(|e| ContentLoadError::IoError {
                path: materials_path.display().to_string(),
                error: e.to_string(),
            })?;

        #[derive(Deserialize)]
        struct MaterialsFile {
            material_types: Option<Vec<MaterialTypeContent>>,
            materials: Option<Vec<MaterialContent>>,
            palettes: Option<Vec<MaterialPaletteContent>>,
        }

        match serde_yaml::from_str::<MaterialsFile>(&contents) {
            Ok(file) => {
                if let Some(types) = file.material_types {
                    for t in types {
                        registry.material_types.insert(t.id.clone(), t);
                    }
                }
                if let Some(mats) = file.materials {
                    for m in mats {
                        registry.materials.insert(m.id.clone(), m);
                    }
                }
                if let Some(pals) = file.palettes {
                    for p in pals {
                        registry.palettes.insert(p.id.clone(), p);
                    }
                }
            }
            Err(e) => {
                if strict {
                    return Err(ContentLoadError::YamlError {
                        path: materials_path.display().to_string(),
                        error: e.to_string(),
                    });
                } else {
                    warn!("Failed to parse materials.yaml: {}", e);
                }
            }
        }
    } else {
        if strict {
            return Err(ContentLoadError::IoError {
                path: materials_path.display().to_string(),
                error: "File not found".to_string(),
            });
        } else {
            info!("No materials.yaml found, using defaults");
        }
    }

    // 2. Load and merge atlas_mappings.yaml
    let atlas_path = dir.join("atlas_mappings.yaml");
    if atlas_path.exists() {
        let contents = fs::read_to_string(&atlas_path).map_err(|e| ContentLoadError::IoError {
            path: atlas_path.display().to_string(),
            error: e.to_string(),
        })?;

        #[derive(Deserialize)]
        struct AtlasFile {
            texture_slots: Option<Vec<TextureSlotContent>>,
            atlas_mappings: Option<Vec<AtlasMappingContent>>,
        }

        match serde_yaml::from_str::<AtlasFile>(&contents) {
            Ok(file) => {
                if let Some(slots) = file.texture_slots {
                    for s in slots {
                        registry.texture_slots.insert(s.id.clone(), s);
                    }
                }
                if let Some(mappings) = file.atlas_mappings {
                    for m in mappings {
                        registry.atlas_mappings.insert(m.id.clone(), m);
                    }
                }
            }
            Err(e) => {
                if strict {
                    return Err(ContentLoadError::YamlError {
                        path: atlas_path.display().to_string(),
                        error: e.to_string(),
                    });
                } else {
                    warn!("Failed to parse atlas_mappings.yaml: {}", e);
                }
            }
        }
    }

    // 3. Load and merge biomes.yaml
    let biomes_path = dir.join("biomes.yaml");
    if biomes_path.exists() {
        let contents = fs::read_to_string(&biomes_path).map_err(|e| ContentLoadError::IoError {
            path: biomes_path.display().to_string(),
            error: e.to_string(),
        })?;

        #[derive(Deserialize)]
        struct BiomesFile {
            biomes: Option<Vec<BiomeContent>>,
        }

        match serde_yaml::from_str::<BiomesFile>(&contents) {
            Ok(file) => {
                if let Some(bm) = file.biomes {
                    for b in bm {
                        registry.biomes.insert(b.id.clone(), b);
                    }
                }
            }
            Err(e) => {
                if strict {
                    return Err(ContentLoadError::YamlError {
                        path: biomes_path.display().to_string(),
                        error: e.to_string(),
                    });
                } else {
                    warn!("Failed to parse biomes.yaml: {}", e);
                }
            }
        }
    }

    // 4. Load and merge props.yaml
    let props_path = dir.join("props.yaml");
    if props_path.exists() {
        let contents = fs::read_to_string(&props_path).map_err(|e| ContentLoadError::IoError {
            path: props_path.display().to_string(),
            error: e.to_string(),
        })?;

        #[derive(Deserialize)]
        struct PropsFile {
            props: Option<Vec<PropContent>>,
        }

        match serde_yaml::from_str::<PropsFile>(&contents) {
            Ok(file) => {
                if let Some(pr) = file.props {
                    for p in pr {
                        registry.props.insert(p.id.clone(), p);
                    }
                }
            }
            Err(e) => {
                if strict {
                    return Err(ContentLoadError::YamlError {
                        path: props_path.display().to_string(),
                        error: e.to_string(),
                    });
                } else {
                    warn!("Failed to parse props.yaml: {}", e);
                }
            }
        }
    }

    // 5. Load and merge building_pieces.yaml
    let building_pieces_path = dir.join("building_pieces.yaml");
    if building_pieces_path.exists() {
        let contents =
            fs::read_to_string(&building_pieces_path).map_err(|e| ContentLoadError::IoError {
                path: building_pieces_path.display().to_string(),
                error: e.to_string(),
            })?;

        #[derive(Deserialize)]
        struct PiecesFile {
            building_pieces: Option<Vec<BuildingPieceContent>>,
        }

        match serde_yaml::from_str::<PiecesFile>(&contents) {
            Ok(file) => {
                if let Some(pieces) = file.building_pieces {
                    for p in pieces {
                        registry.building_pieces.insert(p.id.clone(), p);
                    }
                }
            }
            Err(e) => {
                if strict {
                    return Err(ContentLoadError::YamlError {
                        path: building_pieces_path.display().to_string(),
                        error: e.to_string(),
                    });
                } else {
                    warn!("Failed to parse building_pieces.yaml: {}", e);
                }
            }
        }
    }

    // 6. Load and merge protected_areas.yaml
    let protected_areas_path = dir.join("protected_areas.yaml");
    if protected_areas_path.exists() {
        let contents =
            fs::read_to_string(&protected_areas_path).map_err(|e| ContentLoadError::IoError {
                path: protected_areas_path.display().to_string(),
                error: e.to_string(),
            })?;

        #[derive(Deserialize)]
        struct ProtectedFile {
            protected_areas: Option<Vec<ProtectedAreaContent>>,
        }

        match serde_yaml::from_str::<ProtectedFile>(&contents) {
            Ok(file) => {
                if let Some(areas) = file.protected_areas {
                    for a in areas {
                        registry.protected_areas.insert(a.id.clone(), a);
                    }
                }
            }
            Err(e) => {
                if strict {
                    return Err(ContentLoadError::YamlError {
                        path: protected_areas_path.display().to_string(),
                        error: e.to_string(),
                    });
                } else {
                    warn!("Failed to parse protected_areas.yaml: {}", e);
                }
            }
        }
    }

    // 7. Load and merge objectives.yaml
    let objectives_path = dir.join("objectives.yaml");
    if objectives_path.exists() {
        let contents =
            fs::read_to_string(&objectives_path).map_err(|e| ContentLoadError::IoError {
                path: objectives_path.display().to_string(),
                error: e.to_string(),
            })?;

        #[derive(Deserialize)]
        struct ObjectivesFile {
            objectives: Option<Vec<ObjectiveContent>>,
        }

        match serde_yaml::from_str::<ObjectivesFile>(&contents) {
            Ok(file) => {
                if let Some(objs) = file.objectives {
                    for o in objs {
                        registry.objectives.insert(o.id.clone(), o);
                    }
                }
            }
            Err(e) => {
                if strict {
                    return Err(ContentLoadError::YamlError {
                        path: objectives_path.display().to_string(),
                        error: e.to_string(),
                    });
                } else {
                    warn!("Failed to parse objectives.yaml: {}", e);
                }
            }
        }
    }

    Ok(registry)
}
