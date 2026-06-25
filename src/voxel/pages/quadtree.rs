//! Quadtree build orchestration (§3.2 / §11.6). Ported from clod-poc/quadtree.ts.
//! LOD0 nodes come from welded chunk exports (`source_mesh`); LODk = merge 2x2 children →
//! weld old internal page borders → lock new outer border → simplify → accumulate error.
//! Lower LODs are NEVER re-extracted from voxels (I2).

use super::config::ClodPagesConfig;
use super::diagonal_polish::{DiagonalPolishStats, polish_diagonals};
use super::lock::build_outer_border_locks;
use super::simplify::simplify_page;
use super::source_mesh::{PageSource, concat};
use super::types::{BorderTolerances, ClodBuildError, PageFootprint, PageMesh};
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

/// LOD0 page coord minimum used to infer build shape. Public node keys stay in world space.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PageBuildOrigin {
    pub min_page_x: i32,
    pub min_page_z: i32,
}

pub struct BuildResult {
    pub nodes_by_level: Vec<Vec<ClodPageNode>>,
    pub origin: PageBuildOrigin,
    pub world_pages_x: i32,
    pub world_pages_z: i32,
    pub polish: DiagonalPolishStats,
}

/// Inclusive LOD0 page coord span → axis page counts for `resolve_build_shape`.
fn infer_lod0_page_shape(lod0: &[((i32, i32), PageSource)]) -> (PageBuildOrigin, i32, i32) {
    if lod0.is_empty() {
        return (PageBuildOrigin::default(), 0, 0);
    }
    let min_page_x = lod0.iter().map(|((px, _), _)| *px).min().unwrap();
    let max_page_x = lod0.iter().map(|((px, _), _)| *px).max().unwrap();
    let min_page_z = lod0.iter().map(|((_, pz), _)| *pz).min().unwrap();
    let max_page_z = lod0.iter().map(|((_, pz), _)| *pz).max().unwrap();
    (
        PageBuildOrigin {
            min_page_x,
            min_page_z,
        },
        max_page_x - min_page_x + 1,
        max_page_z - min_page_z + 1,
    )
}

/// Inclusive world-cell bounds touched by an edit (sphere bbox + influence margin).
#[derive(Clone, Debug)]
pub struct DirtyCellBounds {
    pub min_x: f32,
    pub max_x: f32,
    pub min_z: f32,
    pub max_z: f32,
}

pub struct EditRebuildResult {
    /// Total LOD0 pages rebuilt.
    pub lod0_page_coords: Vec<(i32, i32)>,
    /// Total parent nodes rebuilt via resimplify.
    pub parent_node_coords: Vec<(i32, i32)>,
}

/// Per-level node lookup: level → HashMap<coord, index_into_nodes_by_level[level]>.
pub type NodeIndex = Vec<HashMap<(i32, i32), usize>>;

fn union(a: PageFootprint, b: PageFootprint) -> PageFootprint {
    PageFootprint {
        min_x: a.min_x.min(b.min_x),
        min_z: a.min_z.min(b.min_z),
        max_x: a.max_x.max(b.max_x),
        max_z: a.max_z.max(b.max_z),
    }
}

/// Validate world page dimensions and compute the effective number of quadtree levels.
/// Mirrors `resolveBuildShape` in clod-poc/src/quadtree.ts.
pub fn resolve_build_shape(
    world_pages_x: i32,
    world_pages_z: i32,
    cfg: &ClodPagesConfig,
) -> Result<usize, ClodBuildError> {
    let max_levels = cfg
        .page
        .quadtree_levels
        .min((world_pages_x.min(world_pages_z) as f32).log2().floor() as usize + 1);
    let required_multiple = 1 << (max_levels - 1);
    if world_pages_x % required_multiple != 0 || world_pages_z % required_multiple != 0 {
        return Err(ClodBuildError::PageIncomplete { message: format!(
            "world pages {}x{} not a multiple of {} for {} levels",
            world_pages_x, world_pages_z, required_multiple, max_levels
        ) });
    }
    Ok(max_levels)
}

