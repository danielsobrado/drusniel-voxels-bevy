use bevy::camera::primitives::Aabb;
use bevy::math::Isometry3d;
use bevy::mesh::{Indices, VertexAttributeValues};
use bevy::prelude::*;

use crate::building::types::BuildingPiece;
use crate::props::instanced_render::{InstancedPropGroup, PropVisualRefs};
use crate::props::{Prop, PropType};
use crate::rendering::building_material::BuildingMaterialType;
use crate::runtime_commands::RuntimeViewportDebugState;
use crate::voxel::meshing::{ChunkMesh, WaterMesh};
use crate::voxel::types::VoxelType;
use crate::voxel::world::VoxelWorld;

const MAX_WIREFRAME_EDGES_PER_MESH: usize = 24_000;
const MAX_PROP_WIREFRAME_EDGES_PER_GROUP: usize = 42_000;
const MAX_PROP_WIREFRAME_INSTANCES_PER_GROUP: usize = 96;
const MAX_PROP_SCENE_WIREFRAME_EDGES: usize = 48_000;
const MAX_PROP_SCENE_DESCENDANTS: usize = 256;
const DEFAULT_PROP_WIREFRAME_SIZE: f32 = 3.0;
const SURFACE_SAMPLE_INSET: f32 = 0.08;

pub fn render_editor_wireframe_overlay(
    runtime_debug: Option<Res<RuntimeViewportDebugState>>,
    world: Res<VoxelWorld>,
    meshes: Res<Assets<Mesh>>,
    terrain_meshes: Query<(&GlobalTransform, Option<&Mesh3d>), With<ChunkMesh>>,
    water_meshes: Query<(&GlobalTransform, Option<&Mesh3d>), (With<WaterMesh>, Without<ChunkMesh>)>,
    props: Query<(Entity, &GlobalTransform, &Prop, Option<&PropVisualRefs>)>,
    children: Query<&Children>,
    mesh_nodes: Query<(&GlobalTransform, Option<&Mesh3d>)>,
    instanced_groups: Query<(&GlobalTransform, &InstancedPropGroup, Option<&Aabb>)>,
    building_pieces: Query<
        (&GlobalTransform, Option<&Mesh3d>, &BuildingPiece),
        (
            Without<ChunkMesh>,
            Without<WaterMesh>,
            Without<Prop>,
            Without<InstancedPropGroup>,
        ),
    >,
    mut gizmos: Gizmos,
) {
    let Some(debug) = runtime_debug else {
        return;
    };
    if !debug.editor_controlled || !debug.wireframe {
        return;
    }

    let water_color = Color::srgba(0.2, 0.78, 1.0, 0.7);
    for (transform, mesh) in &terrain_meshes {
        if !draw_terrain_wireframe(&mut gizmos, &world, &meshes, transform, mesh) {
            draw_chunk_fallback(&mut gizmos, transform, voxel_wire_color(VoxelType::Rock));
        }
    }

    for (transform, mesh) in &water_meshes {
        if !draw_mesh_wireframe(&mut gizmos, &meshes, transform, mesh, water_color) {
            draw_chunk_fallback(&mut gizmos, transform, water_color);
        }
    }

    for (entity, transform, prop, refs) in &props {
        let prop_color = prop_entity_wire_color(prop);
        if let Some(refs) = refs {
            for visual in &refs.refs {
                draw_local_bounds(
                    &mut gizmos,
                    transform,
                    visual.local_bounds.min,
                    visual.local_bounds.max,
                    visual.local_transform,
                    prop_color,
                );
            }
        } else if !draw_prop_scene_wireframe(
            &mut gizmos,
            &meshes,
            &children,
            &mesh_nodes,
            entity,
            prop_color,
        ) {
            draw_centered_box(
                &mut gizmos,
                transform.translation(),
                Vec3::splat(DEFAULT_PROP_WIREFRAME_SIZE),
                prop_color,
            );
        }
    }

    for (transform, group, bounds) in &instanced_groups {
        let prop_cluster_color = prop_group_wire_color(group.diagnostic_prop_type_mask);
        let drew_group_mesh = draw_instanced_prop_group_wireframe(
            &mut gizmos,
            &meshes,
            transform,
            group,
            prop_cluster_color,
        );
        if let Some(bounds) = bounds {
            if !drew_group_mesh {
                let center = transform.transform_point(bounds.center.into());
                let half_extents = Vec3::from(bounds.half_extents);
                draw_centered_box(&mut gizmos, center, half_extents * 2.0, prop_cluster_color);
            }
        }
    }

    for (transform, mesh, building) in &building_pieces {
        let color = building_wire_color(building.material);
        if !draw_mesh_wireframe(&mut gizmos, &meshes, transform, mesh, color) {
            draw_centered_box(
                &mut gizmos,
                transform.translation(),
                Vec3::splat(2.0),
                color,
            );
        }
    }
}

