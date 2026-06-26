use super::world_shape::{CoastSurfaceClass, OceanClass, WorldShapeSample};

const TREE_COAST_CLEARANCE_M: f32 = 12.0;
const GRASS_COAST_CLEARANCE_M: f32 = 2.0;
const STONE_COAST_RING_WIDTH_M: f32 = 18.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlacementKind {
    Grass,
    Tree,
    Stone,
    CoastalStone,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlacementRejectReason {
    Underwater,
    Beach,
    Cliff,
    TooCloseToCoast,
    OutsideCoastalRing,
}

pub fn placement_rejection(
    sample: &WorldShapeSample,
    kind: PlacementKind,
) -> Option<PlacementRejectReason> {
    if matches!(
        sample.ocean_class,
        OceanClass::DeepSea | OceanClass::ShelfSea | OceanClass::Coast
    ) {
        return Some(PlacementRejectReason::Underwater);
    }

    match kind {
        PlacementKind::Grass => grass_rejection(sample),
        PlacementKind::Tree => tree_rejection(sample),
        PlacementKind::Stone => stone_rejection(sample),
        PlacementKind::CoastalStone => coastal_stone_rejection(sample),
    }
}

pub fn can_place(sample: &WorldShapeSample, kind: PlacementKind) -> bool {
    placement_rejection(sample, kind).is_none()
}

fn grass_rejection(sample: &WorldShapeSample) -> Option<PlacementRejectReason> {
    match sample.coast_surface {
        CoastSurfaceClass::BeachSand => Some(PlacementRejectReason::Beach),
        CoastSurfaceClass::CoastalCliff => Some(PlacementRejectReason::Cliff),
        _ if sample.coast_distance_m < GRASS_COAST_CLEARANCE_M => {
            Some(PlacementRejectReason::TooCloseToCoast)
        }
        _ => None,
    }
}

fn tree_rejection(sample: &WorldShapeSample) -> Option<PlacementRejectReason> {
    match sample.coast_surface {
        CoastSurfaceClass::BeachSand => Some(PlacementRejectReason::Beach),
        CoastSurfaceClass::CoastalCliff => Some(PlacementRejectReason::Cliff),
        _ if sample.coast_distance_m < TREE_COAST_CLEARANCE_M => {
            Some(PlacementRejectReason::TooCloseToCoast)
        }
        _ => None,
    }
}

fn stone_rejection(sample: &WorldShapeSample) -> Option<PlacementRejectReason> {
    match sample.coast_surface {
        CoastSurfaceClass::BeachSand => Some(PlacementRejectReason::Beach),
        _ => None,
    }
}

fn coastal_stone_rejection(sample: &WorldShapeSample) -> Option<PlacementRejectReason> {
    match sample.coast_surface {
        CoastSurfaceClass::BeachSand | CoastSurfaceClass::CoastalCliff => None,
        _ if sample.coast_distance_m <= STONE_COAST_RING_WIDTH_M => None,
        _ => Some(PlacementRejectReason::OutsideCoastalRing),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terrain::generation::{BiomeHint, WorldShapeSample};

    fn sample(ocean_class: OceanClass, coast_surface: CoastSurfaceClass, coast_distance_m: f32) -> WorldShapeSample {
        WorldShapeSample {
            continental: 0.0,
            island: 0.0,
            land_mask: 0.0,
            coast_distance_m,
            base_elevation: 0.0,
            ocean_class,
            coast_surface,
            biome_hint: BiomeHint::Lowland,
        }
    }

    #[test]
    fn underwater_rejects_all_placement() {
        let sample = sample(OceanClass::ShelfSea, CoastSurfaceClass::ShelfSeaFloor, -80.0);

        assert_eq!(
            placement_rejection(&sample, PlacementKind::Tree),
            Some(PlacementRejectReason::Underwater)
        );
    }

    #[test]
    fn trees_reject_beach_and_near_coast() {
        let beach = sample(OceanClass::Beach, CoastSurfaceClass::BeachSand, 20.0);
        let near = sample(OceanClass::Land, CoastSurfaceClass::Inland, 4.0);
        let inland = sample(OceanClass::Land, CoastSurfaceClass::Inland, 80.0);

        assert_eq!(
            placement_rejection(&beach, PlacementKind::Tree),
            Some(PlacementRejectReason::Beach)
        );
        assert_eq!(
            placement_rejection(&near, PlacementKind::Tree),
            Some(PlacementRejectReason::TooCloseToCoast)
        );
        assert!(can_place(&inland, PlacementKind::Tree));
    }
}
