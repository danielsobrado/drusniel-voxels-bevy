//! Quadtree build orchestration (§3.2 / §11.6). Port of quadtree.ts.
//! LOD0 = welded chunks (error 0); LODk = merge 2x2 -> weld -> lock -> simplify -> accumulate.

use crate::config::ClodPagesConfig;
use crate::lock::{build_outer_border_locks, count_locks};
use crate::simplify::simplify_page;
use crate::source_mesh::{build_lod0_page_source, concat};
use crate::terrain::WorldBounds;
use crate::types::{ClodBuildError, PageFootprint, PageMesh};
use crate::validate::{assert_no_internal_borders, strip_degenerate_triangles};
use crate::weld::weld_vertices;
use std::collections::HashMap;
use std::time::Instant;

pub struct ClodPageNode {
    pub id: String,
    pub level: usize,
    pub footprint: PageFootprint,
    pub mesh: PageMesh,
    pub error_world: f32,
    pub low_benefit: bool,
}

pub struct NodeBuildStat {
    pub id: String,
    pub level: usize,
    pub input_tris: usize,
    pub output_tris: usize,
    pub locked_verts: usize,
    pub error_world: f32,
    pub low_benefit: bool,
    pub build_ms: f64,
}

pub struct BuildResult {
    pub nodes_by_level: Vec<Vec<ClodPageNode>>,
    pub stats: Vec<NodeBuildStat>,
}

fn footprint_for(level: usize, nx: i32, nz: i32, cfg: &ClodPagesConfig) -> PageFootprint {
    let span = ((1 << level) * cfg.page.chunks_per_page * cfg.page.chunk_size) as f32;
    PageFootprint {
        min_x: nx as f32 * span,
        min_z: nz as f32 * span,
        max_x: (nx + 1) as f32 * span,
        max_z: (nz + 1) as f32 * span,
    }
}

pub fn build_world(
    world_pages_x: i32,
    world_pages_z: i32,
    cfg: &ClodPagesConfig,
) -> Result<BuildResult, ClodBuildError> {
    let eps = cfg.simplify.weld_epsilon_cells;
    let world = WorldBounds {
        cells_x: world_pages_x * cfg.page.chunks_per_page as i32 * cfg.page.chunk_size as i32,
        cells_z: world_pages_z * cfg.page.chunks_per_page as i32 * cfg.page.chunk_size as i32,
    };
    let mut nodes_by_level: Vec<Vec<ClodPageNode>> = Vec::new();
    let mut stats: Vec<NodeBuildStat> = Vec::new();
    let mut index: Vec<HashMap<(i32, i32), usize>> = Vec::new();

    // ---- LOD0 ----
    let mut lod0: Vec<ClodPageNode> = Vec::new();
    let mut lod0_index: HashMap<(i32, i32), usize> = HashMap::new();
    for pz in 0..world_pages_z {
        for px in 0..world_pages_x {
            let t0 = Instant::now();
            let src = build_lod0_page_source(px, pz, cfg, world)?;
            let mut mesh = src.mesh;
            strip_degenerate_triangles(&mut mesh);
            assert_no_internal_borders(&mesh, &src.footprint)?;
            let tris = mesh.triangle_count();
            lod0_index.insert((px, pz), lod0.len());
            lod0.push(ClodPageNode {
                id: format!("L0:{px},{pz}"),
                level: 0,
                footprint: src.footprint,
                mesh,
                error_world: 0.0,
                low_benefit: false,
            });
            stats.push(NodeBuildStat {
                id: format!("L0:{px},{pz}"),
                level: 0,
                input_tris: tris,
                output_tris: tris,
                locked_verts: 0,
                error_world: 0.0,
                low_benefit: false,
                build_ms: t0.elapsed().as_secs_f64() * 1000.0,
            });
        }
    }
    nodes_by_level.push(lod0);
    index.push(lod0_index);

    // ---- LOD1+ ----
    let (mut prev_x, mut prev_z) = (world_pages_x, world_pages_z);
    for level in 1..cfg.page.quadtree_levels {
        let count_x = (prev_x + 1) / 2;
        let count_z = (prev_z + 1) / 2;
        let mut level_nodes: Vec<ClodPageNode> = Vec::new();
        let mut level_index: HashMap<(i32, i32), usize> = HashMap::new();

        for nz in 0..count_z {
            for nx in 0..count_x {
                let t0 = Instant::now();
                let mut child_meshes: Vec<PageMesh> = Vec::new();
                let mut child_errors: Vec<f32> = Vec::new();
                for dz in 0..2 {
                    for dx in 0..2 {
                        if let Some(&ci) = index[level - 1].get(&(nx * 2 + dx, nz * 2 + dz)) {
                            let c = &nodes_by_level[level - 1][ci];
                            child_meshes.push(c.mesh.clone());
                            child_errors.push(c.error_world);
                        }
                    }
                }
                if child_meshes.is_empty() {
                    continue;
                }

                let merged = concat(&child_meshes);
                let (welded, _) = weld_vertices(&merged, eps)?;
                let footprint = footprint_for(level, nx, nz, cfg);
                let locks = build_outer_border_locks(&welded);
                let input_tris = welded.triangle_count();
                let sim = simplify_page(&welded, &locks, cfg);
                let mut mesh = sim.mesh;
                strip_degenerate_triangles(&mut mesh);
                assert_no_internal_borders(&mesh, &footprint)?;

                let max_child = child_errors.iter().cloned().fold(0.0f32, f32::max);
                let error_world = sim.error_world + max_child;
                let id = format!("L{level}:{nx},{nz}");
                let output_tris = mesh.triangle_count();
                level_index.insert((nx, nz), level_nodes.len());
                level_nodes.push(ClodPageNode {
                    id: id.clone(),
                    level,
                    footprint,
                    mesh,
                    error_world,
                    low_benefit: sim.low_benefit,
                });
                stats.push(NodeBuildStat {
                    id,
                    level,
                    input_tris,
                    output_tris,
                    locked_verts: count_locks(&locks),
                    error_world,
                    low_benefit: sim.low_benefit,
                    build_ms: t0.elapsed().as_secs_f64() * 1000.0,
                });
            }
        }

        nodes_by_level.push(level_nodes);
        index.push(level_index);
        prev_x = count_x;
        prev_z = count_z;
        if count_x == 1 && count_z == 1 {
            break;
        }
    }

    Ok(BuildResult { nodes_by_level, stats })
}
