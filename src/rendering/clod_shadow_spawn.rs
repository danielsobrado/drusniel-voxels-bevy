//! Spawn wiring for the CLOD shadow runtime bridge.
//!
//! This module connects the loaded `ClodShadowRuntimeSnapshot` to Bevy terrain
//! entities.  For each page in the snapshot plan it either:
//! - keeps the visual mesh as a shadow caster,
//! - spawns a proxy shadow mesh entity, or
//! - adds `NotShadowCaster` to suppress shadow casting.

use bevy::asset::RenderAssetUsages;
use bevy::camera::visibility::RenderLayers;
use bevy::light::NotShadowCaster;
use bevy::prelude::*;
use bevy_mesh::{Indices, PrimitiveTopology};
use std::collections::{BTreeMap, HashMap};

use super::clod_shadow_config::ClodShadowRuntimeSettings;
use super::clod_shadow_runtime::{
    ClodShadowRuntimeAction, ClodShadowRuntimeMeshPayload, ClodShadowRuntimePlanEntry,
    ClodShadowRuntimeSnapshot,
};

/// Render layer used for proxy entities that should cast shadows but not render in the main view.
pub const CLOD_SHADOW_PROXY_RENDER_LAYER: usize = 31;
const DEFAULT_VISUAL_MESH_PREFIX: &str = "visual:";

/// Stable visual mesh identifier matching the clod-poc runtime snapshot exporter.
pub fn clod_visual_mesh_id(level: usize, coord: (i32, i32)) -> String {
    format!("{DEFAULT_VISUAL_MESH_PREFIX}L{level}:{},{}", coord.0, coord.1)
}

/// Tag applied to visual CLOD terrain page entities so snapshot plans can resolve them.
#[derive(Component, Debug, Clone, PartialEq, Eq, Hash)]
pub struct ClodTerrainVisualMeshId(pub String);

/// Marker for `NotShadowCaster` ownership by the CLOD shadow runtime.
#[derive(Component, Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClodShadowRuntimeManagedNoCaster;

/// Marker for visual-caster ownership by the CLOD shadow runtime.
#[derive(Component, Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClodShadowRuntimeManagedVisualCaster;

/// Shadow-only proxy caster spawned from a runtime snapshot.
#[derive(Component, Debug, Clone)]
pub struct ClodShadowProxyCaster {
    pub generation: u64,
    pub node_id: String,
    pub shadow_mesh_id: String,
    mesh_handle: Handle<Mesh>,
    material_handle: Handle<StandardMaterial>,
}

/// Active snapshot resource consumed by the spawn wiring system.
#[derive(Resource, Debug, Clone)]
pub struct ActiveClodShadowRuntimeSnapshot {
    pub generation: u64,
    pub snapshot: ClodShadowRuntimeSnapshot,
    pub plans_by_node: BTreeMap<String, ClodShadowRuntimePlanEntry>,
    pub proxy_meshes_by_id: BTreeMap<String, ClodShadowRuntimeMeshPayload>,
}

impl ActiveClodShadowRuntimeSnapshot {
    pub fn new(generation: u64, snapshot: ClodShadowRuntimeSnapshot) -> Result<Self, String> {
        let plans_by_node: BTreeMap<String, ClodShadowRuntimePlanEntry> = snapshot
            .plans
            .iter()
            .map(|plan| (plan.node_id.clone(), plan.clone()))
            .collect();
        let proxy_meshes_by_id: BTreeMap<String, ClodShadowRuntimeMeshPayload> = snapshot
            .proxy_meshes
            .iter()
            .map(|mesh| (mesh.shadow_mesh_id.clone(), mesh.clone()))
            .collect();

        Ok(Self {
            generation,
            snapshot,
            plans_by_node,
            proxy_meshes_by_id,
        })
    }

    pub fn plan_for_node(&self, node_id: &str) -> Option<&ClodShadowRuntimePlanEntry> {
        self.plans_by_node.get(node_id)
    }

    pub fn proxy_mesh_for_shadow_id(
        &self,
        shadow_mesh_id: &str,
    ) -> Option<&ClodShadowRuntimeMeshPayload> {
        self.proxy_meshes_by_id.get(shadow_mesh_id)
    }
}

