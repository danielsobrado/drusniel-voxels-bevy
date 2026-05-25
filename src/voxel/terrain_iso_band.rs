//! CPU-built mesher SDF brick for the terrain iso-band debug overlay (WIRE-007).

use crate::camera::controller::PlayerCamera;
use crate::rendering::triplanar_material::{TerrainIsoBandUniforms, TriplanarMaterial};
use crate::voxel::meshing::mesher_smoothed_sdf_at_world_pos;
use crate::voxel::terrain_debug::TerrainDebugMaterialHandles;
use crate::voxel::world::VoxelWorld;
use bevy::asset::RenderAssetUsages;
use bevy::prelude::*;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat, TextureUsages};

pub const ISO_BAND_VOLUME_RESOLUTION: UVec3 = UVec3::new(64, 48, 64);
pub const ISO_BAND_WORLD_EXTENT: Vec3 = Vec3::new(64.0, 48.0, 64.0);
pub const ISO_BAND_EPSILON: f32 = 0.35;
pub const ISO_BAND_MISMATCH_THRESHOLD: f32 = 0.55;
const ISO_BAND_UPDATE_INTERVAL_SECS: f32 = 0.35;
const ISO_BAND_CAMERA_REBUILD_DISTANCE: f32 = 12.0;

/// Shared 3D SDF brick uploaded while iso-band debug is active.
#[derive(Resource, Clone, Debug)]
pub struct TerrainIsoBandVolume {
    pub texture: Handle<Image>,
    pub uniforms: TerrainIsoBandUniforms,
    last_center: Option<Vec3>,
    last_update_secs: f32,
}

impl TerrainIsoBandVolume {
    pub fn new(texture: Handle<Image>) -> Self {
        Self {
            texture,
            uniforms: TerrainIsoBandUniforms::default(),
            last_center: None,
            last_update_secs: 0.0,
        }
    }

    pub fn active(&self) -> bool {
        self.uniforms.epsilon > 0.0
    }
}

pub fn create_iso_band_volume_image() -> Image {
    let res = ISO_BAND_VOLUME_RESOLUTION;
    let size = Extent3d {
        width: res.x,
        height: res.y,
        depth_or_array_layers: res.z,
    };
    let byte_len = (res.x * res.y * res.z * 4) as usize;
    let mut image = Image::new(
        size,
        TextureDimension::D3,
        vec![0u8; byte_len],
        TextureFormat::R32Float,
        RenderAssetUsages::RENDER_WORLD,
    );
    image.texture_descriptor.usage = TextureUsages::TEXTURE_BINDING | TextureUsages::COPY_DST;
    image
}

pub fn sync_iso_band_material_bindings(
    enabled: bool,
    volume: &TerrainIsoBandVolume,
    triplanar_handles: Option<&crate::rendering::triplanar_material::TriplanarMaterialHandle>,
    debug_handles: Option<&TerrainDebugMaterialHandles>,
    materials: &mut Assets<TriplanarMaterial>,
) {
    let Some(triplanar_handles) = triplanar_handles else {
        return;
    };

    let uniforms = if enabled {
        volume.uniforms
    } else {
        TerrainIsoBandUniforms::default()
    };
    let texture = volume.texture.clone();

    let mut patch = |handle: &Handle<TriplanarMaterial>| {
        if let Some(material) = materials.get_mut(handle) {
            material.iso_band_volume = Some(texture.clone());
            material.iso_band_params = uniforms;
        }
    };

    patch(&triplanar_handles.handle);
    patch(&triplanar_handles.cheap_handle);
    patch(&triplanar_handles.single_projection_far_handle);
    patch(&triplanar_handles.atlas_only_debug_handle);
    patch(&triplanar_handles.wireframe_debug_handle);
    patch(&triplanar_handles.normals_debug_handle);
    patch(&triplanar_handles.wireframe_normals_debug_handle);
    patch(&triplanar_handles.flat_unlit_debug_handle);
    patch(&triplanar_handles.wireframe_flat_unlit_debug_handle);

    if let Some(debug_handles) = debug_handles {
        for handle in debug_handles.all_handles() {
            patch(handle);
        }
    }
}

