//! Mesh decimation for prop LOD.
//!
//! Provides runtime mesh simplification to create lower-poly versions
//! of prop meshes. Uses vertex clustering algorithm for fast decimation
//! that preserves overall shape and silhouette.

use bevy::prelude::*;
use bevy::asset::RenderAssetUsages;
use bevy_mesh::{Indices, PrimitiveTopology, VertexAttributeValues};
use std::collections::HashMap;

/// Configuration for mesh decimation settings.
#[derive(Resource, Clone)]
pub struct PropDecimationConfig {
    /// Enable/disable mesh decimation globally.
    pub enabled: bool,

    /// Target vertex ratio for LOD1 (0.5 = keep 50% of vertices).
    pub target_ratio_lod1: f32,

    /// Target vertex ratio for LOD2 (0.25 = keep 25% of vertices).
    pub target_ratio_lod2: f32,

    /// Minimum vertices to bother decimating (skip tiny meshes).
    pub min_vertices: usize,

    /// Grid cell size for vertex clustering (smaller = higher quality).
    pub cluster_cell_size: f32,
}

impl Default for PropDecimationConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            target_ratio_lod1: 0.5,
            target_ratio_lod2: 0.25,
            min_vertices: 100,
            cluster_cell_size: 0.1,
        }
    }
}

/// Statistics for mesh decimation (debug UI).
#[derive(Resource, Default)]
pub struct DecimationStats {
    pub meshes_decimated: usize,
    pub total_original_vertices: usize,
    pub total_lod1_vertices: usize,
    pub total_lod2_vertices: usize,
}

/// Intermediate mesh data for decimation processing.
#[derive(Clone, Default)]
pub struct MeshData {
    pub positions: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    pub uvs: Vec<[f32; 2]>,
    pub colors: Vec<[f32; 4]>,
    pub indices: Vec<u32>,
}

impl MeshData {
    /// Extract mesh data from a Bevy Mesh asset.
    pub fn from_mesh(mesh: &Mesh) -> Option<Self> {
        let positions = match mesh.attribute(Mesh::ATTRIBUTE_POSITION)? {
            VertexAttributeValues::Float32x3(v) => v.clone(),
            _ => return None,
        };

        let normals = match mesh.attribute(Mesh::ATTRIBUTE_NORMAL) {
            Some(VertexAttributeValues::Float32x3(v)) => v.clone(),
            _ => vec![[0.0, 1.0, 0.0]; positions.len()],
        };

        let uvs = match mesh.attribute(Mesh::ATTRIBUTE_UV_0) {
            Some(VertexAttributeValues::Float32x2(v)) => v.clone(),
            _ => vec![[0.0, 0.0]; positions.len()],
        };

        let colors = match mesh.attribute(Mesh::ATTRIBUTE_COLOR) {
            Some(VertexAttributeValues::Float32x4(v)) => v.clone(),
            _ => vec![[1.0, 1.0, 1.0, 1.0]; positions.len()],
        };

        let indices = match mesh.indices() {
            Some(Indices::U32(idx)) => idx.clone(),
            Some(Indices::U16(idx)) => idx.iter().map(|&i| i as u32).collect(),
            None => (0..positions.len() as u32).collect(),
        };

        Some(Self {
            positions,
            normals,
            uvs,
            colors,
            indices,
        })
    }

    /// Convert back to a Bevy Mesh.
    pub fn into_mesh(self) -> Mesh {
        let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default());
        mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, self.positions);
        mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, self.normals);
        mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, self.uvs);
        mesh.insert_attribute(Mesh::ATTRIBUTE_COLOR, self.colors);
        mesh.insert_indices(Indices::U32(self.indices));
        mesh
    }

    /// Get vertex count.
    pub fn vertex_count(&self) -> usize {
        self.positions.len()
    }

    /// Get triangle count.
    pub fn triangle_count(&self) -> usize {
        self.indices.len() / 3
    }
}

