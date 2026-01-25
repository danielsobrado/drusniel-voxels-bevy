use bevy::prelude::*;
use bevy::asset::RenderAssetUsages;
use bevy::camera::RenderTarget;
use bevy::render::render_resource::{
    Extent3d, TextureDescriptor, TextureDimension, TextureFormat, TextureUsages,
};
// use bevy::render::view::visibility::RenderLayers;
// RenderLayers API is unstable in this version, using position offset instead
use bevy_mesh::{Indices, PrimitiveTopology};

use crate::constants::{ATLAS_COLUMNS, ATLAS_ROWS};
use crate::rendering::array_loader::AtlasMapping;
use crate::rendering::atlas::TextureAtlas;
use crate::rendering::triplanar_material::TriplanarMaterialHandle;

use crate::menu::types::ActiveTextureLayer;

// Layer 1 for Blocky, Layer 2 for Triplanar (Layer 0 is Main World)
// pub const BLOCK_PREVIEW_LAYER: RenderLayers = RenderLayers::layer(1);
// pub const TRIPLANAR_PREVIEW_LAYER: RenderLayers = RenderLayers::layer(2);
pub const PREVIEW_IMAGE_SIZE: u32 = 256;

// Move previews far away to avoid rendering main world objects
pub const BLOCK_PREVIEW_ORIGIN: Vec3 = Vec3::new(5000.0, 5000.0, 5000.0);
pub const TRIPLANAR_PREVIEW_ORIGIN: Vec3 = Vec3::new(5200.0, 5000.0, 5000.0);

#[derive(Component)]
pub struct BlockPreviewScene;

#[derive(Component)]
pub struct BlockPreviewRotate;

#[derive(Component)]
pub struct BlockPreviewMesh;

#[derive(Resource)]
pub struct BlockPreviewImage(pub Handle<Image>);

#[derive(Resource)]
pub struct BlockPreviewMaterial(pub Handle<StandardMaterial>);

#[derive(Component)]
pub struct TriplanarPreviewScene;

#[derive(Component)]
pub struct TriplanarPreviewMesh;

#[derive(Resource)]
pub struct TriplanarPreviewImage(pub Handle<Image>);

pub struct BlockPreviewPlugin;

impl Plugin for BlockPreviewPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Startup, setup_preview_resources);
        app.add_systems(Update, (
            setup_preview_material,
            rotate_preview_mesh,
            update_preview_mesh_materials,
            update_triplanar_preview_mesh,
        ));
    }
}

/// Creates the StandardMaterial for the preview cube using the atlas texture
fn setup_preview_material(
    mut commands: Commands,
    mut materials: ResMut<Assets<StandardMaterial>>,
    atlas: Option<Res<TextureAtlas>>,
    existing: Option<Res<BlockPreviewMaterial>>,
) {
    // Only run once when atlas is available and material doesn't exist yet
    if existing.is_some() {
        return;
    }
    let Some(atlas) = atlas else {
        return;
    };

    let material = materials.add(StandardMaterial {
        base_color_texture: Some(atlas.handle.clone()),
        unlit: true,
        alpha_mode: AlphaMode::Opaque,
        ..default()
    });
    commands.insert_resource(BlockPreviewMaterial(material));
}

fn setup_preview_resources(
    mut commands: Commands,
    mut images: ResMut<Assets<Image>>,
) {
    let size = Extent3d {
        width: PREVIEW_IMAGE_SIZE,
        height: PREVIEW_IMAGE_SIZE,
        ..default()
    };

    // Blocky Preview Image
    let mut image = Image {
        texture_descriptor: TextureDescriptor {
            label: Some("Block Preview Image"),
            size,
            dimension: TextureDimension::D2,
            format: TextureFormat::Bgra8UnormSrgb,
            mip_level_count: 1,
            sample_count: 1,
            usage: TextureUsages::TEXTURE_BINDING
                | TextureUsages::COPY_DST
                | TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        },
        ..default()
    };
    image.resize(size);
    let image_handle = images.add(image);
    commands.insert_resource(BlockPreviewImage(image_handle));

    // Triplanar Preview Image
    let mut trip_image = Image {
        texture_descriptor: TextureDescriptor {
            label: Some("Triplanar Preview Image"),
            size,
            dimension: TextureDimension::D2,
            format: TextureFormat::Bgra8UnormSrgb,
            mip_level_count: 1,
            sample_count: 1,
            usage: TextureUsages::TEXTURE_BINDING
                | TextureUsages::COPY_DST
                | TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        },
        ..default()
    };
    trip_image.resize(size);
    let trip_handle = images.add(trip_image);
    commands.insert_resource(TriplanarPreviewImage(trip_handle));
}

