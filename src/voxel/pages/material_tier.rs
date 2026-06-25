//! Distance-based CLOD page material quality tiers.

use crate::rendering::triplanar_material::TerrainMaterialQuality;

use super::config::ClodMaterialCfg;

pub fn clod_page_material_quality_for_distance(
    distance_m: f32,
    cfg: &ClodMaterialCfg,
) -> TerrainMaterialQuality {
    if distance_m < cfg.full_triplanar_max_m {
        TerrainMaterialQuality::FullTriplanar
    } else if distance_m < cfg.single_projection_far_max_m {
        TerrainMaterialQuality::SingleProjectionFar
    } else {
        TerrainMaterialQuality::HorizonProxy
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> ClodMaterialCfg {
        ClodMaterialCfg {
            full_triplanar_max_m: 768.0,
            single_projection_far_max_m: 2048.0,
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
            TerrainMaterialQuality::SingleProjectionFar
        );
        assert_eq!(
            clod_page_material_quality_for_distance(3000.0, &cfg),
            TerrainMaterialQuality::HorizonProxy
        );
    }
}
