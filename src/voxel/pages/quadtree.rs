//! Quadtree build orchestration (§3.2 / §11.6). Ported from clod-rs.
//! LOD0 nodes come from welded chunk exports (`source_mesh`); LODk = merge 2x2 children →
//! weld old internal page borders → lock new outer border → simplify → accumulate error.
//! Lower LODs are NEVER re-extracted from voxels (I2).

use super::config::ClodPagesConfig;
use super::diagonal_polish::{DiagonalPolishStats, polish_diagonals};
use super::lock::build_outer_border_locks;
use super::simplify::simplify_page;
use super::source_mesh::{PageSource, concat};
use super::types::{ClodBuildError, PageFootprint, PageMesh};
use super::validate::{assert_no_internal_borders, strip_degenerate_triangles};
use super::weld::weld_vertices;
use std::collections::HashMap;
use std::thread;

pub struct ClodPageNode {
    pub level: usize,
    pub coord: (i32, i32),
    pub footprint: PageFootprint,
    pub mesh: PageMesh,
    pub error_world: f32,
    pub low_benefit: bool,
    pub polish: DiagonalPolishStats,
}

pub struct BuildResult {
    pub nodes_by_level: Vec<Vec<ClodPageNode>>,
    pub polish: DiagonalPolishStats,
}

fn union(a: PageFootprint, b: PageFootprint) -> PageFootprint {
    PageFootprint {
        min_x: a.min_x.min(b.min_x),
        min_z: a.min_z.min(b.min_z),
        max_x: a.max_x.max(b.max_x),
        max_z: a.max_z.max(b.max_z),
    }
}

fn build_parent_node(
    level: usize,
    coord: (i32, i32),
    child_ids: &[usize],
    previous_level: &[ClodPageNode],
    cfg: &ClodPagesConfig,
    weld_epsilon: f32,
) -> Result<ClodPageNode, ClodBuildError> {
    let children: Vec<&ClodPageNode> = child_ids.iter().map(|&i| &previous_level[i]).collect();
    let merged = concat(&children.iter().map(|c| c.mesh.clone()).collect::<Vec<_>>());
    let (welded, _) = weld_vertices(&merged, weld_epsilon)?;
    let footprint = children
        .iter()
        .skip(1)
        .fold(children[0].footprint, |acc, c| union(acc, c.footprint));
    let (mut mesh, simplify_error, low_benefit) = if welded.indices.is_empty() {
        (welded, 0.0, false)
    } else {
        let locks = build_outer_border_locks(&welded);
        let sim = simplify_page(&welded, &locks, cfg);
        (sim.mesh, sim.error_world, sim.low_benefit)
    };
    strip_degenerate_triangles(&mut mesh);
    let polish_locks = build_outer_border_locks(&mesh);
    let polish = polish_diagonals(&mut mesh, &polish_locks, &cfg.polish.diagonal_flip);
    assert_no_internal_borders(&mesh, &footprint)?;
    let max_child = children
        .iter()
        .map(|c| c.error_world)
        .fold(0.0f32, f32::max);
    Ok(ClodPageNode {
        level,
        coord,
        footprint,
        mesh,
        error_world: simplify_error + max_child,
        low_benefit,
        polish,
    })
}

fn build_parent_level(
    level: usize,
    groups: Vec<((i32, i32), Vec<usize>)>,
    previous_level: &[ClodPageNode],
    cfg: &ClodPagesConfig,
    weld_epsilon: f32,
) -> Result<Vec<ClodPageNode>, ClodBuildError> {
    if groups.len() <= 1 {
        return groups
            .into_iter()
            .map(|(coord, child_ids)| {
                build_parent_node(level, coord, &child_ids, previous_level, cfg, weld_epsilon)
            })
            .collect();
    }

    let worker_count = thread::available_parallelism()
        .map(usize::from)
        .unwrap_or(1)
        .min(groups.len());
    let chunk_size = groups.len().div_ceil(worker_count);
    thread::scope(|scope| {
        let mut handles = Vec::new();
        for chunk in groups.chunks(chunk_size) {
            handles.push(scope.spawn(move || {
                chunk
                    .iter()
                    .map(|(coord, child_ids)| {
                        build_parent_node(
                            level,
                            *coord,
                            child_ids,
                            previous_level,
                            cfg,
                            weld_epsilon,
                        )
                    })
                    .collect::<Result<Vec<_>, _>>()
            }));
        }

        let mut nodes = Vec::new();
        for handle in handles {
            nodes.extend(handle.join().expect("CLOD parent worker panicked")?);
        }
        Ok(nodes)
    })
}

/// Build the page quadtree from a layer of LOD0 page sources keyed by page coord.
pub fn build_quadtree(
    lod0: Vec<((i32, i32), PageSource)>,
    cfg: &ClodPagesConfig,
) -> Result<BuildResult, ClodBuildError> {
    let eps = cfg.simplify.weld_epsilon_cells;
    let mut nodes_by_level: Vec<Vec<ClodPageNode>> = Vec::new();
    let mut index: Vec<HashMap<(i32, i32), usize>> = Vec::new();

    // ---- LOD0 ----
    let mut level0: Vec<ClodPageNode> = Vec::new();
    let mut idx0: HashMap<(i32, i32), usize> = HashMap::new();
    for (coord, src) in lod0 {
        let mut mesh = src.mesh;
        strip_degenerate_triangles(&mut mesh);
        assert_no_internal_borders(&mesh, &src.footprint)?;
        idx0.insert(coord, level0.len());
        level0.push(ClodPageNode {
            level: 0,
            coord,
            footprint: src.footprint,
            mesh,
            error_world: 0.0,
            low_benefit: false,
            polish: DiagonalPolishStats::default(),
        });
    }
    nodes_by_level.push(level0);
    index.push(idx0);

    // ---- LOD1+ ----
    for level in 1..cfg.page.quadtree_levels {
        // group previous-level nodes by parent coord
        let mut groups: HashMap<(i32, i32), Vec<usize>> = HashMap::new();
        for (i, n) in nodes_by_level[level - 1].iter().enumerate() {
            let pc = (n.coord.0.div_euclid(2), n.coord.1.div_euclid(2));
            groups.entry(pc).or_default().push(i);
        }

        let mut level_index: HashMap<(i32, i32), usize> = HashMap::new();
        let group_items = groups.into_iter().collect::<Vec<_>>();
        let level_nodes =
            build_parent_level(level, group_items, &nodes_by_level[level - 1], cfg, eps)?;
        for (i, node) in level_nodes.iter().enumerate() {
            level_index.insert(node.coord, i);
        }

        let done = level_nodes.len() <= 1;
        nodes_by_level.push(level_nodes);
        index.push(level_index);
        if done {
            break;
        }
    }

    let mut polish = DiagonalPolishStats::default();
    for node in nodes_by_level.iter().flatten() {
        polish.add_assign(&node.polish);
    }

    Ok(BuildResult {
        nodes_by_level,
        polish,
    })
}