// Spawns the 3D scene (Blocky Cube)
pub fn spawn_preview_scene(
    commands: &mut Commands,
    preview_image: &Res<BlockPreviewImage>,
    meshes: &mut ResMut<Assets<Mesh>>,
    preview_material: &Res<BlockPreviewMaterial>,
    atlas_mapping: &Res<AtlasMapping>,
    active_layer: ActiveTextureLayer,
) -> Entity {
    let root = commands
        .spawn((
            Transform::from_translation(BLOCK_PREVIEW_ORIGIN),
            GlobalTransform::default(),
            Visibility::default(),
            InheritedVisibility::default(),
            ViewVisibility::default(),
            BlockPreviewScene,
            // BLOCK_PREVIEW_LAYER, // Layer 1
        ))
        .id();

    // Camera - unique order to avoid ambiguity warnings
    let camera = commands.spawn((
        Camera3d::default(),
        Camera {
            target: RenderTarget::Image(preview_image.0.clone().into()),
            order: 100, // High unique order for block preview
            clear_color: bevy::prelude::ClearColorConfig::Custom(Color::srgba(0.1, 0.1, 0.1, 1.0)),
            ..default()
        },
        Transform::from_xyz(1.2, 0.8, 1.2).looking_at(Vec3::ZERO, Vec3::Y),
        // BLOCK_PREVIEW_LAYER,
    )).id();

    // Light
    let light = commands.spawn((
        PointLight {
            intensity: 1500.0,
            shadows_enabled: true,
            ..default()
        },
        Transform::from_xyz(4.0, 8.0, 4.0),
        GlobalTransform::default(),
        // BLOCK_PREVIEW_LAYER,
    )).id();

    // Cube - uses StandardMaterial with atlas texture and atlas-based UVs
    let mesh_handle = meshes.add(create_preview_cube_mesh(atlas_mapping, active_layer));

    let cube = commands.spawn((
        Mesh3d(mesh_handle),
        MeshMaterial3d(preview_material.0.clone()),
        Transform::from_xyz(0.0, 0.0, 0.0),
        BlockPreviewRotate,
        BlockPreviewMesh,
        // BLOCK_PREVIEW_LAYER,
    )).id();

    commands.entity(root).add_child(camera).add_child(light).add_child(cube);

    root
}

// Spawns the Triplanar scene (Ground Plane)
pub fn spawn_triplanar_preview_scene(
    commands: &mut Commands,
    preview_image: &Res<TriplanarPreviewImage>,
    meshes: &mut ResMut<Assets<Mesh>>,
    triplanar_material: &Res<TriplanarMaterialHandle>,
) -> Entity {
    let root = commands
        .spawn((
            Transform::from_translation(TRIPLANAR_PREVIEW_ORIGIN),
            GlobalTransform::default(),
            Visibility::default(),
            InheritedVisibility::default(),
            ViewVisibility::default(),
            TriplanarPreviewScene,
            // TRIPLANAR_PREVIEW_LAYER, // Layer 2
        ))
        .id();

    // Camera - Orthographic Top-Down (2D Look)
    let camera = commands.spawn((
        Camera3d::default(),
        Projection::Orthographic(OrthographicProjection {
            scale: 1.0,
            near: -100.0,
            far: 100.0,
            scaling_mode: Default::default(),
            viewport_origin: Vec2::new(0.5, 0.5),
            area: Rect::default(),
        }),
        Camera {
            target: RenderTarget::Image(preview_image.0.clone().into()),
            order: 11,
            ..default()
        },
        Transform::from_xyz(0.0, 5.0, 0.0).looking_at(Vec3::ZERO, Vec3::Z), // Look down -Y, Up is +Z? 
                             // Wait, Plane is XZ plane. Looking down Y. Up vector usually -Z or +Z.
                             // Default 3D look_at uses Y as up. If looking down Y, need distinct up.
                             // Let's use look_at(ZERO, Vec3::X) to orient correctly?
                             // Plane geometry: [-1, -1] to [1, 1] in XZ? 
                             // create_triplanar_plane_mesh uses XZ plane.
                             // So we want to look from +Y down to 0.
    )).id();

    // Light
    let light = commands.spawn((
        PointLight {
            intensity: 2000.0,
            shadows_enabled: true,
            range: 20.0,
            ..default()
        },
        Transform::from_xyz(2.0, 6.0, 2.0),
        GlobalTransform::default(),
        // TRIPLANAR_PREVIEW_LAYER,
    )).id();

    // Plane Mesh
    let mesh_handle = meshes.add(create_triplanar_plane_mesh(0)); // Default to Grass

    let plane = commands.spawn((
        Mesh3d(mesh_handle),
        MeshMaterial3d(triplanar_material.handle.clone()),
        Transform::from_xyz(0.0, 0.0, 0.0),
        // No rotation for ground plane
        TriplanarPreviewMesh,
        // TRIPLANAR_PREVIEW_LAYER,
    )).id();

    commands.entity(root).add_child(camera).add_child(light).add_child(plane);

    root
}

