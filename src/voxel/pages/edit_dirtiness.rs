//! CLOD edit dirtiness planning.
//!
//! This is the small, deterministic bridge between a world-space brush/edit and the
//! quadtree rebuild path: compute which LOD0 pages must be regenerated, then compute
//! every ancestor node that must be re-simplified. It mirrors the dirty-page planning
//! used by the clod-poc edit path while keeping `VoxelWorld` authoritative.

use std::collections::BTreeSet;

use super::quadtree::{DirtyCellBounds, PageBuildOrigin};

/// World-space LOD0 page grid used by CLOD edit invalidation.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ClodDirtyPageGrid {
    /// Width/depth of one LOD0 page in world/cell units.
    pub lod0_page_size_cells: f32,
    /// Minimum world-space LOD0 page coordinate included in the current CLOD tree.
    pub min_page_x: i32,
    pub min_page_z: i32,
    /// Number of LOD0 pages included in the current CLOD tree.
    pub world_pages_x: i32,
    pub world_pages_z: i32,
    /// Number of levels in the current CLOD tree. Level 0 is LOD0.
    pub max_levels: usize,
}

impl ClodDirtyPageGrid {
    pub fn try_new(
        lod0_page_size_cells: f32,
        min_page_x: i32,
        min_page_z: i32,
        world_pages_x: i32,
        world_pages_z: i32,
        max_levels: usize,
    ) -> Result<Self, String> {
        if !lod0_page_size_cells.is_finite() || lod0_page_size_cells <= 0.0 {
            return Err(format!(
                "lod0_page_size_cells must be finite and > 0, got {lod0_page_size_cells}"
            ));
        }
        if world_pages_x <= 0 || world_pages_z <= 0 {
            return Err(format!(
                "world page counts must be positive, got {world_pages_x}x{world_pages_z}"
            ));
        }
        if max_levels == 0 {
            return Err("max_levels must be at least 1".to_string());
        }

        Ok(Self {
            lod0_page_size_cells,
            min_page_x,
            min_page_z,
            world_pages_x,
            world_pages_z,
            max_levels,
        })
    }

    pub fn from_build_shape(
        lod0_page_size_cells: f32,
        origin: PageBuildOrigin,
        world_pages_x: i32,
        world_pages_z: i32,
        max_levels: usize,
    ) -> Result<Self, String> {
        Self::try_new(
            lod0_page_size_cells,
            origin.min_page_x,
            origin.min_page_z,
            world_pages_x,
            world_pages_z,
            max_levels,
        )
    }

    fn max_page_x(self) -> i32 {
        self.min_page_x + self.world_pages_x - 1
    }

