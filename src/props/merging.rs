//! Prop mesh merging for performance optimization.
//!
//! This module combines multiple static prop meshes (rocks, tree trunks) into
//! single meshes per chunk to reduce draw calls.

use bevy::asset::RenderAssetUsages;
use bevy::prelude::*;
use bevy_mesh::{Indices, PrimitiveTopology, VertexAttributeValues};
use std::collections::{HashMap, HashSet};

use super::instancing::InstancedProp;
use super::persistence::PersistedProp;
use super::{Prop, PropType};

/// Marker component for props that should be merged into chunk meshes.
/// Only applied to static props (rocks, tree trunks) - not animated foliage.
#[derive(Component)]
pub struct MergeCandidate {
    /// Whether this prop's scene has been fully loaded
    pub scene_ready: bool,
}

impl Default for MergeCandidate {
    fn default() -> Self {
        Self { scene_ready: false }
    }
}

/// Component for merged prop meshes.
#[derive(Component)]
pub struct MergedPropMesh {
    /// The chunk position this merged mesh belongs to
    pub chunk_pos: IVec2,
    /// Number of original props merged into this mesh
    pub prop_count: usize,
    /// The prop type (for material selection)
    pub prop_type: PropType,
}

/// Resource tracking prop merge state.
#[derive(Resource)]
pub struct PropMergeState {
    /// Chunks with pending merge candidates
    pub pending_chunks: HashSet<IVec2>,
    /// Chunks that have been merged (chunk_pos -> merged mesh entities)
    pub merged_chunks: HashMap<IVec2, Vec<Entity>>,
    /// Props waiting for their scenes to load
    pub pending_props: HashSet<Entity>,
    /// Timer for batch processing
    pub merge_timer: f32,
    /// Whether merging is enabled
    pub enabled: bool,
}

impl Default for PropMergeState {
    fn default() -> Self {
        Self {
            pending_chunks: HashSet::new(),
            merged_chunks: HashMap::new(),
            pending_props: HashSet::new(),
            merge_timer: 0.0,
            enabled: true, // Enable merging by default
        }
    }
}

/// Interval between merge processing attempts (seconds)
const MERGE_PROCESS_INTERVAL: f32 = 0.5;

/// Minimum props in a chunk before merging is worthwhile
const MIN_PROPS_FOR_MERGE: usize = 3;

/// Combined mesh data for merging
struct CombinedMeshData {
    positions: Vec<[f32; 3]>,
    normals: Vec<[f32; 3]>,
    uvs: Vec<[f32; 2]>,
    colors: Vec<[f32; 4]>,
    indices: Vec<u32>,
}

impl CombinedMeshData {
    fn new() -> Self {
        Self {
            positions: Vec::new(),
            normals: Vec::new(),
            uvs: Vec::new(),
            colors: Vec::new(),
            indices: Vec::new(),
        }
    }

    fn is_empty(&self) -> bool {
        self.positions.is_empty()
    }

    /// Append mesh data transformed to world space
    fn append_transformed(
        &mut self,
        mesh: &Mesh,
        transform: &GlobalTransform,
    ) {
        let Some(VertexAttributeValues::Float32x3(positions)) =
            mesh.attribute(Mesh::ATTRIBUTE_POSITION)
        else {
            return;
        };

        let normals = match mesh.attribute(Mesh::ATTRIBUTE_NORMAL) {
            Some(VertexAttributeValues::Float32x3(n)) => n.clone(),
            _ => vec![[0.0, 1.0, 0.0]; positions.len()],
        };

        let uvs = match mesh.attribute(Mesh::ATTRIBUTE_UV_0) {
            Some(VertexAttributeValues::Float32x2(u)) => u.clone(),
            _ => vec![[0.0, 0.0]; positions.len()],
        };

        let colors = match mesh.attribute(Mesh::ATTRIBUTE_COLOR) {
            Some(VertexAttributeValues::Float32x4(c)) => c.clone(),
            _ => vec![[1.0, 1.0, 1.0, 1.0]; positions.len()],
        };

        let indices: Vec<u32> = match mesh.indices() {
            Some(Indices::U32(idx)) => idx.clone(),
            Some(Indices::U16(idx)) => idx.iter().map(|&i| i as u32).collect(),
            None => (0..positions.len() as u32).collect(),
        };

        let base_index = self.positions.len() as u32;
        let matrix = transform.to_matrix();
        let normal_matrix = transform.to_matrix().inverse().transpose();

        // Transform positions and normals to world space
        for pos in positions {
            let world_pos = matrix.transform_point3(Vec3::from_array(*pos));
            self.positions.push(world_pos.to_array());
        }

        for normal in &normals {
            let world_normal = normal_matrix
                .transform_vector3(Vec3::from_array(*normal))
                .normalize_or_zero();
            self.normals.push(world_normal.to_array());
        }

        self.uvs.extend(uvs);
        self.colors.extend(colors);

        // Offset indices
        for idx in indices {
            self.indices.push(base_index + idx);
        }
    }