/// Debug stats for the spawn wiring pass.
#[derive(Resource, Debug, Clone, PartialEq, Default)]
pub struct ClodShadowRuntimeSpawnStats {
    pub generation: u64,
    pub visual_caster_pages: u32,
    pub proxy_caster_pages: u32,
    pub no_cast_pages: u32,
    pub missing_visual_entities: u32,
    pub missing_proxy_meshes: u32,
    pub spawned_proxy_entities: u32,
    pub visual_triangles: u32,
    pub runtime_shadow_triangles: u32,
    pub saved_triangles: u32,
}

#[derive(Default)]
struct ClodShadowApplyState {
    generation: Option<u64>,
    visual_count: usize,
}

pub struct ClodShadowSpawnPlugin;

impl Plugin for ClodShadowSpawnPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<ClodShadowRuntimeSpawnStats>()
            .add_systems(
                Update,
                (
                    tag_clod_page_visual_meshes,
                    configure_clod_shadow_light_layers,
                    apply_clod_shadow_runtime_snapshot.after(tag_clod_page_visual_meshes),
                ),
            );
    }
}

pub fn tag_clod_page_visual_meshes(
    mut commands: Commands,
    pages: Query<(Entity, &crate::voxel::pages::ClodPageMeshTag), Without<ClodTerrainVisualMeshId>>,
) {
    for (entity, tag) in pages.iter() {
        commands
            .entity(entity)
            .insert(ClodTerrainVisualMeshId(clod_visual_mesh_id(tag.level, tag.coord)));
    }
}

pub fn configure_clod_shadow_light_layers(
    settings: Option<Res<ClodShadowRuntimeSettings>>,
    mut commands: Commands,
    directional_lights: Query<(Entity, Option<&RenderLayers>), With<DirectionalLight>>,
    point_lights: Query<(Entity, Option<&RenderLayers>), With<PointLight>>,
) {
    if settings
        .as_deref()
        .is_some_and(|settings| !settings.should_configure_light_layers())
    {
        return;
    }

    for (entity, layers) in directional_lights.iter() {
        if layers.is_none() {
            commands.entity(entity).insert(clod_shadow_light_layers());
        }
    }
    for (entity, layers) in point_lights.iter() {
        if layers.is_none() {
            commands.entity(entity).insert(clod_shadow_light_layers());
        }
    }
}

