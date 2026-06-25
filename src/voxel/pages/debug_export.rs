//! Optional debug export of CLOD page hierarchy as JSON.
//! Only compiled in test/bench builds. Include behind `#[cfg(test)]`.

use super::quadtree::BuildResult;

/// Serializable node info for debug export.
#[derive(serde::Serialize)]
pub struct DebugNodeInfo {
    pub coord: (i32, i32),
    pub level: usize,
    pub vertex_count: usize,
    pub triangle_count: usize,
    pub error_world: f32,
    pub low_benefit: bool,
    pub parent_coord: Option<(i32, i32)>,
    pub child_coords: Vec<(i32, i32)>,
}

/// Serializable hierarchy for debug export.
#[derive(serde::Serialize)]
pub struct DebugHierarchy {
    pub min_page_x: i32,
    pub min_page_z: i32,
    pub world_pages_x: i32,
    pub world_pages_z: i32,
    pub nodes: Vec<DebugNodeInfo>,
}

/// Build a debug hierarchy from a BuildResult. Child/parent relationships are inferred
/// from coordinates (a node at level N with coord (x,z) has children at level N-1
/// at (2x,2z)...(2x+1,2z+1)).
pub fn build_debug_hierarchy(result: &BuildResult) -> DebugHierarchy {
    let mut node_set: Vec<DebugNodeInfo> = Vec::new();
    let mut coord_by_level: Vec<std::collections::HashMap<(i32, i32), usize>> = Vec::new();

    // Build coord lookup per level
    for level_nodes in &result.nodes_by_level {
        let mut map = std::collections::HashMap::new();
        for (i, n) in level_nodes.iter().enumerate() {
            map.insert(n.coord, i);
        }
        coord_by_level.push(map);
    }

    // Build node info with child relationships
    for (level, level_nodes) in result.nodes_by_level.iter().enumerate() {
        for n in level_nodes {
            let child_coords = if level > 0 {
                let mut children = Vec::new();
                for dz in 0..2 {
                    for dx in 0..2 {
                        let cc = (n.coord.0 * 2 + dx, n.coord.1 * 2 + dz);
                        if coord_by_level[level - 1].contains_key(&cc) {
                            children.push(cc);
                        }
                    }
                }
                children
            } else {
                Vec::new()
            };

            let parent_coord = if level + 1 < coord_by_level.len() {
                let pc = (n.coord.0.div_euclid(2), n.coord.1.div_euclid(2));
                if coord_by_level[level + 1].contains_key(&pc) {
                    Some(pc)
                } else {
                    None
                }
            } else {
                None
            };

            node_set.push(DebugNodeInfo {
                coord: n.coord,
                level,
                vertex_count: n.mesh.vertex_count(),
                triangle_count: n.mesh.triangle_count(),
                error_world: n.error_world,
                low_benefit: n.low_benefit,
                parent_coord,
                child_coords,
            });
        }
    }

    DebugHierarchy {
        min_page_x: result.origin.min_page_x,
        min_page_z: result.origin.min_page_z,
        world_pages_x: result.world_pages_x,
        world_pages_z: result.world_pages_z,
        nodes: node_set,
    }
}
