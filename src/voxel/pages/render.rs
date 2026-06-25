//! Phase 5 Step 3b part 2: commit completed page trees as hidden terrain mesh entities.

use std::collections::{HashMap, VecDeque};

use bevy::asset::RenderAssetUsages;
use bevy::camera::visibility::RenderLayers;
use bevy::light::NotShadowCaster;
use bevy::prelude::*;
use bevy_mesh::{Indices, PrimitiveTopology};

use super::build_queue::{ClodPageBuildStatus, ClodPageTree};
use super::selection::{ClodPageNodeKey, ClodPageSelectionIndex};
use super::types::PageMesh;
use crate::rendering::triplanar_material::{
    TerrainMaterialQuality, TriplanarMaterial, TriplanarMaterialHandle,
};
use crate::voxel::meshing::{TERRAIN_MESH_SECTION_MAIN, encode_barycentric_uv};
const PAGE_MESH_COMMITS_PER_FRAME: usize = 4;

#[derive(Component, Clone, Copy, Debug, PartialEq, Eq)]
pub struct ClodPageMeshTag {
    pub level: usize,
    pub coord: (i32, i32),
}

#[derive(Component, Clone, Copy, Debug, Default, PartialEq)]
pub struct ClodPageMeshBounds {
    pub min_y: f32,
    pub max_y: f32,
}

#[derive(Resource, Default)]
pub(crate) struct ClodPageMeshCommitState {
    committed_tree_revision: Option<u64>,
    entities: Vec<Entity>,
    mesh_handles: Vec<Handle<Mesh>>,
    material_handles: Vec<Handle<TriplanarMaterial>>,
    retired_mesh_handles: Vec<Handle<Mesh>>,
    retired_material_handles: Vec<Handle<TriplanarMaterial>>,
    pending: Option<PendingMeshCommit>,
}

struct PendingMeshCommit {
    tree_revision: u64,
    remaining_nodes: VecDeque<(usize, usize)>,
    entities: Vec<Entity>,
    mesh_handles: Vec<Handle<Mesh>>,
    material_handles: Vec<Handle<TriplanarMaterial>>,
    bounds_by_node: HashMap<ClodPageNodeKey, ClodPageMeshBounds>,
}

fn page_mesh_y_bounds(page_mesh: &PageMesh) -> ClodPageMeshBounds {
    let mut ys = page_mesh.positions.iter().map(|position| position[1]);
    let Some(first) = ys.next() else {
        return ClodPageMeshBounds::default();
    };
    ys.fold(
        ClodPageMeshBounds {
            min_y: first,
            max_y: first,
        },
        |mut bounds, y| {
            bounds.min_y = bounds.min_y.min(y);
            bounds.max_y = bounds.max_y.max(y);
            bounds
        },
    )
}

fn page_mesh_to_bevy_mesh(page_mesh: &PageMesh) -> (Mesh, ClodPageMeshBounds) {
    let vertex_count = page_mesh.positions.len();
    let mut mesh = Mesh::new(
        PrimitiveTopology::TriangleList,
        RenderAssetUsages::RENDER_WORLD,
    );
    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, page_mesh.positions.clone());
    mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, page_mesh.normals.clone());
    mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, vec![[1.0, 0.0]; vertex_count]);
    mesh.insert_attribute(
        Mesh::ATTRIBUTE_UV_1,
        vec![encode_barycentric_uv([0.0, 0.0], TERRAIN_MESH_SECTION_MAIN, 0); vertex_count],
    );
    mesh.insert_attribute(Mesh::ATTRIBUTE_COLOR, page_mesh.materials.clone());
    mesh.insert_indices(Indices::U32(page_mesh.indices.clone()));
    (mesh, page_mesh_y_bounds(page_mesh))
}

fn clear_pending_commit(
    commands: &mut Commands,
    meshes: &mut Assets<Mesh>,
    materials: &mut Assets<TriplanarMaterial>,
    state: &mut ClodPageMeshCommitState,
) {
    let Some(mut pending) = state.pending.take() else {
        return;
    };
    for entity in pending.entities.drain(..) {
        commands.entity(entity).despawn();
    }
    remove_mesh_assets(meshes, pending.mesh_handles);
    remove_material_assets(materials, pending.material_handles);
}

fn remove_mesh_assets(meshes: &mut Assets<Mesh>, handles: Vec<Handle<Mesh>>) {
    for handle in handles {
        meshes.remove(handle.id());
    }
}

fn remove_material_assets(
    materials: &mut Assets<TriplanarMaterial>,
    handles: Vec<Handle<TriplanarMaterial>>,
) {
    for handle in handles {
        materials.remove(handle.id());
    }
}

