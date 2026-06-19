use super::cache::{self, ManifestStatus};
use super::config::{ProceduralTextureConfig, ProceduralTextureRuntimeMode};
use super::manifest::ProceduralTextureManifest;
use super::recipes::ProceduralMaterialId;
use super::texture_images::{GeneratedProceduralTextureSet, generate_procedural_texture_set};
use crate::rendering::materials::triplanar::{TriplanarMaterial, TriplanarMaterialHandle};
use crate::rendering::materials::{
    apply_procedural_textures_to_triplanar_material, configure_triplanar_textures,
    setup_triplanar_material,
};
use bevy::prelude::*;
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProceduralTextureSource {
    GeneratedRuntime,
    CachedAsset,
}

#[derive(Clone, Resource)]
pub struct ProceduralTerrainTextureHandles {
    pub grass_albedo: Handle<Image>,
    pub grass_normal: Handle<Image>,
    pub rock_albedo: Handle<Image>,
    pub rock_normal: Handle<Image>,
    pub sand_albedo: Handle<Image>,
    pub sand_normal: Handle<Image>,
    pub dirt_albedo: Handle<Image>,
    pub dirt_normal: Handle<Image>,
    pub manifest: ProceduralTextureManifest,
    pub source: ProceduralTextureSource,
}

pub struct ProceduralTexturePlugin;

impl Plugin for ProceduralTexturePlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(
            Startup,
            setup_procedural_terrain_textures.before(setup_triplanar_material),
        )
        .add_systems(
            Update,
            sync_procedural_textures_to_triplanar_materials.before(configure_triplanar_textures),
        );
    }
}

fn handles_from_generated(
    generated: GeneratedProceduralTextureSet,
    images: &mut Assets<Image>,
) -> ProceduralTerrainTextureHandles {
    let manifest = generated.manifest.clone();
    let mut by_id = BTreeMap::new();
    for material in generated.materials {
        by_id.insert(
            material.id,
            (
                images.add(material.albedo_image()),
                images.add(material.normal_image()),
            ),
        );
    }

    handles_from_map(manifest, ProceduralTextureSource::GeneratedRuntime, by_id)
}

fn handles_from_cache(
    config: &ProceduralTextureConfig,
    manifest: ProceduralTextureManifest,
    asset_server: &AssetServer,
) -> ProceduralTerrainTextureHandles {
    let mut by_id = BTreeMap::new();
    for id in ProceduralMaterialId::BEVY_TERRAIN_SLOTS {
        by_id.insert(
            id,
            (
                asset_server.load(cache::asset_path(
                    &config.cache_dir,
                    &cache::material_albedo_filename(id),
                )),
                asset_server.load(cache::asset_path(
                    &config.cache_dir,
                    &cache::material_normal_filename(id),
                )),
            ),
        );
    }
    handles_from_map(manifest, ProceduralTextureSource::CachedAsset, by_id)
}

fn handles_from_map(
    manifest: ProceduralTextureManifest,
    source: ProceduralTextureSource,
    mut by_id: BTreeMap<ProceduralMaterialId, (Handle<Image>, Handle<Image>)>,
) -> ProceduralTerrainTextureHandles {
    let (grass_albedo, grass_normal) = by_id
        .remove(&ProceduralMaterialId::Grass)
        .expect("generated grass texture handles");
    let (rock_albedo, rock_normal) = by_id
        .remove(&ProceduralMaterialId::Rock)
        .expect("generated rock texture handles");
    let (sand_albedo, sand_normal) = by_id
        .remove(&ProceduralMaterialId::Sand)
        .expect("generated sand texture handles");
    let (dirt_albedo, dirt_normal) = by_id
        .remove(&ProceduralMaterialId::Dirt)
        .expect("generated dirt texture handles");
    ProceduralTerrainTextureHandles {
        grass_albedo,
        grass_normal,
        rock_albedo,
        rock_normal,
        sand_albedo,
        sand_normal,
        dirt_albedo,
        dirt_normal,
        manifest,
        source,
    }
}

