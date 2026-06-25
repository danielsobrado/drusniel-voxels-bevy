//! Prop instancing for performance optimization.
//!
//! This module caches extracted meshes from GLTF props and spawns them
//! using Mesh3d instead of SceneRoot, allowing Bevy's automatic instancing
//! to batch identical meshes together.

use bevy::gltf::{GltfMesh, GltfNode};
use bevy::mesh::VertexAttributeValues;
use bevy::prelude::*;
use std::collections::{HashMap, HashSet};

use super::PropAssets;
#[cfg(feature = "legacy_prop_spawn")]
use super::PropType;
use crate::rendering::props_material::{PropsMaterial, PropsUniforms};

/// Cached mesh data extracted from a GLTF prop.
#[derive(Clone)]
pub struct CachedPropMesh {
    /// The mesh handle (shared across all instances)
    pub mesh: Handle<Mesh>,
    /// The material handle (shared across all instances)
    pub material: Handle<StandardMaterial>,
    /// Converted material used by the custom instanced props renderer.
    pub instanced_material: Handle<PropsMaterial>,
    /// Local transform offset from the GLTF node
    pub local_transform: Transform,
    /// Mesh-space AABB minimum, computed from vertex positions.
    pub local_aabb_min: Vec3,
    /// Mesh-space AABB maximum, computed from vertex positions.
    pub local_aabb_max: Vec3,
    /// Mesh-space bounding sphere center.
    pub local_bounding_sphere_center: Vec3,
    /// Mesh-space bounding sphere radius.
    pub local_bounding_sphere_radius: f32,
    /// True when bounds came from mesh vertex positions.
    pub bounds_from_mesh: bool,
}

/// Duration in seconds after which pending GLTF extraction is treated as stuck.
const PROP_EXTRACTION_TIMEOUT_SECONDS: f64 = 60.0;

/// Resource storing cached meshes for each prop type.
#[derive(Resource)]
pub struct PropMeshCache {
    /// Cached meshes keyed by prop ID
    pub meshes: HashMap<String, Vec<CachedPropMesh>>,
    /// GLTF handles we're waiting to load
    pub pending_gltfs: HashMap<String, Handle<Gltf>>,
    /// Prop IDs that failed scene load or mesh extraction
    pub failed_ids: HashSet<String>,
    /// Whether extraction is complete for all props
    pub extraction_complete: bool,
    /// Whether instancing is enabled
    pub enabled: bool,
    /// Default material for props without materials
    pub default_material: Option<Handle<StandardMaterial>>,
    /// Real time (seconds) when the first extraction pass started.
    extraction_start_time_seconds: Option<f64>,
}

impl Default for PropMeshCache {
    fn default() -> Self {
        Self {
            meshes: HashMap::new(),
            pending_gltfs: HashMap::new(),
            failed_ids: HashSet::new(),
            extraction_complete: false,
            // Instancing enabled - spawner waits for extraction to complete
            enabled: true,
            default_material: None,
            extraction_start_time_seconds: None,
        }
    }
}

impl PropMeshCache {
    /// Check if we have cached meshes for a prop ID
    pub fn has_cached(&self, prop_id: &str) -> bool {
        self.meshes.contains_key(prop_id)
    }

    /// Get cached meshes for a prop ID
    pub fn get_cached(&self, prop_id: &str) -> Option<&Vec<CachedPropMesh>> {
        self.meshes.get(prop_id)
    }

    /// Check if cache is ready (all props extracted or marked failed)
    pub fn is_ready(&self) -> bool {
        self.extraction_complete
    }

    pub fn is_prop_failed(&self, prop_id: &str) -> bool {
        self.failed_ids.contains(prop_id)
    }
}

/// Marker component for instanced prop entities (spawned from cache).
#[derive(Component)]
pub struct InstancedProp {
    pub prop_id: String,
}

