//! Build statistics for CLOD page hierarchy construction.

/// Overall build report.
#[derive(Debug, Clone, Default)]
pub struct BuildStats {
    pub levels: Vec<LevelBuildStats>,
    pub total_build_ms: f64,
}

/// Per-level statistics.
#[derive(Debug, Clone)]
pub struct LevelBuildStats {
    pub level: u8,
    pub node_count: usize,
    pub input_triangles: usize,
    pub output_triangles: usize,
    pub reduction_ratio: f32,
    pub low_benefit_count: usize,
    pub average_error_world: f32,
    pub max_error_world: f32,
    pub average_build_ms: f64,
    pub max_build_ms: f64,
}

/// Per-node debug stats collected during build.
#[derive(Debug, Clone)]
pub struct NodeBuildStat {
    pub page_id: String,
    pub level: u8,
    pub input_tris: usize,
    pub output_tris: usize,
    pub locked_verts: usize,
    pub error_world: f32,
    pub low_benefit: bool,
    pub build_ms: f64,
}

impl BuildStats {
    pub fn from_node_stats(stats: &[NodeBuildStat], total_ms: f64) -> Self {
        use std::collections::BTreeMap;
        let mut by_level: BTreeMap<u8, Vec<&NodeBuildStat>> = BTreeMap::new();
        for s in stats {
            by_level.entry(s.level).or_default().push(s);
        }
        let mut levels = Vec::new();
        for (level, nodes) in by_level {
            let node_count = nodes.len();
            let input_triangles: usize = nodes.iter().map(|n| n.input_tris).sum();
            let output_triangles: usize = nodes.iter().map(|n| n.output_tris).sum();
            let reduction_ratio = if input_triangles > 0 {
                output_triangles as f32 / input_triangles as f32
            } else {
                1.0
            };
            let low_benefit_count = nodes.iter().filter(|n| n.low_benefit).count();
            let average_error_world =
                nodes.iter().map(|n| n.error_world).sum::<f32>() / node_count as f32;
            let max_error_world = nodes
                .iter()
                .map(|n| n.error_world)
                .fold(0.0f32, f32::max);
            let average_build_ms =
                nodes.iter().map(|n| n.build_ms).sum::<f64>() / node_count as f64;
            let max_build_ms = nodes.iter().map(|n| n.build_ms).fold(0.0, f64::max);
            levels.push(LevelBuildStats {
                level,
                node_count,
                input_triangles,
                output_triangles,
                reduction_ratio,
                low_benefit_count,
                average_error_world,
                max_error_world,
                average_build_ms,
                max_build_ms,
            });
        }
        BuildStats {
            levels,
            total_build_ms: total_ms,
        }
    }
}