/// Vertex cluster for decimation.
#[derive(Default)]
struct VertexCluster {
    /// Accumulated position (will be averaged).
    position_sum: [f32; 3],
    /// Accumulated normal (will be normalized).
    normal_sum: [f32; 3],
    /// Accumulated UV (will be averaged).
    uv_sum: [f32; 2],
    /// Accumulated color (will be averaged).
    color_sum: [f32; 4],
    /// Number of vertices in this cluster.
    count: u32,
}

impl VertexCluster {
    fn add_vertex(&mut self, pos: [f32; 3], normal: [f32; 3], uv: [f32; 2], color: [f32; 4]) {
        self.position_sum[0] += pos[0];
        self.position_sum[1] += pos[1];
        self.position_sum[2] += pos[2];
        self.normal_sum[0] += normal[0];
        self.normal_sum[1] += normal[1];
        self.normal_sum[2] += normal[2];
        self.uv_sum[0] += uv[0];
        self.uv_sum[1] += uv[1];
        self.color_sum[0] += color[0];
        self.color_sum[1] += color[1];
        self.color_sum[2] += color[2];
        self.color_sum[3] += color[3];
        self.count += 1;
    }

    fn finalize(&self) -> ([f32; 3], [f32; 3], [f32; 2], [f32; 4]) {
        let c = self.count as f32;
        let pos = [
            self.position_sum[0] / c,
            self.position_sum[1] / c,
            self.position_sum[2] / c,
        ];

        // Normalize the accumulated normal
        let nx = self.normal_sum[0];
        let ny = self.normal_sum[1];
        let nz = self.normal_sum[2];
        let len = (nx * nx + ny * ny + nz * nz).sqrt();
        let normal = if len > 0.0001 {
            [nx / len, ny / len, nz / len]
        } else {
            [0.0, 1.0, 0.0]
        };

        let uv = [self.uv_sum[0] / c, self.uv_sum[1] / c];

        let color = [
            self.color_sum[0] / c,
            self.color_sum[1] / c,
            self.color_sum[2] / c,
            self.color_sum[3] / c,
        ];

        (pos, normal, uv, color)
    }
}

/// Hash a 3D position to a grid cell key.
fn position_to_cell(pos: [f32; 3], cell_size: f32) -> (i32, i32, i32) {
    (
        (pos[0] / cell_size).floor() as i32,
        (pos[1] / cell_size).floor() as i32,
        (pos[2] / cell_size).floor() as i32,
    )
}