/// Build a per-level HashMap from node coord to index in `nodes_by_level[level]`.
pub fn build_node_index(nodes_by_level: &[Vec<ClodPageNode>]) -> NodeIndex {
    let mut index = Vec::with_capacity(nodes_by_level.len());
    for (_level, nodes) in nodes_by_level.iter().enumerate() {
        let mut m = HashMap::new();
        for (i, n) in nodes.iter().enumerate() {
            m.insert(n.coord, i);
        }
        index.push(m);
    }
    index
}

/// Build a parent node by merging and simplifying its 2×2 children (identified by coord).
fn build_parent_node_from_children(
    level: usize,
    coord: (i32, i32),
    children: &[&ClodPageNode],
    cfg: &ClodPagesConfig,
    weld_epsilon: f32,
) -> Result<ClodPageNode, ClodBuildError> {
    let merged = concat(&children.iter().map(|c| c.mesh.clone()).collect::<Vec<_>>());
    let val = cfg.validation();
    let tol = BorderTolerances {
        position: weld_epsilon,
        normal_dot: val.normal_dot_min,
        material: val.material_weight_epsilon,
    };
    let (welded, _) = weld_vertices(&merged, weld_epsilon, tol)?;
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
        strip_degenerate_triangles(&mut mesh, cfg.validation().zero_area_epsilon)?;
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

fn build_parent_node(
    level: usize,
    coord: (i32, i32),
    child_ids: &[usize],
    previous_level: &[ClodPageNode],
    cfg: &ClodPagesConfig,
    weld_epsilon: f32,
) -> Result<ClodPageNode, ClodBuildError> {
    if child_ids.len() != 4 {
        return Err(ClodBuildError::PageIncomplete {
            message: format!(
                "parent L{level}:({},{}) expected 4 children, got {}",
                coord.0,
                coord.1,
                child_ids.len()
            ),
        });
    }
    let children: Vec<&ClodPageNode> = child_ids.iter().map(|&i| &previous_level[i]).collect();
    build_parent_node_from_children(level, coord, &children, cfg, weld_epsilon)
}

fn build_parent_level(
    level: usize,
    groups: Vec<((i32, i32), Vec<usize>)>,
    previous_level: &[ClodPageNode],
    cfg: &ClodPagesConfig,
    weld_epsilon: f32,
) -> Result<Vec<ClodPageNode>, ClodBuildError> {
    let complete_groups: Vec<_> = groups
        .into_iter()
        .filter(|(_, child_ids)| child_ids.len() == 4)
        .collect();

    if complete_groups.is_empty() {
        return Ok(Vec::new());
    }

    if complete_groups.len() <= 1 {
        return complete_groups
            .into_iter()
            .map(|(coord, child_ids)| {
                build_parent_node(level, coord, &child_ids, previous_level, cfg, weld_epsilon)
            })
            .collect();
    }

    let worker_count = thread::available_parallelism()
        .map(usize::from)
        .unwrap_or(1)
        .min(complete_groups.len());
    let chunk_size = complete_groups.len().div_ceil(worker_count);
    thread::scope(|scope| {
        let mut handles = Vec::new();
        for chunk in complete_groups.chunks(chunk_size) {
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

    let (origin, world_pages_x, world_pages_z) = infer_lod0_page_shape(&lod0);
    let max_levels = resolve_build_shape(world_pages_x, world_pages_z, cfg)?;

    let mut nodes_by_level: Vec<Vec<ClodPageNode>> = Vec::new();

    // ---- LOD0 ----
    let mut level0: Vec<ClodPageNode> = Vec::new();
    for (coord, src) in lod0 {
        let mut mesh = src.mesh;
        strip_degenerate_triangles(&mut mesh, cfg.validation().zero_area_epsilon)?;
        assert_no_internal_borders(&mesh, &src.footprint)?;
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

    // ---- LOD1+ ----
    for level in 1..max_levels {
        // group previous-level nodes by parent coord
        let mut groups: HashMap<(i32, i32), Vec<usize>> = HashMap::new();
        for (i, n) in nodes_by_level[level - 1].iter().enumerate() {
            let pc = (n.coord.0.div_euclid(2), n.coord.1.div_euclid(2));
            groups.entry(pc).or_default().push(i);
        }

        let group_items = groups.into_iter().collect::<Vec<_>>();
        let level_nodes =
            build_parent_level(level, group_items, &nodes_by_level[level - 1], cfg, eps)?;

        let done = level_nodes.len() <= 1;
        nodes_by_level.push(level_nodes);
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
        origin,
        world_pages_x,
        world_pages_z,
        polish,
    })
}

/// Re-derive a single parent from its 2×2 children (identified by coord at level-1).
/// Mutates the node in `nodes_by_level[level]` in place. Mirrors `resimplifyParent`
/// in clod-poc/src/quadtree.ts.
pub fn resimplify_parent(
    nodes_by_level: &mut [Vec<ClodPageNode>],
    index: &NodeIndex,
    level: usize,
    coord: (i32, i32),
    cfg: &ClodPagesConfig,
    weld_epsilon: f32,
) -> Result<(), ClodBuildError> {
    let Some(&node_idx) = index.get(level).and_then(|m| m.get(&coord)) else {
        return Ok(());
    };
    let previous = &nodes_by_level[level - 1];
    let child_coords = [
        (coord.0 * 2, coord.1 * 2),
        (coord.0 * 2 + 1, coord.1 * 2),
        (coord.0 * 2, coord.1 * 2 + 1),
        (coord.0 * 2 + 1, coord.1 * 2 + 1),
    ];
    let children: Vec<&ClodPageNode> = child_coords
        .iter()
        .filter_map(|&c| {
            index
                .get(level - 1)
                .and_then(|m| m.get(&c))
                .map(|&i| &previous[i])
        })
        .collect();
    if children.len() != 4 {
        return Err(ClodBuildError::PageIncomplete { message: format!(
            "resimplify L{level}:({},{}) expected 4 children, got {}",
            coord.0,
            coord.1,
            children.len()
        ) });
    }
    let rebuilt =
        build_parent_node_from_children(level, coord, &children, cfg, weld_epsilon)?;
    nodes_by_level[level][node_idx] = rebuilt;
    Ok(())
}

/// First stage of edit rebuild: regenerate LOD0 nodes for pages whose footprint intersects
/// `dirty`. Nodes are looked up from the coordinate index. Mirrors `rebuildDirtyLod0Pages`
/// in clod-poc/src/quadtree.ts.
pub fn rebuild_dirty_lod0_pages(
    nodes_by_level: &mut [Vec<ClodPageNode>],
    index: &NodeIndex,
    new_sources: &[((i32, i32), PageSource)],
) -> Vec<(i32, i32)> {
    let mut coords = Vec::new();
    for &(coord, ref src) in new_sources {
        if let Some(&node_idx) = index[0].get(&coord) {
            let mut mesh = src.mesh.clone();
            let _ = strip_degenerate_triangles(&mut mesh, 1e-8);
            nodes_by_level[0][node_idx].mesh = mesh;
            nodes_by_level[0][node_idx].footprint = src.footprint;
            coords.push(coord);
        }
    }
    coords
}

/// End-to-end edit rebuild: replace dirty LOD0 pages, then resimplify every ancestor chain.
/// Mirrors `rebuildDirtyPages` in clod-poc/src/quadtree.ts.
pub fn rebuild_dirty_pages(
    nodes_by_level: &mut Vec<Vec<ClodPageNode>>,
    new_sources: &[((i32, i32), PageSource)],
    cfg: &ClodPagesConfig,
    weld_epsilon: f32,
) -> Result<EditRebuildResult, ClodBuildError> {
    let index = build_node_index(nodes_by_level);
    let lod0_coords = rebuild_dirty_lod0_pages(nodes_by_level, &index, new_sources);
    let mut parent_coords: Vec<(i32, i32)> = Vec::new();
    let mut dirty_coords = lod0_coords.clone();
    for level in 1..nodes_by_level.len() {
        let mut parents = std::collections::HashSet::new();
        for &(nx, nz) in &dirty_coords {
            parents.insert((nx.div_euclid(2), nz.div_euclid(2)));
        }
        dirty_coords.clear();
        for &pc in &parents {
            resimplify_parent(nodes_by_level, &index, level, pc, cfg, weld_epsilon)?;
            parent_coords.push(pc);
            dirty_coords.push(pc);
        }
    }
    Ok(EditRebuildResult {
        lod0_page_coords: lod0_coords,
        parent_node_coords: parent_coords,
    })
}