fn rotate_preview_mesh(
    time: Res<Time>,
    mut query: Query<&mut Transform, With<BlockPreviewRotate>>,
) {
    for mut transform in query.iter_mut() {
        transform.rotate_y(0.5 * time.delta().as_secs_f32());
    }
}

fn update_preview_mesh_materials(
    mut meshes: ResMut<Assets<Mesh>>,
    query: Query<&Mesh3d, With<BlockPreviewMesh>>,
    atlas_mapping: Res<AtlasMapping>,
    active_layer: Res<ActiveTextureLayer>,
) {
    for mesh_handle in query.iter() {
        if let Some(mesh) = meshes.get_mut(&mesh_handle.0) {
            *mesh = create_preview_cube_mesh(&atlas_mapping, *active_layer);
        }
    }
}

fn update_triplanar_preview_mesh(
    mut meshes: ResMut<Assets<Mesh>>,
    query: Query<&Mesh3d, With<TriplanarPreviewMesh>>,
    active_layer: Res<ActiveTextureLayer>,
) {
    if !active_layer.is_changed() {
        return;
    }

    // Map active layer to Triplanar Material Index
    let mat_idx = match *active_layer {
        ActiveTextureLayer::Grass => 0,
        ActiveTextureLayer::Dirt => 3,
        ActiveTextureLayer::Rock => 1,
        ActiveTextureLayer::Sand => 2,
    };

    for mesh_handle in query.iter() {
        if let Some(mesh) = meshes.get_mut(&mesh_handle.0) {
            *mesh = create_triplanar_plane_mesh(mat_idx);
        }
    }
}

fn create_triplanar_plane_mesh(mat_idx: u32) -> Mesh {
    // 2x2 Plane
    let size = 2.0;
    let half = size / 2.0;
    
    let positions = vec![
        [-half, 0.0, -half], [ half, 0.0, -half], [ half, 0.0,  half], [-half, 0.0,  half],
    ];
    let normals = vec![[0.0, 1.0, 0.0]; 4];
    let uvs = vec![
        [0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]
    ];
    let indices = vec![0, 3, 1, 1, 3, 2];
    
    // Colors for material weights
    // R=Mat0(Grass), G=Mat1(Rock), B=Mat2(Sand), A=Mat3(Dirt)
    let color = match mat_idx {
        0 => [1.0, 0.0, 0.0, 0.0], // Grass
        1 => [0.0, 1.0, 0.0, 0.0], // Rock
        2 => [0.0, 0.0, 1.0, 0.0], // Sand
        3 => [0.0, 0.0, 0.0, 1.0], // Dirt
        _ => [1.0, 0.0, 0.0, 0.0],
    };
    let colors = vec![color; 4];

    let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default());
    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions);
    mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, normals);
    mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, uvs);
    mesh.insert_attribute(Mesh::ATTRIBUTE_COLOR, colors);
    mesh.insert_indices(Indices::U32(indices));
    
    mesh
}