fn clod_page_material(
    materials: &mut Assets<TriplanarMaterial>,
    base_handle: &Handle<TriplanarMaterial>,
) -> Handle<TriplanarMaterial> {
    let mut material = materials
        .get(base_handle)
        .cloned()
        .unwrap_or_else(TriplanarMaterial::default);
    material.quality = TerrainMaterialQuality::FullTriplanar;
    material.clod_page_dither = true;
    material.uniforms.clod_fade = 0.0;
    materials.add(material)
}

pub(crate) fn clod_page_mesh_commit_system(
    mut commands: Commands,
    tree: Res<ClodPageTree>,
    triplanar_material: Res<TriplanarMaterialHandle>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<TriplanarMaterial>>,
    mut state: ResMut<ClodPageMeshCommitState>,
    mut selection_index: ResMut<ClodPageSelectionIndex>,
) {
    remove_mesh_assets(&mut meshes, std::mem::take(&mut state.retired_mesh_handles));
    remove_material_assets(
        &mut materials,
        std::mem::take(&mut state.retired_material_handles),
    );

    if !matches!(tree.status.as_ref(), Some(ClodPageBuildStatus::Ready))
        || state.committed_tree_revision == Some(tree.revision)
    {
        return;
    }

    let material_handle =
        triplanar_material.handle_for_quality(TerrainMaterialQuality::FullTriplanar);
    if state
        .pending
        .as_ref()
        .is_none_or(|pending| pending.tree_revision != tree.revision)
    {
        clear_pending_commit(&mut commands, &mut meshes, &mut materials, &mut state);
        let node_count = tree.nodes_by_level.iter().map(Vec::len).sum();
        let remaining_nodes = tree
            .nodes_by_level
            .iter()
            .enumerate()
            .flat_map(|(level_index, nodes)| {
                (0..nodes.len()).map(move |node_index| (level_index, node_index))
            })
            .collect();
        state.pending = Some(PendingMeshCommit {
            tree_revision: tree.revision,
            remaining_nodes,
            entities: Vec::with_capacity(node_count),
            mesh_handles: Vec::with_capacity(node_count),
            material_handles: Vec::with_capacity(node_count),
            bounds_by_node: HashMap::with_capacity(node_count),
        });
    }

    let Some(pending) = state.pending.as_mut() else {
        return;
    };
    for _ in 0..PAGE_MESH_COMMITS_PER_FRAME {
        let Some((level_index, node_index)) = pending.remaining_nodes.pop_front() else {
            break;
        };
        let Some(node) = tree
            .nodes_by_level
            .get(level_index)
            .and_then(|nodes| nodes.get(node_index))
        else {
            clear_pending_commit(&mut commands, &mut meshes, &mut materials, &mut state);
            return;
        };

        let (mesh, bounds) = page_mesh_to_bevy_mesh(&node.mesh);
        let mesh_handle = meshes.add(mesh);
        let page_material_handle = clod_page_material(&mut materials, &material_handle);
        pending
            .bounds_by_node
            .insert(ClodPageNodeKey::new(node.level, node.coord), bounds);
        let entity = commands
            .spawn((
                Mesh3d(mesh_handle.clone()),
                MeshMaterial3d::<TriplanarMaterial>(page_material_handle.clone()),
                Transform::IDENTITY,
                RenderLayers::default(),
                NotShadowCaster,
                Visibility::Hidden,
                ClodPageMeshTag {
                    level: node.level,
                    coord: node.coord,
                },
                bounds,
            ))
            .id();
        pending.entities.push(entity);
        pending.mesh_handles.push(mesh_handle);
        pending.material_handles.push(page_material_handle);
    }

    if state
        .pending
        .as_ref()
        .is_some_and(|pending| !pending.remaining_nodes.is_empty())
    {
        return;
    }

    let pending = state.pending.take().expect("pending commit exists");
    for entity in state.entities.drain(..) {
        commands.entity(entity).despawn();
    }
    let mut old_mesh_handles = std::mem::take(&mut state.mesh_handles);
    state.retired_mesh_handles.append(&mut old_mesh_handles);
    let mut old_material_handles = std::mem::take(&mut state.material_handles);
    state
        .retired_material_handles
        .append(&mut old_material_handles);
    state.entities = pending.entities;
    state.mesh_handles = pending.mesh_handles;
    state.material_handles = pending.material_handles;
    state.committed_tree_revision = Some(tree.revision);
    selection_index.rebuild(&tree, &pending.bounds_by_node);
}

