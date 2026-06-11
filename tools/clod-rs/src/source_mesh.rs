//! LOD0 page source — welded chunk meshes, never re-extracted (§11.2 / invariant I2).

use crate::config::ClodPagesConfig;
use crate::terrain::{mesh_chunk, WorldBounds};
use crate::types::{ClodBuildError, PageFootprint, PageMesh};
use crate::weld::{weld_vertices, WeldReport};

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

/// Build a LOD0 page source from its PxP chunks (page coords).
pub fn build_lod0_page_source(
    page_x: i32,
    page_z: i32,
    cfg: &ClodPagesConfig,
    world: WorldBounds,
) -> Result<PageSource, ClodBuildError> {
    let p = cfg.page.chunks_per_page as i32;
    let s = cfg.page.chunk_size as i32;

    let mut chunks: Vec<PageMesh> = Vec::with_capacity((p * p) as usize);
    for dz in 0..p {
        for dx in 0..p {
            chunks.push(mesh_chunk(page_x * p + dx, page_z * p + dz, cfg, world));
        }
    }
    if chunks.len() != (p * p) as usize {
        return Err(ClodBuildError::PageIncomplete(format!(
            "expected {} chunks, got {}",
            p * p,
            chunks.len()
        )));
    }

    let merged = concat(&chunks);
    let (mesh, weld) = weld_vertices(&merged, cfg.simplify.weld_epsilon_cells)?;
    let footprint = PageFootprint {
        min_x: (page_x * p * s) as f32,
        min_z: (page_z * p * s) as f32,
        max_x: ((page_x + 1) * p * s) as f32,
        max_z: ((page_z + 1) * p * s) as f32,
    };
    Ok(PageSource { mesh, footprint, weld })
}
