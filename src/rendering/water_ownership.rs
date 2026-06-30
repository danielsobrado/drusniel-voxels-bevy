use bevy::prelude::*;

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
    Hidden,
}

#[derive(Resource, Clone, Debug, Default)]
pub struct WaterOwnershipStats {
    pub near_voxel_meshes: u32,
    pub clipmap_surfaces: u32,
    pub hidden_surfaces: u32,
    pub fallback_surfaces: u32,
}

impl WaterOwnershipStats {
    pub fn clear(&mut self) {
        self.near_voxel_meshes = 0;
        self.clipmap_surfaces = 0;
        self.hidden_surfaces = 0;
        self.fallback_surfaces = 0;
    }

    pub fn record(&mut self, owner: WaterSurfaceOwner) {
        match owner {
            WaterSurfaceOwner::NearVoxelMesh => self.near_voxel_meshes += 1,
            WaterSurfaceOwner::Clipmap => self.clipmap_surfaces += 1,
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
) {
    stats.clear();
    for marker in &markers {
        stats.record(marker.owner);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stats_count_all_owner_modes() {
        let mut stats = WaterOwnershipStats::default();

        stats.record(WaterSurfaceOwner::NearVoxelMesh);
        stats.record(WaterSurfaceOwner::Clipmap);
        stats.record(WaterSurfaceOwner::Hidden);
        stats.record(WaterSurfaceOwner::Fallback);

        assert_eq!(stats.near_voxel_meshes, 1);
        assert_eq!(stats.clipmap_surfaces, 1);
        assert_eq!(stats.hidden_surfaces, 1);
        assert_eq!(stats.fallback_surfaces, 1);
    }
}
