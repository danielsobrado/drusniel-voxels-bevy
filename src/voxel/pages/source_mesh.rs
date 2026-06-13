//! LOD0 page source — welded chunk main-surface exports, never re-extracted (§11.2 / I2).

use super::config::ClodPagesConfig;
use super::export::TerrainMainSurfaceExport;
use super::types::{ClodBuildError, PageFootprint, PageMesh};
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
    for m in meshes {
        let v_off = out.positions.len() as u32;
        out.positions.extend_from_slice(&m.positions);
        out.normals.extend_from_slice(&m.normals);
        out.materials.extend_from_slice(&m.materials);
        out.indices.extend(m.indices.iter().map(|&i| i + v_off));
    }
    out
}

/// Concatenate chunk exports into one world-space buffer (local + chunk world origin).
fn concat_exports(exports: &[TerrainMainSurfaceExport]) -> PageMesh {
    let mut out = PageMesh::default();
    for e in exports {
        let o = e.world_origin();
        let v_off = out.positions.len() as u32;
        for p in &e.local_positions {
            out.positions.push([p[0] + o.x, p[1] + o.y, p[2] + o.z]);
        }
        out.normals.extend_from_slice(&e.normals);
        out.materials.extend_from_slice(&e.material_weights);
        out.indices.extend(e.indices.iter().map(|&i| i + v_off));
    }
    out
}

/// Build a LOD0 page source by welding its chunk main-surface exports. Borders weld
/// watertight by construction because the engine's same-resolution chunk borders already
/// share vertices (plan §3.1). `footprint` is the page's world-space bounds.
pub fn build_lod0_page_source(
    exports: &[TerrainMainSurfaceExport],
    footprint: PageFootprint,
    cfg: &ClodPagesConfig,
) -> Result<PageSource, ClodBuildError> {
    if exports.is_empty() {
        return Err(ClodBuildError::PageIncomplete(
            "no chunk exports for page".into(),
        ));
    }
    for e in exports {
        if !matches!(e.lod, LodLevel::Lod0) {
            return Err(ClodBuildError::PageIncomplete(format!(
                "page input must be LOD0, got {:?} at {:?}",
                e.lod, e.chunk_pos
            )));
        }
    }
    let merged = concat_exports(exports);
    let (mesh, weld) = weld_vertices(&merged, cfg.simplify.weld_epsilon_cells)?;
    Ok(PageSource {
        mesh,
        footprint,
        weld,
    })
}
