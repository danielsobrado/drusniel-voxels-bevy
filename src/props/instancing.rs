//! Prop instancing for performance optimization.
//!
//! This module caches extracted meshes from GLTF props and spawns them
//! using Mesh3d instead of SceneRoot, allowing Bevy's automatic instancing
//! to batch identical meshes together.

use bevy::prelude::*;
use bevy::gltf::{GltfMesh, GltfNode};
use std::collections::HashMap;

use super::{PropAssets, PropType};

/// Cached mesh data extracted from a GLTF prop.
#[derive(Clone)]
pub struct CachedPropMesh {
    /// The mesh handle (shared across all instances)
    pub mesh: Handle<Mesh>,
    /// The material handle (shared across all instances)
    pub material: Handle<StandardMaterial>,
    /// Local transform offset from the GLTF node
    pub local_transform: Transform,
}

/// Resource storing cached meshes for each prop type.
#[derive(Resource)]
pub struct PropMeshCache {
    /// Cached meshes keyed by prop ID
    pub meshes: HashMap<String, Vec<CachedPropMesh>>,
    /// GLTF handles we're waiting to load
    pub pending_gltfs: HashMap<String, Handle<Gltf>>,
    /// Whether extraction is complete for all props
    pub extraction_complete: bool,
    /// Whether instancing is enabled
    pub enabled: bool,
    /// Default material for props without materials
    pub default_material: Option<Handle<StandardMaterial>>,
}

impl Default for PropMeshCache {
    fn default() -> Self {
        Self {
            meshes: HashMap::new(),
            pending_gltfs: HashMap::new(),
            extraction_complete: false,
            // Instancing enabled - spawner waits for extraction to complete
            enabled: true,
            default_material: None,
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

    /// Check if cache is ready (all props extracted)
    pub fn is_ready(&self) -> bool {
        self.extraction_complete && !self.meshes.is_empty()
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
    meshes: Res<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    asset_server: Res<AssetServer>,
) {
    if !cache.enabled || cache.extraction_complete || !prop_assets.loaded {
        return;
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
        if cache.has_cached(prop_id) || cache.pending_gltfs.contains_key(prop_id) {
            continue;
        }

        // Get the GLTF asset path from the scene handle
        let Some(gltf_path) = asset_server.get_path(scene_handle.id()) else {
            continue;
        };

        // Extract base path (remove #Scene0 suffix)
        let gltf_path_str = gltf_path.path().to_string_lossy().to_string();
        let base_path: String = gltf_path_str.split('#').next().unwrap_or(&gltf_path_str).to_string();

        // Load the GLTF asset
        let gltf_handle: Handle<Gltf> = asset_server.load(&base_path);
        cache.pending_gltfs.insert(prop_id.clone(), gltf_handle);
    }

    // Second pass: extract meshes from loaded GLTFs
    let pending: Vec<(String, Handle<Gltf>)> = cache.pending_gltfs.drain().collect();
    let mut still_pending = Vec::new();

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
                    &meshes,
                    &default_mat,
                    Transform::IDENTITY,
                    &mut cached_meshes,
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

                        let material = primitive.material.clone().unwrap_or_else(|| default_mat.clone());

                        cached_meshes.push(CachedPropMesh {
                            mesh: primitive.mesh.clone(),
                            material,
                            local_transform: Transform::IDENTITY,
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
            warn!("No meshes extracted for prop '{}', will use SceneRoot fallback", prop_id);
        }
    }

    // Re-insert pending GLTFs
    for (prop_id, handle) in still_pending {
        cache.pending_gltfs.insert(prop_id, handle);
    }

    // Check if extraction is complete
    if cache.pending_gltfs.is_empty() && !cache.meshes.is_empty() {
        cache.extraction_complete = true;
        info!(
            "Prop mesh extraction complete: {} prop types cached for GPU instancing",
            cache.meshes.len()
        );
    }
}

/// Recursively extract meshes from a GLTF node and its children.
fn extract_meshes_from_node(
    node: &GltfNode,
    gltf_nodes: &Assets<GltfNode>,
    gltf_meshes: &Assets<GltfMesh>,
    meshes: &Assets<Mesh>,
    default_material: &Handle<StandardMaterial>,
    parent_transform: Transform,
    results: &mut Vec<CachedPropMesh>,
) {
    let node_transform = parent_transform * node.transform;

    // Extract mesh from this node
    if let Some(gltf_mesh_handle) = &node.mesh {
        if let Some(gltf_mesh) = gltf_meshes.get(gltf_mesh_handle) {
            for primitive in &gltf_mesh.primitives {
                if meshes.get(&primitive.mesh).is_none() {
                    continue;
                }

                let material = primitive.material.clone().unwrap_or_else(|| default_material.clone());

                results.push(CachedPropMesh {
                    mesh: primitive.mesh.clone(),
                    material,
                    local_transform: node_transform,
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
                default_material,
                node_transform,
                results,
            );
        }
    }
}

/// Spawn a prop using cached meshes instead of SceneRoot.
/// Returns the spawned root entity, or None if caching isn't ready for this prop.
///
/// The root entity will have the Prop component and contain child entities for each mesh.
/// This enables Bevy's automatic GPU instancing since all instances of the same prop
/// share the same mesh and material handles.
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
pub fn log_instancing_stats(
    cache: Res<PropMeshCache>,
    stats: Res<InstancingStats>,
) {
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