/// System to extract meshes from loaded GLTF scenes and cache them.
/// This runs after prop assets are loaded and extracts mesh/material handles
/// that can be reused across all instances of each prop type.
pub fn extract_prop_meshes(
    mut cache: ResMut<PropMeshCache>,
    prop_assets: Res<PropAssets>,
    gltf_assets: Res<Assets<Gltf>>,
    gltf_meshes: Res<Assets<GltfMesh>>,
    gltf_nodes: Res<Assets<GltfNode>>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut props_materials: ResMut<Assets<PropsMaterial>>,
    asset_server: Res<AssetServer>,
    time: Res<Time>,
) {
    if !cache.enabled || cache.extraction_complete || !prop_assets.loaded {
        return;
    }

    // Start the extraction timer on first pass.
    if cache.extraction_start_time_seconds.is_none() {
        cache.extraction_start_time_seconds = Some(time.elapsed_secs_f64());
    }

    // Timeout: if extraction has been running too long, mark remaining
    // pending GLTFs as failed so the system does not hang forever.
    let elapsed = cache
        .extraction_start_time_seconds
        .map(|start| time.elapsed_secs_f64() - start)
        .unwrap_or(0.0);
    if elapsed > PROP_EXTRACTION_TIMEOUT_SECONDS && !cache.pending_gltfs.is_empty() {
        let stuck: Vec<String> = cache.pending_gltfs.keys().cloned().collect();
        for prop_id in &stuck {
            warn!(
                "Prop extraction timed out for '{}' ({:.0}s); marking as failed",
                prop_id, elapsed,
            );
            cache.failed_ids.insert(prop_id.clone());
        }
        cache.pending_gltfs.clear();
    }

    // Create default material if needed
    if cache.default_material.is_none() {
        cache.default_material = Some(materials.add(StandardMaterial {
            base_color: Color::srgb(0.6, 0.55, 0.5),
            perceptual_roughness: 0.85,
            metallic: 0.0,
            ..default()
        }));
    }
    let default_mat = cache.default_material.clone().unwrap();

    // First pass: queue GLTF loads for props we haven't started loading
    for (prop_id, scene_handle) in prop_assets.scenes.iter() {
        if prop_assets.failed_ids.contains(prop_id) {
            cache.failed_ids.insert(prop_id.clone());
            continue;
        }
        if cache.has_cached(prop_id)
            || cache.failed_ids.contains(prop_id)
            || cache.pending_gltfs.contains_key(prop_id)
        {
            continue;
        }

        // Get the GLTF asset path from the scene handle
        let Some(gltf_path) = asset_server.get_path(scene_handle.id()) else {
            continue;
        };

        // Extract base path (remove #Scene0 suffix)
        let gltf_path_str = gltf_path.path().to_string_lossy().to_string();
        let base_path: String = gltf_path_str
            .split('#')
            .next()
            .unwrap_or(&gltf_path_str)
            .to_string();

        // Load the GLTF asset
        let gltf_handle: Handle<Gltf> = asset_server.load(&base_path);
        cache.pending_gltfs.insert(prop_id.clone(), gltf_handle);
    }

    // Second pass: extract meshes from loaded GLTFs
    let pending: Vec<(String, Handle<Gltf>)> = cache.pending_gltfs.drain().collect();
    let mut still_pending = Vec::new();

    let mut converted_materials = HashMap::new();
    let mut instancing_meshes = HashMap::new();

    for (prop_id, gltf_handle) in pending {
        let Some(gltf) = gltf_assets.get(&gltf_handle) else {
            // Not loaded yet, keep waiting
            still_pending.push((prop_id, gltf_handle));
            continue;
        };

        let mut cached_meshes = Vec::new();

        // Extract meshes from nodes (preserves transforms)
        for node_handle in &gltf.nodes {
            if let Some(gltf_node) = gltf_nodes.get(node_handle) {
                extract_meshes_from_node(
                    gltf_node,
                    &gltf_nodes,
                    &gltf_meshes,
                    &mut meshes,
                    &materials,
                    &mut props_materials,
                    &default_mat,
                    Transform::IDENTITY,
                    &mut cached_meshes,
                    &mut converted_materials,
                    &mut instancing_meshes,
                );
            }
        }

        // Fallback: extract directly from meshes if nodes didn't yield anything
        if cached_meshes.is_empty() {
            for gltf_mesh_handle in &gltf.meshes {
                if let Some(gltf_mesh) = gltf_meshes.get(gltf_mesh_handle) {
                    for primitive in &gltf_mesh.primitives {
                        if meshes.get(&primitive.mesh).is_none() {
                            continue;
                        }

                        let material = primitive
                            .material
                            .clone()
                            .unwrap_or_else(|| default_mat.clone());
                        let instanced_material = converted_props_material(
                            &material,
                            &materials,
                            &mut props_materials,
                            &mut converted_materials,
                        );
                        let bounds = mesh_bounds_from_positions(&meshes, &primitive.mesh);
                        let mesh = ensure_instancing_mesh(
                            &primitive.mesh,
                            &mut meshes,
                            &mut instancing_meshes,
                        );

                        cached_meshes.push(CachedPropMesh {
                            mesh,
                            material,
                            instanced_material,
                            local_transform: Transform::IDENTITY,
                            local_aabb_min: bounds.min,
                            local_aabb_max: bounds.max,
                            local_bounding_sphere_center: bounds.sphere_center,
                            local_bounding_sphere_radius: bounds.sphere_radius,
                            bounds_from_mesh: bounds.from_mesh,
                        });
                    }
                }
            }
        }

        if !cached_meshes.is_empty() {
            info!(
                "Cached {} mesh(es) for prop '{}' (instancing enabled)",
                cached_meshes.len(),
                prop_id
            );
            cache.meshes.insert(prop_id, cached_meshes);
        } else {
            warn!(
                "No meshes extracted for prop '{}'; marking as failed",
                prop_id
            );
            cache.failed_ids.insert(prop_id);
        }
    }

    // Re-insert pending GLTFs, dropping assets whose scene or GLTF load failed.
    for (prop_id, handle) in still_pending {
        if prop_assets.failed_ids.contains(&prop_id) {
            cache.failed_ids.insert(prop_id);
            continue;
        }
        match asset_server.get_load_state(handle.id()) {
            Some(bevy::asset::LoadState::Failed(_)) => {
                warn!("GLTF load failed for prop '{}'", prop_id);
                cache.failed_ids.insert(prop_id);
            }
            _ => {
                cache.pending_gltfs.insert(prop_id, handle);
            }
        }
    }

    if cache.pending_gltfs.is_empty() && all_prop_assets_resolved(&cache, &prop_assets) {
        cache.extraction_complete = true;
        info!(
            "Prop mesh extraction complete: {} cached, {} failed",
            cache.meshes.len(),
            cache.failed_ids.len()
        );
    }
}

