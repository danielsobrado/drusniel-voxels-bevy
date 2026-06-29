//! Runtime-side contract for CLOD shadow caster policy.
//!
//! The TypeScript `clod-poc` exporter writes the JSON shape represented here.
//! This module deliberately stays data-oriented: it converts a validated CLOD
//! shadow snapshot into deterministic runtime actions that the Bevy terrain
//! spawning path can apply.
//!
//! Mapping:
//! - `UseVisualMeshCaster` keeps the normal visual terrain mesh as a caster.
//! - `SpawnProxyShadowCaster` spawns a shadow-only proxy mesh entity.
//! - `ApplyNotShadowCaster` adds Bevy's `NotShadowCaster` to the visual entity.
//!
//! The actual spawn hook should live beside the terrain page/chunk spawning code,
//! where `visual_mesh_id` can be resolved to the existing entity and
//! `shadow_mesh_id` can be resolved to the generated proxy mesh asset.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClodShadowRuntimeAction {
    UseVisualMeshCaster,
    SpawnProxyShadowCaster,
    ApplyNotShadowCaster,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ClodShadowBounds {
    pub center: [f32; 3],
    pub radius: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ClodShadowMeshBounds {
    pub min: [f32; 3],
    pub max: [f32; 3],
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ClodShadowRuntimePlanEntry {
    #[serde(rename = "nodeId")]
    pub node_id: String,
    pub level: u32,
    pub action: ClodShadowRuntimeAction,
    #[serde(rename = "visualMeshId")]
    pub visual_mesh_id: String,
    #[serde(rename = "shadowMeshId")]
    pub shadow_mesh_id: Option<String>,
    pub reason: String,
    #[serde(rename = "visualTriangles")]
    pub visual_triangles: u32,
    #[serde(rename = "shadowTriangles")]
    pub shadow_triangles: u32,
    pub distance: Option<f32>,
    pub bounds: ClodShadowBounds,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ClodShadowRuntimeMeshPayload {
    #[serde(rename = "shadowMeshId")]
    pub shadow_mesh_id: String,
    #[serde(rename = "nodeId")]
    pub node_id: String,
    pub positions: Vec<f32>,
    pub indices: Vec<u32>,
    pub bounds: ClodShadowMeshBounds,
    #[serde(rename = "sourceTriangleCount")]
    pub source_triangle_count: u32,
    #[serde(rename = "triangleCount")]
    pub triangle_count: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Default)]
pub struct ClodShadowRuntimeTotals {
    #[serde(rename = "totalPages")]
    pub total_pages: u32,
    #[serde(rename = "visualCasterPages")]
    pub visual_caster_pages: u32,
    #[serde(rename = "proxyCasterPages")]
    pub proxy_caster_pages: u32,
    #[serde(rename = "noCastPages")]
    pub no_cast_pages: u32,
    #[serde(rename = "visualTriangles")]
    pub visual_triangles: u32,
    #[serde(rename = "runtimeShadowTriangles")]
    pub runtime_shadow_triangles: u32,
    #[serde(rename = "savedTriangles")]
    pub saved_triangles: u32,
    #[serde(rename = "savingsRatio")]
    pub savings_ratio: f32,
    #[serde(rename = "missingProxyMeshes")]
    pub missing_proxy_meshes: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ClodShadowRuntimeSnapshot {
    pub version: u32,
    #[serde(rename = "generatedBy")]
    pub generated_by: String,
    pub plans: Vec<ClodShadowRuntimePlanEntry>,
    #[serde(rename = "proxyMeshes")]
    pub proxy_meshes: Vec<ClodShadowRuntimeMeshPayload>,
    pub totals: ClodShadowRuntimeTotals,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClodShadowRuntimeError {
    UnsupportedVersion(u32),
    MissingProxyMesh {
        node_id: String,
        shadow_mesh_id: String,
    },
    UnexpectedProxyMesh {
        shadow_mesh_id: String,
    },
    ProxyMeshIndexNotTriangulated {
        shadow_mesh_id: String,
        index_count: usize,
    },
    ProxyMeshPositionNotVec3 {
        shadow_mesh_id: String,
        position_count: usize,
    },
}

pub fn validate_clod_shadow_runtime_snapshot(
    snapshot: &ClodShadowRuntimeSnapshot,
) -> Result<(), ClodShadowRuntimeError> {
    if snapshot.version != 1 {
        return Err(ClodShadowRuntimeError::UnsupportedVersion(snapshot.version));
    }

    let proxy_meshes: BTreeMap<&str, &ClodShadowRuntimeMeshPayload> = snapshot
        .proxy_meshes
        .iter()
        .map(|mesh| (mesh.shadow_mesh_id.as_str(), mesh))
        .collect();
    let mut required_proxy_meshes = BTreeSet::new();

    for plan in &snapshot.plans {
        if plan.action != ClodShadowRuntimeAction::SpawnProxyShadowCaster {
            continue;
        }
        let Some(shadow_mesh_id) = plan.shadow_mesh_id.as_deref() else {
            return Err(ClodShadowRuntimeError::MissingProxyMesh {
                node_id: plan.node_id.clone(),
                shadow_mesh_id: "<none>".to_owned(),
            });
        };
        required_proxy_meshes.insert(shadow_mesh_id);
        let Some(mesh) = proxy_meshes.get(shadow_mesh_id) else {
            return Err(ClodShadowRuntimeError::MissingProxyMesh {
                node_id: plan.node_id.clone(),
                shadow_mesh_id: shadow_mesh_id.to_owned(),
            });
        };
        if mesh.indices.len() % 3 != 0 {
            return Err(ClodShadowRuntimeError::ProxyMeshIndexNotTriangulated {
                shadow_mesh_id: shadow_mesh_id.to_owned(),
                index_count: mesh.indices.len(),
            });
        }
        if mesh.positions.len() % 3 != 0 {
            return Err(ClodShadowRuntimeError::ProxyMeshPositionNotVec3 {
                shadow_mesh_id: shadow_mesh_id.to_owned(),
                position_count: mesh.positions.len(),
            });
        }
    }

    for mesh in &snapshot.proxy_meshes {
        if !required_proxy_meshes.contains(mesh.shadow_mesh_id.as_str()) {
            return Err(ClodShadowRuntimeError::UnexpectedProxyMesh {
                shadow_mesh_id: mesh.shadow_mesh_id.clone(),
            });
        }
    }

    Ok(())
}

pub fn recompute_clod_shadow_runtime_totals(
    plans: &[ClodShadowRuntimePlanEntry],
) -> ClodShadowRuntimeTotals {
    let mut totals = ClodShadowRuntimeTotals {
        total_pages: plans.len() as u32,
        ..Default::default()
    };

    for plan in plans {
        totals.visual_triangles = totals
            .visual_triangles
            .saturating_add(plan.visual_triangles);
        totals.runtime_shadow_triangles = totals
            .runtime_shadow_triangles
            .saturating_add(plan.shadow_triangles);
        match plan.action {
            ClodShadowRuntimeAction::UseVisualMeshCaster => totals.visual_caster_pages += 1,
            ClodShadowRuntimeAction::SpawnProxyShadowCaster => totals.proxy_caster_pages += 1,
            ClodShadowRuntimeAction::ApplyNotShadowCaster => totals.no_cast_pages += 1,
        }
    }

    totals.saved_triangles = totals
        .visual_triangles
        .saturating_sub(totals.runtime_shadow_triangles);
    totals.savings_ratio = if totals.visual_triangles > 0 {
        totals.saved_triangles as f32 / totals.visual_triangles as f32
    } else {
        0.0
    };
    totals
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan(
        node_id: &str,
        action: ClodShadowRuntimeAction,
        visual_triangles: u32,
        shadow_triangles: u32,
    ) -> ClodShadowRuntimePlanEntry {
        ClodShadowRuntimePlanEntry {
            node_id: node_id.to_owned(),
            level: 0,
            action,
            visual_mesh_id: format!("visual:{node_id}"),
            shadow_mesh_id: (action == ClodShadowRuntimeAction::SpawnProxyShadowCaster)
                .then(|| format!("shadow:{node_id}")),
            reason: "budget".to_owned(),
            visual_triangles,
            shadow_triangles,
            distance: Some(64.0),
            bounds: ClodShadowBounds {
                center: [0.0, 0.0, 0.0],
                radius: 1.0,
            },
        }
    }

    fn mesh(node_id: &str) -> ClodShadowRuntimeMeshPayload {
        ClodShadowRuntimeMeshPayload {
            shadow_mesh_id: format!("shadow:{node_id}"),
            node_id: node_id.to_owned(),
            positions: vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0],
            indices: vec![0, 1, 2],
            bounds: ClodShadowMeshBounds {
                min: [0.0, 0.0, 0.0],
                max: [1.0, 1.0, 1.0],
            },
            source_triangle_count: 100,
            triangle_count: 1,
        }
    }

    #[test]
    fn validates_required_proxy_meshes() {
        let snapshot = ClodShadowRuntimeSnapshot {
            version: 1,
            generated_by: "clod-poc-bevy-shadow-runtime".to_owned(),
            plans: vec![plan(
                "L2:0,0",
                ClodShadowRuntimeAction::SpawnProxyShadowCaster,
                100,
                1,
            )],
            proxy_meshes: vec![mesh("L2:0,0")],
            totals: ClodShadowRuntimeTotals::default(),
        };
        assert_eq!(validate_clod_shadow_runtime_snapshot(&snapshot), Ok(()));
    }

    #[test]
    fn rejects_missing_proxy_meshes() {
        let snapshot = ClodShadowRuntimeSnapshot {
            version: 1,
            generated_by: "clod-poc-bevy-shadow-runtime".to_owned(),
            plans: vec![plan(
                "L2:0,0",
                ClodShadowRuntimeAction::SpawnProxyShadowCaster,
                100,
                1,
            )],
            proxy_meshes: vec![],
            totals: ClodShadowRuntimeTotals::default(),
        };
        assert!(matches!(
            validate_clod_shadow_runtime_snapshot(&snapshot),
            Err(ClodShadowRuntimeError::MissingProxyMesh { .. })
        ));
    }

    #[test]
    fn recomputes_triangle_savings() {
        let totals = recompute_clod_shadow_runtime_totals(&[
            plan("near", ClodShadowRuntimeAction::UseVisualMeshCaster, 40, 40),
            plan(
                "mid",
                ClodShadowRuntimeAction::SpawnProxyShadowCaster,
                100,
                25,
            ),
            plan("far", ClodShadowRuntimeAction::ApplyNotShadowCaster, 80, 0),
        ]);

        assert_eq!(totals.total_pages, 3);
        assert_eq!(totals.visual_caster_pages, 1);
        assert_eq!(totals.proxy_caster_pages, 1);
        assert_eq!(totals.no_cast_pages, 1);
        assert_eq!(totals.runtime_shadow_triangles, 65);
        assert_eq!(totals.saved_triangles, 155);
    }
}