    fn max_page_z(self) -> i32 {
        self.min_page_z + self.world_pages_z - 1
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ClodDirtyPagePlan {
    /// LOD0 page coordinates whose source meshes should be regenerated.
    pub lod0_page_coords: Vec<(i32, i32)>,
    /// Ancestors to re-simplify, indexed by CLOD level. Index 0 is always empty.
    pub ancestor_node_coords_by_level: Vec<Vec<(i32, i32)>>,
}

impl ClodDirtyPagePlan {
    pub fn is_empty(&self) -> bool {
        self.lod0_page_coords.is_empty()
    }

    pub fn total_ancestor_count(&self) -> usize {
        self.ancestor_node_coords_by_level
            .iter()
            .map(Vec::len)
            .sum()
    }

    pub fn total_node_count(&self) -> usize {
        self.lod0_page_coords.len() + self.total_ancestor_count()
    }

    /// Flatten as `(level, coord)` pairs. Useful for telemetry and debug overlays.
    pub fn flattened_nodes(&self) -> Vec<(usize, (i32, i32))> {
        let mut out = Vec::with_capacity(self.total_node_count());
        out.extend(
            self.lod0_page_coords
                .iter()
                .copied()
                .map(|coord| (0, coord)),
        );
        for (level, coords) in self
            .ancestor_node_coords_by_level
            .iter()
            .enumerate()
            .skip(1)
        {
            out.extend(coords.iter().copied().map(|coord| (level, coord)));
        }
        out
    }
}

/// Conservative X/Z dirty bounds for a spherical terrain edit brush.
pub fn dirty_bounds_from_sphere_xz(
    center_x: f32,
    center_z: f32,
    radius: f32,
    influence_margin: f32,
) -> DirtyCellBounds {
    let r = (radius + influence_margin.max(0.0)).max(0.0);
    DirtyCellBounds {
        min_x: center_x - r,
        max_x: center_x + r,
        min_z: center_z - r,
        max_z: center_z + r,
    }
}

/// Build a complete dirty-page plan for a spherical edit brush.
pub fn plan_dirty_pages_for_sphere(
    grid: ClodDirtyPageGrid,
    center_x: f32,
    center_z: f32,
    radius: f32,
    influence_margin: f32,
) -> ClodDirtyPagePlan {
    let bounds = dirty_bounds_from_sphere_xz(center_x, center_z, radius, influence_margin);
    plan_dirty_pages_for_bounds(grid, &bounds)
}

/// Build a complete dirty-page plan for an already-expanded dirty rectangle.
pub fn plan_dirty_pages_for_bounds(
    grid: ClodDirtyPageGrid,
    bounds: &DirtyCellBounds,
) -> ClodDirtyPagePlan {
    let lod0_page_coords = dirty_lod0_pages_for_bounds(grid, bounds);
    let ancestor_node_coords_by_level = dirty_ancestors_for_lod0(grid, &lod0_page_coords);
    ClodDirtyPagePlan {
        lod0_page_coords,
        ancestor_node_coords_by_level,
    }
}

/// Compute LOD0 pages touched by a dirty X/Z rectangle.
///
/// The max edge is intentionally inclusive/conservative. If an edit reaches exactly
/// onto a page boundary, both neighboring pages are considered dirty so weld/lock
/// invariants remain safe after rebuild.
pub fn dirty_lod0_pages_for_bounds(
    grid: ClodDirtyPageGrid,
    bounds: &DirtyCellBounds,
) -> Vec<(i32, i32)> {
    let Some((min_x, max_x)) = dirty_page_range_axis(
        bounds.min_x,
        bounds.max_x,
        grid.lod0_page_size_cells,
        grid.min_page_x,
        grid.max_page_x(),
    ) else {
        return Vec::new();
    };
    let Some((min_z, max_z)) = dirty_page_range_axis(
        bounds.min_z,
        bounds.max_z,
        grid.lod0_page_size_cells,
        grid.min_page_z,
        grid.max_page_z(),
    ) else {
        return Vec::new();
    };

    let mut coords = Vec::new();
    for z in min_z..=max_z {
        for x in min_x..=max_x {
            coords.push((x, z));
        }
    }
    coords
}

/// Compute every parent chain touched by a set of dirty LOD0 pages.
pub fn dirty_ancestors_for_lod0(
    grid: ClodDirtyPageGrid,
    lod0_page_coords: &[(i32, i32)],
) -> Vec<Vec<(i32, i32)>> {
    let mut by_level = vec![Vec::new(); grid.max_levels];
    if lod0_page_coords.is_empty() || grid.max_levels <= 1 {
        return by_level;
    }

    let mut current: BTreeSet<(i32, i32)> = lod0_page_coords.iter().copied().collect();
    for level_vec in by_level.iter_mut().take(grid.max_levels).skip(1) {
        let parents: BTreeSet<(i32, i32)> = current
            .iter()
            .map(|&(x, z)| (x.div_euclid(2), z.div_euclid(2)))
            .collect();
        *level_vec = parents.iter().copied().collect();
        current = parents;
    }
    by_level
}

fn dirty_page_range_axis(
    min_world: f32,
    max_world: f32,
    page_size: f32,
    min_allowed: i32,
    max_allowed: i32,
) -> Option<(i32, i32)> {
    if !min_world.is_finite()
        || !max_world.is_finite()
        || !page_size.is_finite()
        || page_size <= 0.0
    {
        return None;
    }
    if max_world < min_world {
        return None;
    }

    let min_page = (min_world / page_size).floor() as i32;
    let max_page = (max_world / page_size).floor() as i32;
    let min_page = min_page.max(min_allowed);
    let max_page = max_page.min(max_allowed);

    (min_page <= max_page).then_some((min_page, max_page))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grid() -> ClodDirtyPageGrid {
        ClodDirtyPageGrid::try_new(16.0, 0, 0, 8, 8, 4).unwrap()
    }

    #[test]
    fn sphere_inside_one_page_marks_one_lod0_page() {
        let plan = plan_dirty_pages_for_sphere(grid(), 8.0, 8.0, 2.0, 0.0);
        assert_eq!(plan.lod0_page_coords, vec![(0, 0)]);
        assert_eq!(plan.ancestor_node_coords_by_level[1], vec![(0, 0)]);
        assert_eq!(plan.ancestor_node_coords_by_level[2], vec![(0, 0)]);
        assert_eq!(plan.ancestor_node_coords_by_level[3], vec![(0, 0)]);
    }

    #[test]
    fn boundary_touch_is_conservative() {
        let bounds = DirtyCellBounds {
            min_x: 15.0,
            max_x: 16.0,
            min_z: 15.0,
            max_z: 16.0,
        };
        let plan = plan_dirty_pages_for_bounds(grid(), &bounds);
        assert_eq!(plan.lod0_page_coords, vec![(0, 0), (1, 0), (0, 1), (1, 1)]);
        assert_eq!(plan.ancestor_node_coords_by_level[1], vec![(0, 0)]);
    }

    #[test]
    fn clamps_to_current_tree_footprint() {
        let plan = plan_dirty_pages_for_sphere(grid(), -32.0, 8.0, 48.0, 0.0);
        assert!(
            plan.lod0_page_coords
                .iter()
                .all(|(x, z)| *x >= 0 && *z >= 0)
        );
        assert!(plan.lod0_page_coords.iter().all(|(x, z)| *x < 8 && *z < 8));
    }

    #[test]
    fn negative_page_coords_use_euclidean_parents() {
        let grid = ClodDirtyPageGrid::try_new(16.0, -4, -4, 8, 8, 4).unwrap();
        let plan = plan_dirty_pages_for_sphere(grid, -8.0, -8.0, 1.0, 0.0);
        assert_eq!(plan.lod0_page_coords, vec![(-1, -1)]);
        assert_eq!(plan.ancestor_node_coords_by_level[1], vec![(-1, -1)]);
        assert_eq!(plan.ancestor_node_coords_by_level[2], vec![(-1, -1)]);
    }

    #[test]
    fn ancestor_levels_are_deduped_and_sorted() {
        let plan = plan_dirty_pages_for_bounds(
            grid(),
            &DirtyCellBounds {
                min_x: 0.0,
                max_x: 48.0,
                min_z: 0.0,
                max_z: 16.0,
            },
        );
        assert_eq!(plan.lod0_page_coords.len(), 8);
        assert_eq!(plan.ancestor_node_coords_by_level[1], vec![(0, 0), (1, 0)]);
        assert_eq!(plan.ancestor_node_coords_by_level[2], vec![(0, 0)]);
        assert_eq!(plan.ancestor_node_coords_by_level[3], vec![(0, 0)]);
    }

    #[test]
    fn invalid_bounds_return_empty_plan() {
        let plan = plan_dirty_pages_for_bounds(
            grid(),
            &DirtyCellBounds {
                min_x: 10.0,
                max_x: 9.0,
                min_z: 0.0,
                max_z: 1.0,
            },
        );
        assert!(plan.is_empty());
    }
}