fn draw_terrain_wireframe(
    gizmos: &mut Gizmos,
    world: &VoxelWorld,
    meshes: &Assets<Mesh>,
    transform: &GlobalTransform,
    mesh: Option<&Mesh3d>,
) -> bool {
    let Some(mesh) = mesh.and_then(|mesh| meshes.get(&mesh.0)) else {
        return false;
    };
    let Some(VertexAttributeValues::Float32x3(positions)) =
        mesh.attribute(Mesh::ATTRIBUTE_POSITION)
    else {
        return false;
    };
    let normals = match mesh.attribute(Mesh::ATTRIBUTE_NORMAL) {
        Some(VertexAttributeValues::Float32x3(normals)) => Some(normals.as_slice()),
        _ => None,
    };

    let mut edges = 0usize;
    match mesh.indices() {
        Some(Indices::U16(indices)) => {
            for triangle in indices.chunks_exact(3) {
                if edges >= MAX_WIREFRAME_EDGES_PER_MESH {
                    break;
                }
                draw_colored_terrain_triangle_edges(
                    gizmos,
                    world,
                    transform,
                    positions,
                    normals,
                    triangle[0] as usize,
                    triangle[1] as usize,
                    triangle[2] as usize,
                );
                edges += 3;
            }
        }
        Some(Indices::U32(indices)) => {
            for triangle in indices.chunks_exact(3) {
                if edges >= MAX_WIREFRAME_EDGES_PER_MESH {
                    break;
                }
                draw_colored_terrain_triangle_edges(
                    gizmos,
                    world,
                    transform,
                    positions,
                    normals,
                    triangle[0] as usize,
                    triangle[1] as usize,
                    triangle[2] as usize,
                );
                edges += 3;
            }
        }
        None => {
            for base in (0..positions.len()).step_by(3) {
                if edges >= MAX_WIREFRAME_EDGES_PER_MESH || base + 2 >= positions.len() {
                    break;
                }
                draw_colored_terrain_triangle_edges(
                    gizmos,
                    world,
                    transform,
                    positions,
                    normals,
                    base,
                    base + 1,
                    base + 2,
                );
                edges += 3;
            }
        }
    }

    edges > 0
}

fn draw_colored_terrain_triangle_edges(
    gizmos: &mut Gizmos,
    world: &VoxelWorld,
    transform: &GlobalTransform,
    positions: &[[f32; 3]],
    normals: Option<&[[f32; 3]]>,
    a: usize,
    b: usize,
    c: usize,
) {
    let Some(local_a) = positions.get(a).copied().map(Vec3::from) else {
        return;
    };
    let Some(local_b) = positions.get(b).copied().map(Vec3::from) else {
        return;
    };
    let Some(local_c) = positions.get(c).copied().map(Vec3::from) else {
        return;
    };

    let world_a = transform.transform_point(local_a);
    let world_b = transform.transform_point(local_b);
    let world_c = transform.transform_point(local_c);
    let color = sample_triangle_wire_color(world, world_a, world_b, world_c, normals, a, b, c);

    gizmos.line(world_a, world_b, color);
    gizmos.line(world_b, world_c, color);
    gizmos.line(world_c, world_a, color);
}

fn sample_triangle_wire_color(
    world: &VoxelWorld,
    world_a: Vec3,
    world_b: Vec3,
    world_c: Vec3,
    normals: Option<&[[f32; 3]]>,
    a: usize,
    b: usize,
    c: usize,
) -> Color {
    let centroid = (world_a + world_b + world_c) / 3.0;
    let normal = averaged_normal(normals, a, b, c);
    let primary_sample = (centroid - normal * SURFACE_SAMPLE_INSET)
        .floor()
        .as_ivec3();
    if let Some(voxel) = world.get_voxel(primary_sample) {
        return voxel_wire_color(voxel);
    }

    let fallback_sample = centroid.floor().as_ivec3();
    voxel_wire_color(world.get_voxel(fallback_sample).unwrap_or(VoxelType::Rock))
}

