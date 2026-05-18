use bevy::prelude::*;

use super::config::NaadfConfig;
use super::stats::NaadfStats;

#[derive(Resource, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NaadfFroxelSunMaskState {
    pub active: bool,
    pub resolution: UVec3,
    pub rays_per_full_update: u64,
    pub max_rays_per_frame: u32,
    pub frames_per_full_update: u32,
}

pub fn sync_naadf_froxel_sun_mask_state(
    config: Res<NaadfConfig>,
    mut state: ResMut<NaadfFroxelSunMaskState>,
    mut stats: ResMut<NaadfStats>,
) {
    let resolution = config.froxel_sun_mask.resolution_uvec3();
    let rays_per_full_update = froxel_ray_count(resolution);
    let max_rays_per_frame = config.froxel_sun_mask.max_rays_per_frame.max(1);
    let frames_per_full_update =
        rays_per_full_update.div_ceil(max_rays_per_frame as u64).min(u32::MAX as u64) as u32;
    let active = config.enabled
        && config.use_for_sun_visibility
        && config.froxel_sun_mask.enabled
        && rays_per_full_update > 0;

    *state = NaadfFroxelSunMaskState {
        active,
        resolution,
        rays_per_full_update,
        max_rays_per_frame,
        frames_per_full_update,
    };
    stats.froxel_sun_mask_active = active as u32;
    stats.froxel_sun_mask_rays_per_full_update = rays_per_full_update;
    stats.froxel_sun_mask_max_rays_per_frame = if active { max_rays_per_frame } else { 0 };
    stats.froxel_sun_mask_frames_per_full_update = if active {
        frames_per_full_update
    } else {
        0
    };
}

pub fn froxel_ray_count(resolution: UVec3) -> u64 {
    resolution.x as u64 * resolution.y as u64 * resolution.z as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rendering::naadf::config::NaadfFroxelSunMaskConfig;

    #[test]
    fn froxel_ray_count_is_one_ray_per_cell() {
        assert_eq!(froxel_ray_count(UVec3::new(160, 90, 64)), 921_600);
    }

    #[test]
    fn froxel_state_requires_naadf_sun_visibility_toggle() {
        let mut app = App::new();
        app.insert_resource(NaadfConfig {
            enabled: true,
            use_for_sun_visibility: true,
            froxel_sun_mask: NaadfFroxelSunMaskConfig {
                enabled: true,
                resolution: [16, 9, 8],
                max_rays_per_frame: 128,
                ..default()
            },
            ..default()
        })
        .init_resource::<NaadfStats>()
        .init_resource::<NaadfFroxelSunMaskState>()
        .add_systems(Update, sync_naadf_froxel_sun_mask_state);

        app.update();

        let state = app.world().resource::<NaadfFroxelSunMaskState>();
        assert!(state.active);
        assert_eq!(state.rays_per_full_update, 1_152);
        assert_eq!(state.frames_per_full_update, 9);
        let stats = app.world().resource::<NaadfStats>();
        assert_eq!(stats.froxel_sun_mask_active, 1);
        assert_eq!(stats.froxel_sun_mask_rays_per_full_update, 1_152);
    }
}
