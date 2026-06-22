use std::path::Path;

use serde::Serialize;

use super::field::VisualHydrologyField;
use crate::voxel::terrain::GeneratedWaterBodyKind;

#[derive(Serialize)]
struct VisualHydrologyDebugDump {
    resolution: usize,
    far_resolution: usize,
    world_min: [f32; 2],
    world_size: [f32; 2],
    cell_size: [f32; 2],
    wet_cells: usize,
    river_cells: usize,
    max_river_depth: f32,
    max_flow_strength: f32,
    body_counts: BodyKindCounts,
}

#[derive(Default, Serialize)]
struct BodyKindCounts {
    ocean: usize,
    lake_basin: usize,
    river_channel: usize,
    pond: usize,
    cave_water_aquifer: usize,
    none: usize,
}

pub fn write_visual_hydrology_debug_dump(
    field: &VisualHydrologyField,
    path: impl AsRef<Path>,
) -> Result<(), Box<dyn std::error::Error>> {
    let dump = summarize(field);
    let file = std::fs::File::create(path)?;
    serde_json::to_writer_pretty(file, &dump)?;
    Ok(())
}

fn summarize(field: &VisualHydrologyField) -> VisualHydrologyDebugDump {
    let mut body_counts = BodyKindCounts::default();
    for kind in &field.body_kind {
        match kind {
            GeneratedWaterBodyKind::Ocean => body_counts.ocean += 1,
            GeneratedWaterBodyKind::LakeBasin => body_counts.lake_basin += 1,
            GeneratedWaterBodyKind::RiverChannel => body_counts.river_channel += 1,
            GeneratedWaterBodyKind::Pond => body_counts.pond += 1,
            GeneratedWaterBodyKind::CaveWaterAquifer => body_counts.cave_water_aquifer += 1,
            GeneratedWaterBodyKind::None => body_counts.none += 1,
        }
    }

    VisualHydrologyDebugDump {
        resolution: field.metadata.resolution,
        far_resolution: field.metadata.far_resolution,
        world_min: field.metadata.world_min.to_array(),
        world_size: field.metadata.world_size.to_array(),
        cell_size: field.metadata.cell_size.to_array(),
        wet_cells: field.wet_mask.iter().filter(|mask| **mask > 0).count(),
        river_cells: field
            .body_kind
            .iter()
            .filter(|kind| **kind == GeneratedWaterBodyKind::RiverChannel)
            .count(),
        max_river_depth: field.river_depth.iter().copied().fold(0.0, f32::max),
        max_flow_strength: field.flow_strength.iter().copied().fold(0.0, f32::max),
        body_counts,
    }
}