pub fn setup_procedural_terrain_textures(
    mut commands: Commands,
    mut images: ResMut<Assets<Image>>,
    asset_server: Res<AssetServer>,
) {
    let config = match ProceduralTextureConfig::load_or_default() {
        Ok(config) => config,
        Err(error) => {
            warn!("Procedural terrain textures disabled: {error}");
            return;
        }
    };

    if !config.enabled {
        info!("Procedural terrain textures disabled by config");
        return;
    }

    let expected_manifest = match ProceduralTextureManifest::expected(&config) {
        Ok(manifest) => manifest,
        Err(error) => {
            warn!("Procedural terrain textures disabled: {error}");
            return;
        }
    };
    let cache_status = match cache::manifest_status(&config.cache_dir, &expected_manifest) {
        Ok(status) => status,
        Err(error) => {
            warn!("Procedural texture cache ignored: {error}");
            ManifestStatus::Missing
        }
    };
    let cache_files_ready = cache_status == ManifestStatus::Match
        && cache::all_bevy_slot_cache_files_exist(&config.cache_dir);

    if cache_files_ready && config.runtime_mode != ProceduralTextureRuntimeMode::ForceRegenerate {
        let handles = handles_from_cache(&config, expected_manifest, &asset_server);
        commands.insert_resource(handles);
        info!("Procedural terrain textures loaded from cache");
        return;
    }

    if config.runtime_mode == ProceduralTextureRuntimeMode::CacheOnly {
        warn!(
            "Procedural terrain texture cache_only mode found no matching cache; keeping existing terrain PBR textures"
        );
        return;
    }

    let generated = match generate_procedural_texture_set(&config) {
        Ok(generated) => generated,
        Err(error) => {
            warn!(
                "Procedural terrain texture generation failed; keeping existing terrain PBR textures: {error}"
            );
            return;
        }
    };

    if let Err(error) = generated.write_cache(&config.cache_dir) {
        warn!("Procedural terrain texture cache write failed: {error}");
    }
    let handles = handles_from_generated(generated, &mut images);
    commands.insert_resource(handles);
    info!("Procedural terrain textures generated for Bevy triplanar terrain");
}

fn triplanar_material_handles(
    handles: &TriplanarMaterialHandle,
) -> [&Handle<TriplanarMaterial>; 10] {
    [
        &handles.handle,
        &handles.cheap_handle,
        &handles.single_projection_far_handle,
        &handles.horizon_proxy_handle,
        &handles.atlas_only_debug_handle,
        &handles.wireframe_debug_handle,
        &handles.normals_debug_handle,
        &handles.wireframe_normals_debug_handle,
        &handles.flat_unlit_debug_handle,
        &handles.wireframe_flat_unlit_debug_handle,
    ]
}

fn patch_triplanar_material(
    material: &mut TriplanarMaterial,
    handles: &ProceduralTerrainTextureHandles,
) -> bool {
    if material.uniforms.procedural_textures_enabled > 0.5 {
        return false;
    }
    apply_procedural_textures_to_triplanar_material(material, handles);
    true
}

pub fn sync_procedural_textures_to_triplanar_materials(
    generated_handles: Option<Res<ProceduralTerrainTextureHandles>>,
    triplanar_handles: Option<Res<TriplanarMaterialHandle>>,
    mut materials: ResMut<Assets<TriplanarMaterial>>,
    mut applied: Local<bool>,
) {
    if *applied {
        return;
    }
    let (Some(generated_handles), Some(triplanar_handles)) =
        (generated_handles.as_deref(), triplanar_handles.as_deref())
    else {
        return;
    };

    let mut patched = 0;
    for handle in triplanar_material_handles(triplanar_handles) {
        if let Some(material) = materials.get_mut(handle) {
            if patch_triplanar_material(material, generated_handles) {
                patched += 1;
            }
        }
    }

    if patched > 0 {
        *applied = true;
        info!(
            "Patched {patched} triplanar terrain materials with procedural textures ({:?})",
            generated_handles.source
        );
    } else if triplanar_material_handles(triplanar_handles)
        .into_iter()
        .all(|handle| {
            materials
                .get(handle)
                .is_some_and(|material| material.uniforms.procedural_textures_enabled > 0.5)
        })
    {
        *applied = true;
    }
}