/// Decimate a mesh using vertex clustering.
///
/// This algorithm groups vertices into spatial cells and merges them,
/// preserving the overall shape while reducing vertex count.
///
/// # Arguments
/// * `mesh_data` - The input mesh data
/// * `target_ratio` - Target vertex ratio (0.5 = keep ~50% of vertices)
/// * `config` - Decimation configuration
///
/// # Returns
/// A new decimated mesh, or None if decimation would produce invalid mesh.
pub fn decimate_mesh(
    mesh_data: &MeshData,
    target_ratio: f32,
    config: &PropDecimationConfig,
) -> Option<MeshData> {
    let original_count = mesh_data.vertex_count();

    // Skip tiny meshes
    if original_count < config.min_vertices {
        return None;
    }

    // Calculate cell size based on mesh bounds and target ratio
    let bounds = calculate_bounds(&mesh_data.positions);
    let max_extent = (bounds.1[0] - bounds.0[0])
        .max(bounds.1[1] - bounds.0[1])
        .max(bounds.1[2] - bounds.0[2]);

    // Larger cell size = more aggressive decimation
    // We want target_ratio of vertices, so we need (1/target_ratio) cells per dimension
    // This gives us roughly target_ratio^3 cells, so we use cbrt
    let cells_per_dim = (1.0 / target_ratio).powf(0.33);
    let cell_size = (max_extent / cells_per_dim).max(config.cluster_cell_size);

    // Build vertex clusters
    let mut clusters: HashMap<(i32, i32, i32), VertexCluster> = HashMap::new();
    let mut vertex_to_cluster: Vec<(i32, i32, i32)> = Vec::with_capacity(original_count);

    for i in 0..original_count {
        let pos = mesh_data.positions[i];
        let normal = mesh_data.normals[i];
        let uv = mesh_data.uvs[i];
        let color = mesh_data.colors[i];

        let cell = position_to_cell(pos, cell_size);
        vertex_to_cluster.push(cell);

        clusters
            .entry(cell)
            .or_default()
            .add_vertex(pos, normal, uv, color);
    }

    // Build output vertices from clusters
    let mut output = MeshData::default();
    let mut cluster_to_output: HashMap<(i32, i32, i32), u32> = HashMap::new();

    for (cell, cluster) in clusters.iter() {
        if cluster.count == 0 {
            continue;
        }

        let (pos, normal, uv, color) = cluster.finalize();
        let output_idx = output.positions.len() as u32;

        output.positions.push(pos);
        output.normals.push(normal);
        output.uvs.push(uv);
        output.colors.push(color);

        cluster_to_output.insert(*cell, output_idx);
    }

    // Rebuild triangles using cluster indices
    for chunk in mesh_data.indices.chunks(3) {
        if chunk.len() != 3 {
            continue;
        }

        let i0 = chunk[0] as usize;
        let i1 = chunk[1] as usize;
        let i2 = chunk[2] as usize;

        if i0 >= vertex_to_cluster.len()
            || i1 >= vertex_to_cluster.len()
            || i2 >= vertex_to_cluster.len()
        {
            continue;
        }

        let c0 = vertex_to_cluster[i0];
        let c1 = vertex_to_cluster[i1];
        let c2 = vertex_to_cluster[i2];

        // Skip degenerate triangles (all vertices collapsed to same cluster)
        if c0 == c1 || c1 == c2 || c0 == c2 {
            continue;
        }

        if let (Some(&o0), Some(&o1), Some(&o2)) = (
            cluster_to_output.get(&c0),
            cluster_to_output.get(&c1),
            cluster_to_output.get(&c2),
        ) {
            output.indices.push(o0);
            output.indices.push(o1);
            output.indices.push(o2);
        }
    }

    // Validate output
    if output.vertex_count() < 4 || output.triangle_count() < 1 {
        return None;
    }

    Some(output)
}

/// Calculate axis-aligned bounding box of positions.
fn calculate_bounds(positions: &[[f32; 3]]) -> ([f32; 3], [f32; 3]) {
    let mut min = [f32::MAX, f32::MAX, f32::MAX];
    let mut max = [f32::MIN, f32::MIN, f32::MIN];

    for pos in positions {
        min[0] = min[0].min(pos[0]);
        min[1] = min[1].min(pos[1]);
        min[2] = min[2].min(pos[2]);
        max[0] = max[0].max(pos[0]);
        max[1] = max[1].max(pos[1]);
        max[2] = max[2].max(pos[2]);
    }

    (min, max)
}

/// Cached decimated prop mesh with multiple LOD levels.
#[derive(Clone)]
pub struct DecimatedPropMesh {
    /// Full detail mesh handle.
    pub full_detail: Handle<Mesh>,
    /// LOD1 mesh handle (50% decimation).
    pub lod1: Option<Handle<Mesh>>,
    /// LOD2 mesh handle (75% decimation).
    pub lod2: Option<Handle<Mesh>>,
    /// Material handle (shared across all LODs).
    pub material: Handle<StandardMaterial>,
    /// Local transform offset.
    pub local_transform: Transform,
    /// Original vertex count (for stats).
    pub original_vertices: usize,
    /// LOD1 vertex count.
    pub lod1_vertices: usize,
    /// LOD2 vertex count.
    pub lod2_vertices: usize,
}

/// Resource storing decimated meshes for each prop type.
#[derive(Resource, Default)]
pub struct DecimatedMeshCache {
    /// Decimated meshes keyed by prop ID.
    pub meshes: HashMap<String, Vec<DecimatedPropMesh>>,
    /// Whether decimation has been completed.
    pub initialized: bool,
}

