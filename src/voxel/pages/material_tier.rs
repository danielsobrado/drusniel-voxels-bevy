//! Distance-based CLOD page material quality tiers.

use bevy::prelude::*;

use crate::rendering::triplanar_material::TerrainMaterialQuality;

use super::config::ClodMaterialCfg;
use super::types::PageFootprint;

pub fn clod_page_material_quality_for_distance(
    distance_m: f32,
    cfg: &ClodMaterialCfg,
) -> TerrainMaterialQuality {
    if distance_m < cfg.full_triplanar_max_m {
        TerrainMaterialQuality::FullTriplanar
    } else if distance_m < cfg.cheap_triplanar_max_m {
        TerrainMaterialQuality::CheapTriplanar
    } else if distance_m < cfg.single_projection_far_max_m {
        TerrainMaterialQuality::SingleProjectionFar
    } else {
        TerrainMaterialQuality::HorizonProxy
    }
}

pub fn clod_page_material_distance_m(camera_pos: Vec3, footprint: PageFootprint) -> f32 {
    footprint.distance_xz(camera_pos.x, camera_pos.z)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> ClodMaterialCfg {
        ClodMaterialCfg::default()
    }

    fn footprint(min: f32, max: f32) -> PageFootprint {
        PageFootprint {
            min_x: min,
            min_z: min,
            max_x: max,
            max_z: max,
        }
    }

    #[test]
    fn material_tiers_follow_configured_distances() {
        let cfg = cfg();
        assert_eq!(
            clod_page_material_quality_for_distance(400.0, &cfg),
            TerrainMaterialQuality::FullTriplanar
        );
        assert_eq!(
            clod_page_material_quality_for_distance(1000.0, &cfg),
            TerrainMaterialQuality::CheapTriplanar
        );
        assert_eq!(
            clod_page_material_quality_for_distance(1600.0, &cfg),
            TerrainMaterialQuality::SingleProjectionFar
        );
        assert_eq!(
            clod_page_material_quality_for_distance(3000.0, &cfg),
            TerrainMaterialQuality::HorizonProxy
        );
    }

    #[test]
    fn material_distance_uses_footprint_edge_not_center() {
        let fp = footprint(0.0, 64.0);
        let camera = Vec3::new(200.0, 0.0, 32.0);
        assert!(
            (clod_page_material_distance_m(camera, fp) - 136.0).abs() < 0.01,
            "distance should be to the nearest footprint edge"
        );
    }
}
