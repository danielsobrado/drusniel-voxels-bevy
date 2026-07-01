use bevy::diagnostic::FrameCount;
use bevy::prelude::*;

use crate::performance::AreaTimingRecorder;

/// Renderer that owns a visible water footprint.
///
/// Water must not be baked into CLOD pages. CLOD pages own terrain caches only;
/// live voxel water meshes, future clipmap water, or explicit hidden/fallback
/// states own water surfaces.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum WaterSurfaceOwner {
    #[default]
    Fallback,
    NearVoxelMesh,
    Clipmap,
    DeepOcean,
    Hidden,
}

#[derive(Resource, Clone, Debug, Default)]
pub struct WaterOwnershipStats {
    pub near_voxel_meshes: u32,
    pub clipmap_surfaces: u32,
    pub deep_ocean_surfaces: u32,
    pub hidden_surfaces: u32,
    pub fallback_surfaces: u32,
}

impl WaterOwnershipStats {
    pub fn clear(&mut self) {
        self.near_voxel_meshes = 0;
        self.clipmap_surfaces = 0;
        self.deep_ocean_surfaces = 0;
        self.hidden_surfaces = 0;
        self.fallback_surfaces = 0;
    }

    pub fn record(&mut self, owner: WaterSurfaceOwner) {
        match owner {
            WaterSurfaceOwner::NearVoxelMesh => self.near_voxel_meshes += 1,
            WaterSurfaceOwner::Clipmap => self.clipmap_surfaces += 1,
            WaterSurfaceOwner::DeepOcean => self.deep_ocean_surfaces += 1,
            WaterSurfaceOwner::Hidden => self.hidden_surfaces += 1,
            WaterSurfaceOwner::Fallback => self.fallback_surfaces += 1,
        }
    }
}

#[derive(Component, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct WaterOwnerMarker {
    pub owner: WaterSurfaceOwner,
}

pub struct WaterOwnershipPlugin;

impl Plugin for WaterOwnershipPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<WaterOwnershipStats>()
            .add_systems(Update, collect_water_ownership_stats);
    }
}

fn collect_water_ownership_stats(
    markers: Query<&WaterOwnerMarker>,
    mut stats: ResMut<WaterOwnershipStats>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    stats.clear();
    for marker in &markers {
        stats.record(marker.owner);
    }

    timing.record_count(
        frame.0,
        "Water Owner Near Voxel Meshes",
        stats.near_voxel_meshes as f64,
    );
    timing.record_count(
        frame.0,
        "Water Owner Clipmap Surfaces",
        stats.clipmap_surfaces as f64,
    );
    timing.record_count(
        frame.0,
        "Water Owner Deep Ocean Surfaces",
        stats.deep_ocean_surfaces as f64,
    );
    timing.record_count(
        frame.0,
        "Water Owner Hidden Surfaces",
        stats.hidden_surfaces as f64,
    );
    timing.record_count(
        frame.0,
        "Water Owner Fallback Surfaces",
        stats.fallback_surfaces as f64,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stats_count_all_owner_modes() {
        let mut stats = WaterOwnershipStats::default();

        stats.record(WaterSurfaceOwner::NearVoxelMesh);
        stats.record(WaterSurfaceOwner::Clipmap);
        stats.record(WaterSurfaceOwner::DeepOcean);
        stats.record(WaterSurfaceOwner::Hidden);
        stats.record(WaterSurfaceOwner::Fallback);

        assert_eq!(stats.near_voxel_meshes, 1);
        assert_eq!(stats.clipmap_surfaces, 1);
        assert_eq!(stats.deep_ocean_surfaces, 1);
        assert_eq!(stats.hidden_surfaces, 1);
        assert_eq!(stats.fallback_surfaces, 1);
    }
}