pub fn apply_clod_shadow_runtime_snapshot(
    mut commands: Commands,
    active: Option<Res<ActiveClodShadowRuntimeSnapshot>>,
    settings: Option<Res<ClodShadowRuntimeSettings>>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    visuals: Query<(
        Entity,
        &ClodTerrainVisualMeshId,
        &GlobalTransform,
        Option<&NotShadowCaster>,
        Option<&ClodShadowRuntimeManagedNoCaster>,
        Option<&ClodShadowRuntimeManagedVisualCaster>,
    )>,
    proxies: Query<(Entity, &ClodShadowProxyCaster)>,
    mut stats: ResMut<ClodShadowRuntimeSpawnStats>,
    mut apply_state: Local<ClodShadowApplyState>,
) {
    let visual_count = visuals.iter().count();
    let Some(active) = active else {
        if apply_state.generation.take().is_some() || !proxies.is_empty() {
            cleanup_runtime_entities(&mut commands, &mut meshes, &mut materials, &visuals, &proxies);
            *stats = ClodShadowRuntimeSpawnStats::default();
        }
        apply_state.visual_count = visual_count;
        return;
    };

    if apply_state.generation == Some(active.generation) && apply_state.visual_count == visual_count {
        return;
    }

    cleanup_proxies(&mut commands, &mut meshes, &mut materials, &proxies);
    let runtime_settings = settings.as_deref().cloned().unwrap_or_default();
    let visuals_by_id: HashMap<&str, (Entity, &GlobalTransform, bool, bool, bool)> = visuals
        .iter()
        .map(|(entity, id, transform, no_shadow, owned_no_shadow, owned_visual)| {
            (
                id.0.as_str(),
                (
                    entity,
                    transform,
                    no_shadow.is_some(),
                    owned_no_shadow.is_some(),
                    owned_visual.is_some(),
                ),
            )
        })
        .collect();

    let mut next_stats = ClodShadowRuntimeSpawnStats {
        generation: active.generation,
        ..Default::default()
    };

    for plan in &active.snapshot.plans {
        let Some(action) = runtime_settings.effective_action(plan.action) else {
            continue;
        };
        next_stats.visual_triangles = next_stats.visual_triangles.saturating_add(plan.visual_triangles);
        next_stats.runtime_shadow_triangles = next_stats
            .runtime_shadow_triangles
            .saturating_add(runtime_shadow_triangles_for_action(plan, action));

        let Some((visual_entity, visual_transform, has_no_shadow, owned_no_shadow, _owned_visual)) =
            visuals_by_id.get(plan.visual_mesh_id.as_str()).copied()
        else {
            next_stats.missing_visual_entities =
                next_stats.missing_visual_entities.saturating_add(1);
            continue;
        };

        match action {
            ClodShadowRuntimeAction::UseVisualMeshCaster => {
                next_stats.visual_caster_pages = next_stats.visual_caster_pages.saturating_add(1);
                let mut entity = commands.entity(visual_entity);
                if has_no_shadow {
                    entity
                        .remove::<NotShadowCaster>()
                        .insert(ClodShadowRuntimeManagedVisualCaster);
                }
                if owned_no_shadow {
                    entity.remove::<ClodShadowRuntimeManagedNoCaster>();
                }
            }
            ClodShadowRuntimeAction::ApplyNotShadowCaster => {
                next_stats.no_cast_pages = next_stats.no_cast_pages.saturating_add(1);
                commands
                    .entity(visual_entity)
                    .insert((NotShadowCaster, ClodShadowRuntimeManagedNoCaster))
                    .remove::<ClodShadowRuntimeManagedVisualCaster>();
            }
            ClodShadowRuntimeAction::SpawnProxyShadowCaster => {
                next_stats.proxy_caster_pages = next_stats.proxy_caster_pages.saturating_add(1);
                commands
                    .entity(visual_entity)
                    .insert((NotShadowCaster, ClodShadowRuntimeManagedNoCaster))
                    .remove::<ClodShadowRuntimeManagedVisualCaster>();

                let Some(shadow_mesh_id) = plan.shadow_mesh_id.as_deref() else {
                    next_stats.missing_proxy_meshes =
                        next_stats.missing_proxy_meshes.saturating_add(1);
                    continue;
                };
                let Some(proxy_payload) = active.proxy_mesh_for_shadow_id(shadow_mesh_id) else {
                    next_stats.missing_proxy_meshes =
                        next_stats.missing_proxy_meshes.saturating_add(1);
                    continue;
                };
                spawn_proxy_caster(
                    &mut commands,
                    &mut meshes,
                    &mut materials,
                    active.generation,
                    plan,
                    proxy_payload,
                    visual_transform,
                );
                next_stats.spawned_proxy_entities =
                    next_stats.spawned_proxy_entities.saturating_add(1);
            }
        }
    }

    next_stats.saved_triangles = next_stats
        .visual_triangles
        .saturating_sub(next_stats.runtime_shadow_triangles);
    *stats = next_stats;
    apply_state.generation = Some(active.generation);
    apply_state.visual_count = visual_count;
}

fn runtime_shadow_triangles_for_action(
    plan: &ClodShadowRuntimePlanEntry,
    action: ClodShadowRuntimeAction,
) -> u32 {
    match action {
        ClodShadowRuntimeAction::UseVisualMeshCaster => plan.visual_triangles,
        ClodShadowRuntimeAction::SpawnProxyShadowCaster => plan.shadow_triangles,
        ClodShadowRuntimeAction::ApplyNotShadowCaster => 0,
    }
}