#[cfg(test)]
mod tests {
    use super::super::runtime::ClodPagesRuntime;
    use super::*;
    use crate::voxel::pages::diagonal_polish::DiagonalPolishStats;
    use crate::voxel::pages::quadtree::ClodPageNode;
    use crate::voxel::pages::types::PageFootprint;
    use bevy_mesh::VertexAttributeValues;

    fn material_handles() -> TriplanarMaterialHandle {
        TriplanarMaterialHandle {
            handle: default(),
            cheap_handle: default(),
            single_projection_far_handle: default(),
            horizon_proxy_handle: default(),
            atlas_only_debug_handle: default(),
            wireframe_debug_handle: default(),
            normals_debug_handle: default(),
            wireframe_normals_debug_handle: default(),
            flat_unlit_debug_handle: default(),
            wireframe_flat_unlit_debug_handle: default(),
        }
    }

    fn node(coord: (i32, i32)) -> ClodPageNode {
        ClodPageNode {
            level: 0,
            coord,
            footprint: PageFootprint {
                min_x: 0.0,
                min_z: 0.0,
                max_x: 64.0,
                max_z: 64.0,
            },
            mesh: PageMesh::default(),
            error_world: 0.0,
            low_benefit: false,
            polish: DiagonalPolishStats::default(),
        }
    }

    fn committed_tags(app: &mut App) -> Vec<ClodPageMeshTag> {
        let world = app.world_mut();
        let mut query = world.query::<&ClodPageMeshTag>();
        query.iter(world).copied().collect()
    }

    #[test]
    fn page_mesh_uses_only_the_terrain_attributes_pages_need() {
        let page_mesh = PageMesh {
            positions: vec![[1.0, -2.0, 3.0], [4.0, 6.0, 7.0], [8.0, 1.0, 9.0]],
            normals: vec![[0.0, 1.0, 0.0]; 3],
            materials: vec![[1.0, 0.0, 0.0, 0.0]; 3],
            paint_slots: vec![0.0; 3],
            material_weight_stride: 4,
            indices: vec![0, 1, 2],
        };

        let (mesh, bounds) = page_mesh_to_bevy_mesh(&page_mesh);

        assert!(mesh.attribute(Mesh::ATTRIBUTE_POSITION).is_some());
        assert!(mesh.attribute(Mesh::ATTRIBUTE_NORMAL).is_some());
        assert!(mesh.attribute(Mesh::ATTRIBUTE_COLOR).is_some());
        assert_eq!(
            mesh.attribute(Mesh::ATTRIBUTE_UV_0),
            Some(&VertexAttributeValues::Float32x2(vec![[1.0, 0.0]; 3]))
        );
        assert_eq!(
            mesh.attribute(Mesh::ATTRIBUTE_UV_1),
            Some(&VertexAttributeValues::Float32x2(vec![
                encode_barycentric_uv(
                    [0.0, 0.0],
                    TERRAIN_MESH_SECTION_MAIN,
                    0
                );
                3
            ]))
        );
        assert_eq!(bounds.min_y, -2.0);
        assert_eq!(bounds.max_y, 6.0);
    }

    #[test]
    fn replacement_is_atomic() {
        let mut app = App::new();
        app.insert_resource(ClodPagesRuntime::default())
            .insert_resource(ClodPageTree {
                nodes_by_level: vec![vec![node((0, 0))]],
                polish: DiagonalPolishStats::default(),
                revision: 1,
                page_coords: vec![(0, 0)],
                build_page_coords: vec![(0, 0)],
                status: Some(ClodPageBuildStatus::Ready),
            })
            .insert_resource(material_handles())
            .init_resource::<Assets<Mesh>>()
            .init_resource::<Assets<TriplanarMaterial>>()
            .init_resource::<ClodPageMeshCommitState>()
            .init_resource::<ClodPageSelectionIndex>()
            .add_systems(Update, clod_page_mesh_commit_system);

        app.update();
        assert_eq!(
            committed_tags(&mut app),
            vec![ClodPageMeshTag {
                level: 0,
                coord: (0, 0)
            }]
        );

        app.world_mut().resource_mut::<ClodPageTree>().status = Some(ClodPageBuildStatus::Building);
        app.update();
        assert_eq!(
            committed_tags(&mut app),
            vec![ClodPageMeshTag {
                level: 0,
                coord: (0, 0)
            }]
        );

        {
            let mut tree = app.world_mut().resource_mut::<ClodPageTree>();
            tree.nodes_by_level = vec![vec![node((1, 0))]];
            tree.revision = 2;
            tree.status = Some(ClodPageBuildStatus::Ready);
        }
        app.update();
        assert_eq!(
            committed_tags(&mut app),
            vec![ClodPageMeshTag {
                level: 0,
                coord: (1, 0)
            }]
        );
    }
}