/// System to create decimated mesh variants after prop meshes are extracted.
pub fn create_decimated_meshes(
    config: Res<PropDecimationConfig>,
    prop_cache: Res<super::instancing::PropMeshCache>,
    mut decimated_cache: ResMut<DecimatedMeshCache>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut stats: ResMut<DecimationStats>,
) {
    if !config.enabled || decimated_cache.initialized || !prop_cache.is_ready() {
        return;
    }

    let mut total_original = 0usize;
    let mut total_lod1 = 0usize;
    let mut total_lod2 = 0usize;
    let mut decimated_count = 0usize;

    for (prop_id, cached_meshes) in &prop_cache.meshes {
        let mut decimated_variants = Vec::new();

        for cached in cached_meshes {
            // Get the original mesh
            let Some(mesh) = meshes.get(&cached.mesh) else {
                continue;
            };

            let Some(mesh_data) = MeshData::from_mesh(mesh) else {
                continue;
            };

            let original_verts = mesh_data.vertex_count();
            total_original += original_verts;

            // Create LOD1 (50% decimation)
            let (lod1_handle, lod1_verts) =
                if let Some(lod1_data) = decimate_mesh(&mesh_data, config.target_ratio_lod1, &config)
                {
                    let verts = lod1_data.vertex_count();
                    total_lod1 += verts;
                    (Some(meshes.add(lod1_data.into_mesh())), verts)
                } else {
                    total_lod1 += original_verts;
                    (None, 0)
                };

            // Create LOD2 (75% decimation)
            let (lod2_handle, lod2_verts) =
                if let Some(lod2_data) = decimate_mesh(&mesh_data, config.target_ratio_lod2, &config)
                {
                    let verts = lod2_data.vertex_count();
                    total_lod2 += verts;
                    (Some(meshes.add(lod2_data.into_mesh())), verts)
                } else {
                    total_lod2 += original_verts;
                    (None, 0)
                };

            decimated_variants.push(DecimatedPropMesh {
                full_detail: cached.mesh.clone(),
                lod1: lod1_handle,
                lod2: lod2_handle,
                material: cached.material.clone(),
                local_transform: cached.local_transform,
                original_vertices: original_verts,
                lod1_vertices: lod1_verts,
                lod2_vertices: lod2_verts,
            });

            decimated_count += 1;
        }

        if !decimated_variants.is_empty() {
            decimated_cache.meshes.insert(prop_id.clone(), decimated_variants);
        }
    }

    decimated_cache.initialized = true;
    stats.meshes_decimated = decimated_count;
    stats.total_original_vertices = total_original;
    stats.total_lod1_vertices = total_lod1;
    stats.total_lod2_vertices = total_lod2;

    let reduction_lod1 = if total_original > 0 {
        100.0 * (1.0 - (total_lod1 as f32 / total_original as f32))
    } else {
        0.0
    };
    let reduction_lod2 = if total_original > 0 {
        100.0 * (1.0 - (total_lod2 as f32 / total_original as f32))
    } else {
        0.0
    };

    info!(
        "Mesh decimation complete: {} meshes, LOD1 {:.1}% reduction, LOD2 {:.1}% reduction",
        decimated_count, reduction_lod1, reduction_lod2
    );
}

/// Component for props with mesh LOD support.
#[derive(Component)]
pub struct MeshLod {
    /// Current LOD level (0 = full detail, 1 = LOD1, 2 = LOD2).
    pub current_lod: u8,
    /// Prop ID for cache lookup.
    pub prop_id: String,
    /// Index into the decimated mesh vec for this prop.
    pub mesh_index: usize,
}

/// Distance thresholds for mesh LOD.
#[derive(Resource)]
pub struct MeshLodDistances {
    /// Distance beyond which to use LOD1.
    pub lod1_distance: f32,
    /// Distance beyond which to use LOD2.
    pub lod2_distance: f32,
    /// Update interval in seconds.
    pub update_interval: f32,
}

impl Default for MeshLodDistances {
    fn default() -> Self {
        Self {
            lod1_distance: 50.0,
            lod2_distance: 100.0,
            update_interval: 0.2,
        }
    }
}