fn averaged_normal(normals: Option<&[[f32; 3]]>, a: usize, b: usize, c: usize) -> Vec3 {
    let Some(normals) = normals else {
        return Vec3::Y;
    };
    let Some(na) = normals.get(a).copied().map(Vec3::from) else {
        return Vec3::Y;
    };
    let Some(nb) = normals.get(b).copied().map(Vec3::from) else {
        return Vec3::Y;
    };
    let Some(nc) = normals.get(c).copied().map(Vec3::from) else {
        return Vec3::Y;
    };
    (na + nb + nc).try_normalize().unwrap_or(Vec3::Y)
}

fn draw_mesh_wireframe(
    gizmos: &mut Gizmos,
    meshes: &Assets<Mesh>,
    transform: &GlobalTransform,
    mesh: Option<&Mesh3d>,
    color: Color,
) -> bool {
    let Some(mesh) = mesh.and_then(|mesh| meshes.get(&mesh.0)) else {
        return false;
    };
    let Some(VertexAttributeValues::Float32x3(positions)) =
        mesh.attribute(Mesh::ATTRIBUTE_POSITION)
    else {
        return false;
    };

    let mut edges = 0usize;
    match mesh.indices() {
        Some(Indices::U16(indices)) => {
            for triangle in indices.chunks_exact(3) {
                if edges >= MAX_WIREFRAME_EDGES_PER_MESH {
                    break;
                }
                draw_triangle_edges(
                    gizmos,
                    transform,
                    positions,
                    triangle[0] as usize,
                    triangle[1] as usize,
                    triangle[2] as usize,
                    color,
                );
                edges += 3;
            }
        }
        Some(Indices::U32(indices)) => {
            for triangle in indices.chunks_exact(3) {
                if edges >= MAX_WIREFRAME_EDGES_PER_MESH {
                    break;
                }
                draw_triangle_edges(
                    gizmos,
                    transform,
                    positions,
                    triangle[0] as usize,
                    triangle[1] as usize,
                    triangle[2] as usize,
                    color,
                );
                edges += 3;
            }
        }
        None => {
            for triangle in positions.chunks_exact(3) {
                if edges >= MAX_WIREFRAME_EDGES_PER_MESH {
                    break;
                }
                let a = transform.transform_point(Vec3::from(triangle[0]));
                let b = transform.transform_point(Vec3::from(triangle[1]));
                let c = transform.transform_point(Vec3::from(triangle[2]));
                gizmos.line(a, b, color);
                gizmos.line(b, c, color);
                gizmos.line(c, a, color);
                edges += 3;
            }
        }
    }

    edges > 0
}

fn draw_instanced_prop_group_wireframe(
    gizmos: &mut Gizmos,
    meshes: &Assets<Mesh>,
    group_transform: &GlobalTransform,
    group: &InstancedPropGroup,
    color: Color,
) -> bool {
    let Some(mesh) = meshes.get(&group.mesh) else {
        return false;
    };
    let Some(VertexAttributeValues::Float32x3(positions)) =
        mesh.attribute(Mesh::ATTRIBUTE_POSITION)
    else {
        return false;
    };

    let group_matrix = group_transform.to_matrix();
    let mut edges = 0usize;
    let mut drew_any = false;

    for instance in group
        .instances
        .iter()
        .take(MAX_PROP_WIREFRAME_INSTANCES_PER_GROUP)
    {
        if edges >= MAX_PROP_WIREFRAME_EDGES_PER_GROUP {
            break;
        }

        let instance_matrix = Mat4::from_cols_array_2d(&instance.transform);
        let mesh_matrix = group_matrix * instance_matrix;
        edges += draw_mesh_wireframe_matrix(
            gizmos,
            mesh,
            positions,
            mesh_matrix,
            color,
            MAX_PROP_WIREFRAME_EDGES_PER_GROUP - edges,
        );
        drew_any = true;
    }

    drew_any
}

