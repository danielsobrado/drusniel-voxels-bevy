//! Spawn wiring for the CLOD shadow runtime bridge.
//!
//! This module connects the loaded `ClodShadowRuntimeSnapshot` to Bevy terrain
//! entities.  For each page in the snapshot plan it either:
//! - keeps the visual mesh as a shadow caster,
//! - spawns a proxy shadow mesh entity, or
//! - adds `NotShadowCaster` to suppress shadow casting.

use bevy::prelude::*;
use std::collections::BTreeMap;

use super::clod_shadow_runtime::{
    ClodShadowRuntimeMeshPayload, ClodShadowRuntimePlanEntry, ClodShadowRuntimeSnapshot,
};

/// Active snapshot resource consumed by the spawn wiring system.
#[derive(Resource, Debug, Clone)]
pub struct ActiveClodShadowRuntimeSnapshot {
    pub generation: u64,
    pub snapshot: ClodShadowRuntimeSnapshot,
    pub plans_by_node: BTreeMap<String, ClodShadowRuntimePlanEntry>,
    pub proxy_meshes_by_id: BTreeMap<String, ClodShadowRuntimeMeshPayload>,
}

impl ActiveClodShadowRuntimeSnapshot {
    pub fn new(
        generation: u64,
        snapshot: ClodShadowRuntimeSnapshot,
    ) -> Result<Self, String> {
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

pub struct ClodShadowSpawnPlugin;

impl Plugin for ClodShadowSpawnPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<ClodShadowRuntimeSpawnStats>();
    }
}