fn cleanup_runtime_entities(
    commands: &mut Commands,
    meshes: &mut Assets<Mesh>,
    materials: &mut Assets<StandardMaterial>,
    visuals: &Query<(
        Entity,
        &ClodTerrainVisualMeshId,
        &GlobalTransform,
        Option<&NotShadowCaster>,
        Option<&ClodShadowRuntimeManagedNoCaster>,
        Option<&ClodShadowRuntimeManagedVisualCaster>,
    )>,
    proxies: &Query<(Entity, &ClodShadowProxyCaster)>,
) {
    cleanup_proxies(commands, meshes, materials, proxies);
    for (entity, _id, _transform, _no_shadow, owned_no_shadow, owned_visual) in visuals.iter() {
        let mut entity_commands = commands.entity(entity);
        if owned_visual.is_some() {
            entity_commands
                .insert(NotShadowCaster)
                .remove::<ClodShadowRuntimeManagedVisualCaster>();
        }
        if owned_no_shadow.is_some() {
            entity_commands.remove::<ClodShadowRuntimeManagedNoCaster>();
        }
    }
}

fn cleanup_proxies(
    commands: &mut Commands,
    meshes: &mut Assets<Mesh>,
    materials: &mut Assets<StandardMaterial>,
    proxies: &Query<(Entity, &ClodShadowProxyCaster)>,
) {
    for (entity, proxy) in proxies.iter() {
        commands.entity(entity).despawn();
        meshes.remove(proxy.mesh_handle.id());
        materials.remove(proxy.material_handle.id());
    }
}

fn spawn_proxy_caster(
    commands: &mut Commands,
    meshes: &mut Assets<Mesh>,
    materials: &mut Assets<StandardMaterial>,
    generation: u64,
    plan: &ClodShadowRuntimePlanEntry,
    proxy_payload: &ClodShadowRuntimeMeshPayload,
    visual_transform: &GlobalTransform,
) {
    let mesh_handle = meshes.add(proxy_payload_to_mesh(proxy_payload));
    let material_handle = materials.add(StandardMaterial {
        base_color: Color::srgba(0.0, 0.0, 0.0, 0.0),
        unlit: true,
        ..Default::default()
    });
    commands.spawn((
        Mesh3d(mesh_handle.clone()),
        MeshMaterial3d::<StandardMaterial>(material_handle.clone()),
        visual_transform.compute_transform(),
        clod_shadow_proxy_layers(),
        Visibility::Visible,
        ClodShadowProxyCaster {
            generation,
            node_id: plan.node_id.clone(),
            shadow_mesh_id: proxy_payload.shadow_mesh_id.clone(),
            mesh_handle,
            material_handle,
        },
    ));
}

fn proxy_payload_to_mesh(payload: &ClodShadowRuntimeMeshPayload) -> Mesh {
    let positions: Vec<[f32; 3]> = payload
        .positions
        .chunks_exact(3)
        .map(|chunk| [chunk[0], chunk[1], chunk[2]])
        .collect();
    let mut mesh = Mesh::new(
        PrimitiveTopology::TriangleList,
        RenderAssetUsages::RENDER_WORLD,
    );
    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions.clone());
    mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, vec![[0.0, 1.0, 0.0]; positions.len()]);
    mesh.insert_indices(Indices::U32(payload.indices.clone()));
    mesh
}

fn clod_shadow_proxy_layers() -> RenderLayers {
    RenderLayers::layer(CLOD_SHADOW_PROXY_RENDER_LAYER)
}

fn clod_shadow_light_layers() -> RenderLayers {
    RenderLayers::from_layers(&[0, CLOD_SHADOW_PROXY_RENDER_LAYER])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn visual_mesh_ids_match_clod_poc_exporter_shape() {
        assert_eq!(clod_visual_mesh_id(2, (3, -4)), "visual:L2:3,-4");
    }

    #[test]
    fn proxy_payload_mesh_keeps_triangle_indices() {
        let payload = ClodShadowRuntimeMeshPayload {
            shadow_mesh_id: "shadow:L0:0,0".to_owned(),
            node_id: "L0:0,0".to_owned(),
            positions: vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0],
            indices: vec![0, 1, 2],
            bounds: crate::rendering::clod_shadow_runtime::ClodShadowMeshBounds {
                min: [0.0, 0.0, 0.0],
                max: [1.0, 1.0, 1.0],
            },
            source_triangle_count: 1,
            triangle_count: 1,
        };

        let mesh = proxy_payload_to_mesh(&payload);
        assert!(mesh.attribute(Mesh::ATTRIBUTE_POSITION).is_some());
        assert!(mesh.indices().is_some());
    }
}