fn draw_mesh_wireframe_matrix(
    gizmos: &mut Gizmos,
    mesh: &Mesh,
    positions: &[[f32; 3]],
    transform: Mat4,
    color: Color,
    max_edges: usize,
) -> usize {
    let mut edges = 0usize;
    match mesh.indices() {
        Some(Indices::U16(indices)) => {
            for triangle in indices.chunks_exact(3) {
                if edges >= max_edges {
                    break;
                }
                draw_triangle_edges_matrix(
                    gizmos,
                    transform,
                    positions,
                    triangle[0] as usize,
                    triangle[1] as usize,
                    triangle[2] as usize,
                    color,
                );
                edges += 3;
            }
        }
        Some(Indices::U32(indices)) => {
            for triangle in indices.chunks_exact(3) {
                if edges >= max_edges {
                    break;
                }
                draw_triangle_edges_matrix(
                    gizmos,
                    transform,
                    positions,
                    triangle[0] as usize,
                    triangle[1] as usize,
                    triangle[2] as usize,
                    color,
                );
                edges += 3;
            }
        }
        None => {
            for triangle in positions.chunks_exact(3) {
                if edges >= max_edges {
                    break;
                }
                let a = transform.transform_point3(Vec3::from(triangle[0]));
                let b = transform.transform_point3(Vec3::from(triangle[1]));
                let c = transform.transform_point3(Vec3::from(triangle[2]));
                gizmos.line(a, b, color);
                gizmos.line(b, c, color);
                gizmos.line(c, a, color);
                edges += 3;
            }
        }
    }

    edges
}

fn draw_prop_scene_wireframe(
    gizmos: &mut Gizmos,
    meshes: &Assets<Mesh>,
    children: &Query<&Children>,
    mesh_nodes: &Query<(&GlobalTransform, Option<&Mesh3d>)>,
    root: Entity,
    color: Color,
) -> bool {
    let mut stack = Vec::new();
    let mut visited = 0usize;
    let mut edges = 0usize;
    let mut drew_any = false;

    if let Ok(root_children) = children.get(root) {
        stack.extend(root_children.iter());
    }

    while let Some(entity) = stack.pop() {
        if visited >= MAX_PROP_SCENE_DESCENDANTS || edges >= MAX_PROP_SCENE_WIREFRAME_EDGES {
            break;
        }
        visited += 1;

        if let Ok((transform, mesh)) = mesh_nodes.get(entity) {
            if let Some(mesh) = mesh.and_then(|mesh| meshes.get(&mesh.0)) {
                if let Some(VertexAttributeValues::Float32x3(positions)) =
                    mesh.attribute(Mesh::ATTRIBUTE_POSITION)
                {
                    edges += draw_mesh_wireframe_matrix(
                        gizmos,
                        mesh,
                        positions,
                        transform.to_matrix(),
                        color,
                        MAX_PROP_SCENE_WIREFRAME_EDGES - edges,
                    );
                    drew_any = true;
                }
            }
        }

        if let Ok(child_entities) = children.get(entity) {
            stack.extend(child_entities.iter());
        }
    }

    drew_any
}

fn draw_triangle_edges(
    gizmos: &mut Gizmos,
    transform: &GlobalTransform,
    positions: &[[f32; 3]],
    a: usize,
    b: usize,
    c: usize,
    color: Color,
) {
    let Some(a) = positions.get(a).copied() else {
        return;
    };
    let Some(b) = positions.get(b).copied() else {
        return;
    };
    let Some(c) = positions.get(c).copied() else {
        return;
    };
    let a = transform.transform_point(Vec3::from(a));
    let b = transform.transform_point(Vec3::from(b));
    let c = transform.transform_point(Vec3::from(c));
    gizmos.line(a, b, color);
    gizmos.line(b, c, color);
    gizmos.line(c, a, color);
}

fn draw_triangle_edges_matrix(
    gizmos: &mut Gizmos,
    transform: Mat4,
    positions: &[[f32; 3]],
    a: usize,
    b: usize,
    c: usize,
    color: Color,
) {
    let Some(a) = positions.get(a).copied() else {
        return;
    };
    let Some(b) = positions.get(b).copied() else {
        return;
    };
    let Some(c) = positions.get(c).copied() else {
        return;
    };
    let a = transform.transform_point3(Vec3::from(a));
    let b = transform.transform_point3(Vec3::from(b));
    let c = transform.transform_point3(Vec3::from(c));
    gizmos.line(a, b, color);
    gizmos.line(b, c, color);
    gizmos.line(c, a, color);
}