pub fn update_terrain_iso_band_volume(
    time: Res<Time>,
    terrain_debug: Res<crate::voxel::terrain_debug::TerrainDebugView>,
    world: Res<VoxelWorld>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    triplanar_handles: Option<Res<crate::rendering::triplanar_material::TriplanarMaterialHandle>>,
    debug_handles: Option<Res<TerrainDebugMaterialHandles>>,
    mut volume: ResMut<TerrainIsoBandVolume>,
    mut images: ResMut<Assets<Image>>,
    mut materials: ResMut<Assets<TriplanarMaterial>>,
    mut bindings_dirty: Local<bool>,
) {
    if terrain_debug.is_changed() {
        *bindings_dirty = true;
    }

    if !terrain_debug.iso_band {
        if volume.active() {
            volume.uniforms = TerrainIsoBandUniforms::default();
            *bindings_dirty = true;
        }
        if *bindings_dirty {
            sync_iso_band_material_bindings(
                false,
                &volume,
                triplanar_handles.as_deref(),
                debug_handles.as_deref(),
                &mut materials,
            );
            *bindings_dirty = false;
        }
        return;
    }

    let Ok(camera_transform) = camera_query.single() else {
        return;
    };
    let camera_pos = camera_transform.translation;
    let now = time.elapsed_secs();
    let needs_rebuild = volume.last_center.is_none_or(|center| {
        now - volume.last_update_secs >= ISO_BAND_UPDATE_INTERVAL_SECS
            || center.distance(camera_pos) >= ISO_BAND_CAMERA_REBUILD_DISTANCE
    });

    if needs_rebuild {
        let world_min = camera_pos - ISO_BAND_WORLD_EXTENT * 0.5;
        fill_iso_band_volume(&world, &mut images, &volume.texture, world_min);
        volume.uniforms = TerrainIsoBandUniforms {
            world_min,
            inv_extent: Vec3::new(
                1.0 / ISO_BAND_WORLD_EXTENT.x,
                1.0 / ISO_BAND_WORLD_EXTENT.y,
                1.0 / ISO_BAND_WORLD_EXTENT.z,
            ),
            epsilon: ISO_BAND_EPSILON,
            mismatch_threshold: ISO_BAND_MISMATCH_THRESHOLD,
            ..Default::default()
        };
        volume.last_center = Some(camera_pos);
        volume.last_update_secs = now;
        *bindings_dirty = true;
    }

    if volume.uniforms.epsilon <= 0.0 {
        volume.uniforms.epsilon = ISO_BAND_EPSILON;
        *bindings_dirty = true;
    }

    if *bindings_dirty {
        sync_iso_band_material_bindings(
            true,
            &volume,
            triplanar_handles.as_deref(),
            debug_handles.as_deref(),
            &mut materials,
        );
        *bindings_dirty = false;
    }
}

fn fill_iso_band_volume(
    world: &VoxelWorld,
    images: &mut Assets<Image>,
    texture: &Handle<Image>,
    world_min: Vec3,
) {
    let Some(image) = images.get_mut(texture) else {
        return;
    };
    let res = ISO_BAND_VOLUME_RESOLUTION;
    let Some(data) = image.data.as_mut() else {
        return;
    };
    data.fill(0);

    for z in 0..res.z {
        for y in 0..res.y {
            for x in 0..res.x {
                let world_pos =
                    world_min + Vec3::new(x as f32 + 0.5, y as f32 + 0.5, z as f32 + 0.5);
                let sdf = mesher_smoothed_sdf_at_world_pos(world, world_pos);
                let index = ((x + y * res.x + z * res.x * res.y) * 4) as usize;
                data[index..index + 4].copy_from_slice(&sdf.to_le_bytes());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_band_uniforms_default_is_inactive() {
        let uniforms = TerrainIsoBandUniforms::default();
        assert_eq!(uniforms.epsilon, 0.0);
    }
}