    fn into_mesh(self) -> Mesh {
        let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default());
        mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, self.positions);
        mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, self.normals);
        mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, self.uvs);
        mesh.insert_attribute(Mesh::ATTRIBUTE_COLOR, self.colors);
        mesh.insert_indices(Indices::U32(self.indices));
        mesh
    }
}

/// Check if a prop type should be merged (static props only).
pub fn should_merge_prop_type(prop_type: PropType) -> bool {
    matches!(prop_type, PropType::Rock)
    // Trees have animated leaves, bushes have wind animation
    // Could add PropType::Tree for trunk-only merging in future
}

/// System to mark newly spawned static props as merge candidates.
/// Skips instanced props since they already benefit from GPU batching.
pub fn mark_merge_candidates(
    mut commands: Commands,
    mut merge_state: ResMut<PropMergeState>,
    new_props: Query<(Entity, &Prop, &PersistedProp), (Without<MergeCandidate>, Without<InstancedProp>)>,
) {
    if !merge_state.enabled {
        return;
    }

    let mut marked_count = 0;
    for (entity, prop, persisted) in new_props.iter() {
        if should_merge_prop_type(prop.prop_type) {
            commands.entity(entity).insert(MergeCandidate::default());
            merge_state.pending_props.insert(entity);
            merge_state.pending_chunks.insert(persisted.chunk_pos);
            marked_count += 1;
        }
    }

    if marked_count > 0 {
        info!(
            "Marked {} props for merging. Total pending: {} props, {} chunks",
            marked_count,
            merge_state.pending_props.len(),
            merge_state.pending_chunks.len()
        );
    }
}

/// System to check if merge candidate scenes are ready.
pub fn check_scene_ready(
    mut merge_state: ResMut<PropMergeState>,
    mut candidates: Query<(Entity, &mut MergeCandidate)>,
    children_query: Query<&Children>,
    mesh_query: Query<&Mesh3d>,
    entities: Query<Entity>,
) {
    let pending: Vec<Entity> = merge_state.pending_props.iter().copied().collect();

    for entity in pending {
        // First check if entity still exists
        if entities.get(entity).is_err() {
            // Entity was despawned
            merge_state.pending_props.remove(&entity);
            continue;
        }

        // Check if entity has MergeCandidate component
        let Ok((_, mut candidate)) = candidates.get_mut(entity) else {
            continue; // Keep waiting - component may not be added yet
        };

        // Check if entity has children yet (GLTF scenes load asynchronously)
        if children_query.get(entity).is_err() {
            continue; // Keep waiting for scene to spawn children
        }

        // Recursively check if any descendants have meshes (scene is loaded)
        let has_mesh = has_mesh_in_descendants(entity, &children_query, &mesh_query);

        if has_mesh {
            candidate.scene_ready = true;
            merge_state.pending_props.remove(&entity);
        }
    }

    // Log progress only at debug level (can be noisy)
    if !merge_state.pending_props.is_empty() {
        debug!(
            "check_scene_ready: {} props still waiting for scenes to load",
            merge_state.pending_props.len()
        );
    }
}

/// Recursively check if an entity or any of its descendants has a Mesh3d.
fn has_mesh_in_descendants(
    entity: Entity,
    children_query: &Query<&Children>,
    mesh_query: &Query<&Mesh3d>,
) -> bool {
    // Check if this entity has a mesh
    if mesh_query.get(entity).is_ok() {
        return true;
    }

    // Check children recursively
    if let Ok(children) = children_query.get(entity) {
        for child in children.iter() {
            if has_mesh_in_descendants(child, children_query, mesh_query) {
                return true;
            }
        }
    }

    false
}

/// Collect all mesh entities from an entity and its descendants.
fn collect_mesh_descendants(
    entity: Entity,
    children_query: &Query<&Children>,
    mesh_query: &Query<(&Mesh3d, &GlobalTransform)>,
    results: &mut Vec<(Handle<Mesh>, GlobalTransform)>,
) {
    // Check if this entity has a mesh
    if let Ok((mesh_handle, transform)) = mesh_query.get(entity) {
        results.push((mesh_handle.0.clone(), *transform));
    }

    // Check children recursively
    if let Ok(children) = children_query.get(entity) {
        for child in children.iter() {
            collect_mesh_descendants(child, children_query, mesh_query, results);
        }
    }
}

