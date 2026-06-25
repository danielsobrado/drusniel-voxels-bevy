//! LOD0 page source — welded chunk main-surface exports, never re-extracted (§11.2 / I2).

use super::config::ClodPagesConfig;
use super::export::TerrainMainSurfaceExport;
use super::types::{BorderTolerances, ClodBuildError, PageFootprint, PageMesh};
use super::weld::{WeldReport, weld_vertices};
use crate::voxel::chunk::LodLevel;

pub struct PageSource {
    pub mesh: PageMesh,
    pub footprint: PageFootprint,
    pub weld: WeldReport,
}

/// Concatenate several PageMeshes into one buffer (no welding yet).
pub fn concat(meshes: &[PageMesh]) -> PageMesh {
    let mut out = PageMesh::default();
    out.material_weight_stride = meshes
        .first()
        .map(|m| m.material_weight_stride())
        .unwrap_or(4);
    for m in meshes {
        let v_off = out.positions.len() as u32;
        out.positions.extend_from_slice(&m.positions);
        out.normals.extend_from_slice(&m.normals);
        out.materials.extend_from_slice(&m.materials);
        out.paint_slots
            .extend(m.paint_slots.iter().copied());
        out.indices.extend(m.indices.iter().map(|&i| i + v_off));
    }
    // ensure paint_slots matches vertex count
    out.ensure_paint_slots();
    out
}

/// Concatenate chunk exports into one world-space buffer (local + chunk world origin).
fn concat_exports(exports: &[TerrainMainSurfaceExport]) -> PageMesh {
    let mut out = PageMesh::default();
    out.material_weight_stride = 4;
    for e in exports {
        let o = e.world_origin();
        let v_off = out.positions.len() as u32;
        for p in &e.local_positions {
            out.positions.push([p[0] + o.x, p[1] + o.y, p[2] + o.z]);
        }
        out.normals.extend_from_slice(&e.normals);
        out.materials.extend_from_slice(&e.material_weights);
        out.paint_slots.extend_from_slice(&e.paint_slots);
        out.indices.extend(e.indices.iter().map(|&i| i + v_off));
    }
    // ensure paint_slots matches vertex count
    out.ensure_paint_slots();
    out
}

/// Build a LOD0 page source by welding its chunk main-surface exports.
pub fn build_lod0_page_source(
    exports: &[TerrainMainSurfaceExport],
    footprint: PageFootprint,
    cfg: &ClodPagesConfig,
) -> Result<PageSource, ClodBuildError> {
    if exports.is_empty() {
        return Err(ClodBuildError::PageIncomplete {
            message: "no chunk exports for page".into(),
        });
    }
    for e in exports {
        if !matches!(e.lod, LodLevel::Lod0) {
            return Err(ClodBuildError::PageIncomplete {
                message: format!("page input must be LOD0, got {:?} at {:?}", e.lod, e.chunk_pos),
            });
        }
    }
    let merged = concat_exports(exports);
    let val = cfg.validation();
    let tolerances = BorderTolerances {
        position: cfg.simplify.weld_epsilon_cells,
        normal_dot: val.normal_dot_min,
        material: val.material_weight_epsilon,
    };
    let (mesh, weld) =
        weld_vertices(&merged, cfg.simplify.weld_epsilon_cells, tolerances)?;
    Ok(PageSource {
        mesh,
        footprint,
        weld,
    })
}