fn all_prop_assets_resolved(cache: &PropMeshCache, prop_assets: &PropAssets) -> bool {
    if prop_assets.scenes.is_empty() {
        return true;
    }
    for prop_id in prop_assets.scenes.keys() {
        if prop_assets.failed_ids.contains(prop_id) || cache.failed_ids.contains(prop_id) {
            continue;
        }
        if !cache.meshes.contains_key(prop_id) {
            return false;
        }
    }
    true
}

/// Recursively extract meshes from a GLTF node and its children.
fn extract_meshes_from_node(
    node: &GltfNode,
    gltf_nodes: &Assets<GltfNode>,
    gltf_meshes: &Assets<GltfMesh>,
    meshes: &mut Assets<Mesh>,
    materials: &Assets<StandardMaterial>,
    props_materials: &mut Assets<PropsMaterial>,
    default_material: &Handle<StandardMaterial>,
    parent_transform: Transform,
    results: &mut Vec<CachedPropMesh>,
    converted_materials: &mut HashMap<AssetId<StandardMaterial>, Handle<PropsMaterial>>,
    instancing_meshes: &mut HashMap<AssetId<Mesh>, Handle<Mesh>>,
) {
    let node_transform = parent_transform * node.transform;

    // Extract mesh from this node
    if let Some(gltf_mesh_handle) = &node.mesh {
        if let Some(gltf_mesh) = gltf_meshes.get(gltf_mesh_handle) {
            for primitive in &gltf_mesh.primitives {
                if meshes.get(&primitive.mesh).is_none() {
                    continue;
                }

                let material = primitive
                    .material
                    .clone()
                    .unwrap_or_else(|| default_material.clone());
                let instanced_material = converted_props_material(
                    &material,
                    materials,
                    props_materials,
                    converted_materials,
                );
                let bounds = mesh_bounds_from_positions(meshes, &primitive.mesh);
                let mesh = ensure_instancing_mesh(&primitive.mesh, meshes, instancing_meshes);

                results.push(CachedPropMesh {
                    mesh,
                    material,
                    instanced_material,
                    local_transform: node_transform,
                    local_aabb_min: bounds.min,
                    local_aabb_max: bounds.max,
                    local_bounding_sphere_center: bounds.sphere_center,
                    local_bounding_sphere_radius: bounds.sphere_radius,
                    bounds_from_mesh: bounds.from_mesh,
                });
            }
        }
    }

    // Process children (children are handles that need to be looked up)
    for child_handle in &node.children {
        if let Some(child_node) = gltf_nodes.get(child_handle) {
            extract_meshes_from_node(
                child_node,
                gltf_nodes,
                gltf_meshes,
                meshes,
                materials,
                props_materials,
                default_material,
                node_transform,
                results,
                converted_materials,
                instancing_meshes,
            );
        }
    }
}