/// Compute atlas UVs for a tile index
/// Atlas is ATLAS_COLUMNS x ATLAS_ROWS grid, each tile takes 1/cols width and 1/rows height
fn tile_uvs(tile_idx: u32) -> [[f32; 2]; 4] {
    let cols = ATLAS_COLUMNS as f32;
    let rows = ATLAS_ROWS as f32;
    let col = (tile_idx % ATLAS_COLUMNS) as f32;
    let row = (tile_idx / ATLAS_COLUMNS) as f32;

    let u_min = col / cols;
    let u_max = (col + 1.0) / cols;
    let v_min = row / rows;
    let v_max = (row + 1.0) / rows;

    // UV corners: top-left, top-right, bottom-right, bottom-left
    [
        [u_min, v_min],
        [u_max, v_min],
        [u_max, v_max],
        [u_min, v_max],
    ]
}

fn create_preview_cube_mesh(mapping: &AtlasMapping, layer: ActiveTextureLayer) -> Mesh {
    let size = 1.0;
    let half = size / 2.0;

    // Get tile indices from atlas mapping for the active layer
    let block_map = match layer {
        ActiveTextureLayer::Grass => &mapping.grass,
        ActiveTextureLayer::Dirt => &mapping.dirt,
        ActiveTextureLayer::Rock => &mapping.rock,
        ActiveTextureLayer::Sand => &mapping.sand,
    };

    let top_tile = block_map.top;
    let side_tile = block_map.side;
    let bottom_tile = block_map.bottom;

    // Compute atlas UVs for each face
    let top_uvs = tile_uvs(top_tile);
    let bottom_uvs = tile_uvs(bottom_tile);
    let side_uvs = tile_uvs(side_tile);

    // 24 vertices (4 per face)
    let positions = vec![
        // Top (+Y)
        [-half, half, -half], [ half, half, -half], [ half, half,  half], [-half, half,  half],
        // Bottom (-Y)
        [-half,-half,  half], [ half,-half,  half], [ half,-half, -half], [-half,-half, -half],
        // Right (+X)
        [ half, half, -half], [ half,-half, -half], [ half,-half,  half], [ half, half,  half],
        // Left (-X)
        [-half, half,  half], [-half,-half,  half], [-half,-half, -half], [-half, half, -half],
        // Front (+Z)
        [-half, half,  half], [ half, half,  half], [ half,-half,  half], [-half,-half,  half],
        // Back (-Z)
        [ half, half, -half], [-half, half, -half], [-half,-half, -half], [ half,-half, -half],
    ];

    let normals = vec![
        // Top
        [0.0, 1.0, 0.0], [0.0, 1.0, 0.0], [0.0, 1.0, 0.0], [0.0, 1.0, 0.0],
        // Bottom
        [0.0, -1.0, 0.0], [0.0, -1.0, 0.0], [0.0, -1.0, 0.0], [0.0, -1.0, 0.0],
        // Right
        [1.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 0.0, 0.0],
        // Left
        [-1.0, 0.0, 0.0], [-1.0, 0.0, 0.0], [-1.0, 0.0, 0.0], [-1.0, 0.0, 0.0],
        // Front
        [0.0, 0.0, 1.0], [0.0, 0.0, 1.0], [0.0, 0.0, 1.0], [0.0, 0.0, 1.0],
        // Back
        [0.0, 0.0, -1.0], [0.0, 0.0, -1.0], [0.0, 0.0, -1.0], [0.0, 0.0, -1.0],
    ];

    // UVs mapped to atlas tile positions
    let uvs = vec![
        top_uvs[0], top_uvs[1], top_uvs[2], top_uvs[3],       // Top face
        bottom_uvs[0], bottom_uvs[1], bottom_uvs[2], bottom_uvs[3], // Bottom face
        side_uvs[0], side_uvs[1], side_uvs[2], side_uvs[3],   // Right face
        side_uvs[0], side_uvs[1], side_uvs[2], side_uvs[3],   // Left face
        side_uvs[0], side_uvs[1], side_uvs[2], side_uvs[3],   // Front face
        side_uvs[0], side_uvs[1], side_uvs[2], side_uvs[3],   // Back face
    ];

    let indices = vec![
        0, 3, 1, 1, 3, 2,      // Top
        4, 7, 5, 5, 7, 6,      // Bottom
        8, 11, 9, 9, 11, 10,   // Right
        12, 15, 13, 13, 15, 14,// Left
        16, 19, 17, 17, 19, 18,// Front
        20, 23, 21, 21, 23, 22 // Back
    ];

    let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default());
    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions);
    mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, normals);
    mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, uvs);
    mesh.insert_indices(Indices::U32(indices));

    mesh
}