fn draw_chunk_fallback(gizmos: &mut Gizmos, transform: &GlobalTransform, color: Color) {
    draw_centered_box(
        gizmos,
        transform.translation() + Vec3::splat(crate::constants::CHUNK_SIZE_F32 * 0.5),
        Vec3::splat(crate::constants::CHUNK_SIZE_F32),
        color,
    );
}

fn draw_local_bounds(
    gizmos: &mut Gizmos,
    transform: &GlobalTransform,
    local_min: Vec3,
    local_max: Vec3,
    local_transform: Transform,
    color: Color,
) {
    let center = (local_min + local_max) * 0.5;
    let size = (local_max - local_min).abs().max(Vec3::splat(0.25));
    let world_center = transform.transform_point(local_transform.transform_point(center));
    let world_size = size * local_transform.scale.abs();
    draw_centered_box(gizmos, world_center, world_size, color);
}

fn draw_centered_box(gizmos: &mut Gizmos, center: Vec3, size: Vec3, color: Color) {
    let cuboid = Cuboid::new(size.x.max(0.1), size.y.max(0.1), size.z.max(0.1));
    gizmos.primitive_3d(&cuboid, Isometry3d::from_translation(center), color);
}

fn voxel_wire_color(voxel: VoxelType) -> Color {
    match voxel {
        VoxelType::Air => Color::srgba(0.82, 0.86, 0.92, 0.32),
        VoxelType::TopSoil => Color::srgba(0.44, 1.0, 0.26, 0.78),
        VoxelType::SubSoil => Color::srgba(0.64, 0.42, 0.22, 0.78),
        VoxelType::Rock => Color::srgba(0.72, 0.74, 0.78, 0.78),
        VoxelType::Bedrock => Color::srgba(0.32, 0.34, 0.39, 0.84),
        VoxelType::Sand => Color::srgba(1.0, 0.86, 0.36, 0.8),
        VoxelType::Clay => Color::srgba(0.88, 0.42, 0.28, 0.8),
        VoxelType::Water => Color::srgba(0.2, 0.78, 1.0, 0.76),
        VoxelType::Wood => Color::srgba(0.76, 0.44, 0.18, 0.82),
        VoxelType::Leaves => Color::srgba(0.16, 0.86, 0.38, 0.72),
        VoxelType::DungeonWall => Color::srgba(0.74, 0.54, 1.0, 0.84),
        VoxelType::DungeonFloor => Color::srgba(1.0, 0.5, 0.78, 0.84),
    }
}

fn prop_wire_color(prop_type: PropType) -> Color {
    match prop_type {
        PropType::Tree => Color::srgba(0.16, 1.0, 0.38, 0.78),
        PropType::Rock => Color::srgba(0.78, 0.8, 0.86, 0.78),
        PropType::Bush => Color::srgba(0.0, 0.82, 0.46, 0.78),
        PropType::Flower => Color::srgba(1.0, 0.28, 0.72, 0.82),
    }
}

fn prop_entity_wire_color(prop: &Prop) -> Color {
    let id = prop.id.to_lowercase();
    if id.contains("house") || id.contains("hut") || id.contains("inn") || id.contains("stable") {
        return Color::srgba(1.0, 0.72, 0.24, 0.84);
    }

    if id.contains("building") {
        return Color::srgba(1.0, 0.82, 0.34, 0.84);
    }

    prop_wire_color(prop.prop_type)
}

fn prop_group_wire_color(prop_type_mask: u8) -> Color {
    match prop_type_mask {
        1 => prop_wire_color(PropType::Tree),
        2 => prop_wire_color(PropType::Rock),
        4 => prop_wire_color(PropType::Bush),
        8 => prop_wire_color(PropType::Flower),
        0 => Color::srgba(1.0, 0.68, 0.18, 0.72),
        _ => Color::srgba(1.0, 0.68, 0.18, 0.82),
    }
}

fn building_wire_color(material: BuildingMaterialType) -> Color {
    match material {
        BuildingMaterialType::WoodPlank => Color::srgba(0.95, 0.58, 0.22, 0.82),
        BuildingMaterialType::StoneBrick => Color::srgba(0.7, 0.74, 0.82, 0.82),
        BuildingMaterialType::MetalPlate => Color::srgba(0.56, 0.78, 1.0, 0.82),
        BuildingMaterialType::Thatch => Color::srgba(1.0, 0.86, 0.28, 0.82),
    }
}