#[derive(Clone, Copy)]
struct MeshBounds {
    min: Vec3,
    max: Vec3,
    sphere_center: Vec3,
    sphere_radius: f32,
    from_mesh: bool,
}

fn mesh_bounds_from_positions(meshes: &Assets<Mesh>, mesh_handle: &Handle<Mesh>) -> MeshBounds {
    let Some(mesh) = meshes.get(mesh_handle) else {
        return fallback_mesh_bounds();
    };
    let Some(VertexAttributeValues::Float32x3(positions)) =
        mesh.attribute(Mesh::ATTRIBUTE_POSITION)
    else {
        return fallback_mesh_bounds();
    };
    if positions.is_empty() {
        return fallback_mesh_bounds();
    }

    let mut min = Vec3::splat(f32::INFINITY);
    let mut max = Vec3::splat(f32::NEG_INFINITY);
    for position in positions {
        let position = Vec3::from_array(*position);
        min = min.min(position);
        max = max.max(position);
    }

    let sphere_center = (min + max) * 0.5;
    let mut sphere_radius: f32 = 0.0;
    for position in positions {
        sphere_radius = sphere_radius.max(Vec3::from_array(*position).distance(sphere_center));
    }

    MeshBounds {
        min,
        max,
        sphere_center,
        sphere_radius,
        from_mesh: true,
    }
}

fn fallback_mesh_bounds() -> MeshBounds {
    let min = Vec3::splat(-1.0);
    let max = Vec3::splat(1.0);
    MeshBounds {
        min,
        max,
        sphere_center: Vec3::ZERO,
        sphere_radius: Vec3::ONE.length(),
        from_mesh: false,
    }
}

fn converted_props_material(
    material_handle: &Handle<StandardMaterial>,
    materials: &Assets<StandardMaterial>,
    props_materials: &mut Assets<PropsMaterial>,
    converted_materials: &mut HashMap<AssetId<StandardMaterial>, Handle<PropsMaterial>>,
) -> Handle<PropsMaterial> {
    let material_id = material_handle.id();
    if let Some(existing) = converted_materials.get(&material_id) {
        return existing.clone();
    }

    let source = materials.get(material_handle);
    let alpha_mode = source
        .map(|material| material.alpha_mode.clone())
        .unwrap_or(AlphaMode::Opaque);
    let alpha_cutoff = match alpha_mode {
        AlphaMode::Mask(cutoff) => cutoff,
        _ => 0.0,
    };
    let handle = props_materials.add(PropsMaterial {
        uniforms: PropsUniforms {
            base_color: source
                .map(|material| material.base_color.to_linear())
                .unwrap_or(LinearRgba::WHITE),
            default_roughness: source
                .map(|material| material.perceptual_roughness)
                .unwrap_or(0.8),
            normal_intensity: if source
                .is_some_and(|material| material.normal_map_texture.is_some())
            {
                1.0
            } else {
                0.0
            },
            alpha_cutoff,
            ..default()
        },
        rock_albedo: source.and_then(|material| material.base_color_texture.clone()),
        rock_normal: source.and_then(|material| material.normal_map_texture.clone()),
        rock_roughness: None,
        rock_ao: None,
        alpha_mode,
    });
    converted_materials.insert(material_id, handle.clone());
    handle
}