/// System to process pending chunk merges.
pub fn process_chunk_merges(
    mut commands: Commands,
    time: Res<Time>,
    mut merge_state: ResMut<PropMergeState>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    candidates: Query<(
        Entity,
        &Prop,
        &MergeCandidate,
        &PersistedProp,
        &GlobalTransform,
    )>,
    children_query: Query<&Children>,
    mesh_query: Query<(&Mesh3d, &GlobalTransform)>,
) {
    if !merge_state.enabled {
        return;
    }

    // Throttle processing
    merge_state.merge_timer += time.delta_secs();
    if merge_state.merge_timer < MERGE_PROCESS_INTERVAL {
        return;
    }
    merge_state.merge_timer = 0.0;

    // Log merge state only at debug level
    if !merge_state.pending_chunks.is_empty() || !merge_state.pending_props.is_empty() {
        debug!(
            "process_chunk_merges: {} pending chunks, {} pending props",
            merge_state.pending_chunks.len(),
            merge_state.pending_props.len()
        );
    }

    // Find a chunk that has no pending props (all scenes loaded)
    let chunk_to_process = merge_state.pending_chunks.iter().find(|chunk_pos| {
        // Check if any pending prop belongs to this chunk
        !merge_state.pending_props.iter().any(|&prop_entity| {
            candidates.get(prop_entity)
                .map(|(_, _, _, persisted, _)| persisted.chunk_pos == **chunk_pos)
                .unwrap_or(false)
        })
    }).copied();

    let Some(chunk_pos) = chunk_to_process else {
        return;
    };

    // Gather all ready candidates for this chunk
    let mut chunk_candidates: Vec<(Entity, PropType)> = Vec::new();
    let mut combined_data: HashMap<PropType, CombinedMeshData> = HashMap::new();

    for (entity, prop, candidate, persisted, _transform) in candidates.iter() {
        if persisted.chunk_pos != chunk_pos || !candidate.scene_ready {
            continue;
        }

        chunk_candidates.push((entity, prop.prop_type));

        // Recursively collect all meshes from the entity hierarchy (GLTF scenes are nested)
        let mut mesh_results: Vec<(Handle<Mesh>, GlobalTransform)> = Vec::new();
        collect_mesh_descendants(entity, &children_query, &mesh_query, &mut mesh_results);

        if mesh_results.is_empty() {
            warn!(
                "No meshes found in descendants for {:?} prop entity {:?}",
                prop.prop_type, entity
            );
        }

        for (mesh_handle, mesh_transform) in mesh_results {
            if let Some(mesh) = meshes.get(&mesh_handle) {
                let data = combined_data
                    .entry(prop.prop_type)
                    .or_insert_with(CombinedMeshData::new);
                data.append_transformed(mesh, &mesh_transform);
            }
        }
    }

    warn!(
        "Processing chunk {:?}: {} candidates, {} prop types with mesh data",
        chunk_pos,
        chunk_candidates.len(),
        combined_data.len()
    );

    // Check if we have enough props to make merging worthwhile
    if chunk_candidates.len() < MIN_PROPS_FOR_MERGE {
        merge_state.pending_chunks.remove(&chunk_pos);
        return;
    }

    // Create merged meshes for each prop type
    let mut merged_entities = Vec::new();

    for (prop_type, combined) in combined_data {
        if combined.is_empty() {
            continue;
        }

        let prop_count = chunk_candidates
            .iter()
            .filter(|(_, t)| *t == prop_type)
            .count();

        let mesh = combined.into_mesh();
        let mesh_handle = meshes.add(mesh);

        // Create a simple material for merged rocks
        let material = materials.add(StandardMaterial {
            base_color: Color::srgb(0.5, 0.5, 0.5),
            perceptual_roughness: 0.9,
            metallic: 0.0,
            ..default()
        });

        let merged_entity = commands
            .spawn((
                Mesh3d(mesh_handle),
                MeshMaterial3d(material),
                Transform::IDENTITY,
                GlobalTransform::IDENTITY,
                Visibility::Inherited,
                InheritedVisibility::default(),
                ViewVisibility::default(),
                MergedPropMesh {
                    chunk_pos,
                    prop_count,
                    prop_type,
                },
            ))
            .id();

        merged_entities.push(merged_entity);
        warn!(
            "Merged {} {:?} props in chunk {:?} into single mesh",
            prop_count, prop_type, chunk_pos
        );
    }

    // Despawn original entities
    for (entity, _) in chunk_candidates {
        commands.entity(entity).despawn();
    }

    // Update state
    merge_state.pending_chunks.remove(&chunk_pos);
    merge_state.merged_chunks.insert(chunk_pos, merged_entities);
}

/// System to handle chunk unloading - despawn merged meshes.
pub fn cleanup_merged_meshes(
    mut commands: Commands,
    mut merge_state: ResMut<PropMergeState>,
    merged_meshes: Query<(Entity, &MergedPropMesh)>,
) {
    // Remove entries for chunks whose merged meshes no longer exist
    let existing_chunks: HashSet<IVec2> = merged_meshes
        .iter()
        .map(|(_, m)| m.chunk_pos)
        .collect();

    merge_state.merged_chunks.retain(|chunk_pos, entities| {
        if existing_chunks.contains(chunk_pos) {
            true
        } else {
            // Despawn any remaining entities
            for entity in entities {
                if let Ok(mut entity_commands) = commands.get_entity(*entity) {
                    entity_commands.despawn();
                }
            }
            false
        }
    });
}