fn ensure_instancing_mesh(
    mesh_handle: &Handle<Mesh>,
    meshes: &mut Assets<Mesh>,
    instancing_meshes: &mut HashMap<AssetId<Mesh>, Handle<Mesh>>,
) -> Handle<Mesh> {
    let mesh_id = mesh_handle.id();
    if let Some(existing) = instancing_meshes.get(&mesh_id) {
        return existing.clone();
    }

    let Some(mesh) = meshes.get(mesh_handle) else {
        return mesh_handle.clone();
    };

    let missing_color = mesh.attribute(Mesh::ATTRIBUTE_COLOR).is_none();
    let missing_uv = mesh.attribute(Mesh::ATTRIBUTE_UV_0).is_none();
    if !missing_color && !missing_uv {
        instancing_meshes.insert(mesh_id, mesh_handle.clone());
        return mesh_handle.clone();
    }

    let vertex_count = match mesh.attribute(Mesh::ATTRIBUTE_POSITION) {
        Some(VertexAttributeValues::Float32x3(values)) => values.len(),
        _ => {
            instancing_meshes.insert(mesh_id, mesh_handle.clone());
            return mesh_handle.clone();
        }
    };

    let mut patched_mesh = mesh.clone();
    if missing_uv {
        patched_mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, vec![[0.0_f32, 0.0_f32]; vertex_count]);
    }
    if missing_color {
        patched_mesh.insert_attribute(
            Mesh::ATTRIBUTE_COLOR,
            vec![[1.0_f32, 1.0_f32, 1.0_f32, 1.0_f32]; vertex_count],
        );
    }

    let patched_handle = meshes.add(patched_mesh);
    instancing_meshes.insert(mesh_id, patched_handle.clone());
    patched_handle
}

/// Spawn a prop using cached meshes instead of SceneRoot.
/// Returns the spawned root entity, or None if caching isn't ready for this prop.
///
/// The root entity will have the Prop component and contain child entities for each mesh.
/// This enables Bevy's automatic GPU instancing since all instances of the same prop
/// share the same mesh and material handles.
#[cfg(feature = "legacy_prop_spawn")]
pub fn spawn_instanced_prop(
    commands: &mut Commands,
    cache: &PropMeshCache,
    prop_id: &str,
    transform: Transform,
    _prop_type: PropType,
) -> Option<Entity> {
    if !cache.enabled {
        return None;
    }

    let cached = cache.get_cached(prop_id)?;

    if cached.is_empty() {
        return None;
    }

    // For single-mesh props, spawn directly without a parent
    // Only apply rotation and scale from local transform, not translation
    // (translation offsets from GLTF authoring cause floating props)
    if cached.len() == 1 {
        let cached_mesh = &cached[0];
        let local_rotation_scale = Transform {
            translation: Vec3::ZERO, // Ignore GLTF translation offset
            rotation: cached_mesh.local_transform.rotation,
            scale: cached_mesh.local_transform.scale,
        };
        let final_transform = transform * local_rotation_scale;

        let entity = commands
            .spawn((
                Mesh3d(cached_mesh.mesh.clone()),
                MeshMaterial3d(cached_mesh.material.clone()),
                final_transform,
                Visibility::Inherited,
                InstancedProp {
                    prop_id: prop_id.to_string(),
                },
            ))
            .id();

        return Some(entity);
    }

    // For multi-mesh props, spawn a parent with mesh children
    let root = commands
        .spawn((
            transform,
            Visibility::Inherited,
            InstancedProp {
                prop_id: prop_id.to_string(),
            },
        ))
        .id();

    for cached_mesh in cached {
        let child = commands
            .spawn((
                Mesh3d(cached_mesh.mesh.clone()),
                MeshMaterial3d(cached_mesh.material.clone()),
                cached_mesh.local_transform,
                Visibility::Inherited,
            ))
            .id();

        commands.entity(root).add_child(child);
    }

    Some(root)
}

/// Statistics for instanced props (for debug UI).
#[derive(Resource, Default)]
pub struct InstancingStats {
    pub cached_prop_types: usize,
    pub instanced_spawns: usize,
    pub scene_spawns: usize,
}

impl InstancingStats {
    pub fn instancing_ratio(&self) -> f32 {
        let total = self.instanced_spawns + self.scene_spawns;
        if total == 0 {
            return 0.0;
        }
        self.instanced_spawns as f32 / total as f32
    }
}

/// System to log instancing statistics periodically.
pub fn log_instancing_stats(cache: Res<PropMeshCache>, stats: Res<InstancingStats>) {
    if cache.is_changed() && cache.extraction_complete {
        info!(
            "Instancing stats: {} cached types, {} instanced / {} scene spawns ({:.1}% instanced)",
            cache.meshes.len(),
            stats.instanced_spawns,
            stats.scene_spawns,
            stats.instancing_ratio() * 100.0
        );
    }
}
