use super::*;

pub(super) fn write_probe_dump(
    dump: &TerrainHoleProbeDump,
    timestamp: &str,
    output_label: Option<&str>,
) -> std::io::Result<PathBuf> {
    let dir = PathBuf::from("debug");
    fs::create_dir_all(&dir)?;
    let path = match output_label
        .map(sanitize_probe_label)
        .filter(|label| !label.is_empty())
    {
        Some(label) => dir.join(format!("terrain-hole-probe-{label}-{timestamp}.json")),
        None => dir.join(format!("terrain-hole-probe-{timestamp}.json")),
    };
    let json = serde_json::to_string_pretty(dump)?;
    fs::write(&path, json)?;
    Ok(path)
}

pub(super) fn sanitize_probe_label(label: &str) -> String {
    label
        .chars()
        .filter_map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                Some(ch)
            } else if ch.is_ascii_whitespace() {
                Some('-')
            } else {
                None
            }
        })
        .take(64)
        .collect()
}

pub(super) fn dirty_reason_names(flags: u8) -> Vec<String> {
    [
        (MeshDirtyReason::Lod, "LOD"),
        (MeshDirtyReason::NeighborLod, "NeighborLOD"),
        (MeshDirtyReason::Generation, "Generation"),
        (MeshDirtyReason::WaterMaterial, "WaterMaterial"),
        (MeshDirtyReason::TerrainMutation, "TerrainMutation"),
    ]
    .into_iter()
    .filter_map(|(reason, name)| ((flags & reason.bit()) != 0).then_some(name.to_string()))
    .collect()
}

pub(super) fn lod_name(lod: LodLevel) -> &'static str {
    match lod {
        LodLevel::Lod0 => "Lod0",
        LodLevel::Lod1 => "Lod1",
        LodLevel::Lod2 => "Lod2",
        LodLevel::Lod3 => "Lod3",
        LodLevel::Culled => "Culled",
    }
}

pub(super) fn lod_string(lod: LodLevel) -> String {
    lod_name(lod).to_string()
}

pub(super) fn mesh_mode_string(mode: MeshMode) -> String {
    format!("{mode:?}")
}

pub(super) fn neighbor_lods_probe(neighbor_lods: NeighborLods) -> NeighborLodsProbe {
    NeighborLodsProbe {
        neg_x: neighbor_lods.neg_x.map(lod_string),
        pos_x: neighbor_lods.pos_x.map(lod_string),
        neg_y: neighbor_lods.neg_y.map(lod_string),
        pos_y: neighbor_lods.pos_y.map(lod_string),
        neg_z: neighbor_lods.neg_z.map(lod_string),
        pos_z: neighbor_lods.pos_z.map(lod_string),
    }
}

pub(super) fn lod_transition_snap_stats_probe(
    stats: LodTransitionSnapStats,
) -> LodTransitionSnapStatsProbe {
    LodTransitionSnapStatsProbe {
        snapped_face_mask: stats.snapped_face_mask,
        fallback_face_mask: stats.fallback_face_mask,
        snapped_faces: face_mask_names(stats.snapped_face_mask),
        fallback_faces: face_mask_names(stats.fallback_face_mask),
        boundary_candidate_vertex_count: stats.boundary_candidate_vertex_count,
        morph_target_vertex_count: stats.morph_target_vertex_count,
        morph_missing_target_vertex_count: stats.morph_missing_target_vertex_count,
        snapped_vertex_count: stats.snapped_vertex_count,
        skipped_vertex_count: stats.skipped_vertex_count,
        conflicting_vertex_count: stats.conflicting_vertex_count,
    }
}

pub(super) fn mc_transvoxel_stats_probe(stats: McTransvoxelStats) -> McTransvoxelStatsProbe {
    McTransvoxelStatsProbe {
        regular_chunks_meshed: stats.regular_chunks_meshed,
        transition_faces_meshed: stats.transition_faces_meshed,
        transition_triangles_total: stats.transition_triangles_total,
        skipped_lod_delta_gt_one: stats.skipped_lod_delta_gt_one,
        skipped_missing_neighbor: stats.skipped_missing_neighbor,
        mesh_generation_ms_total: stats.mesh_generation_ms_total,
        triangle_count_regular: stats.triangle_count_regular,
        triangle_count_transition: stats.triangle_count_transition,
    }
}

pub(super) fn mesh_section_stats_probe(
    stats: TerrainMeshSectionStats,
) -> TerrainMeshSectionStatsProbe {
    TerrainMeshSectionStatsProbe {
        main_surface_vertex_count: stats.main_surface_vertex_count,
        main_surface_index_count: stats.main_surface_index_count,
        transition_apron_index_count: stats.transition_apron_index_count,
        vertical_skirt_index_count: stats.vertical_skirt_index_count,
    }
}

pub(super) fn face_mask_names(mask: u8) -> Vec<String> {
    [
        (0, "neg_x"),
        (1, "pos_x"),
        (2, "neg_y"),
        (3, "pos_y"),
        (4, "neg_z"),
        (5, "pos_z"),
    ]
    .into_iter()
    .filter_map(|(bit, name)| ((mask & (1 << bit)) != 0).then_some(name.to_string()))
    .collect()
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn face_mask_bit(face: ChunkFace) -> u8 {
    match face {
        ChunkFace::NegX => 0,
        ChunkFace::PosX => 1,
        ChunkFace::NegY => 2,
        ChunkFace::PosY => 3,
        ChunkFace::NegZ => 4,
        ChunkFace::PosZ => 5,
    }
}

pub(super) fn compare_chunk_pos_lex(a: IVec3, b: IVec3) -> std::cmp::Ordering {
    a.x.cmp(&b.x)
        .then_with(|| a.y.cmp(&b.y))
        .then_with(|| a.z.cmp(&b.z))
}

pub(super) fn uniformity_name(uniformity: ChunkUniformity) -> &'static str {
    match uniformity {
        ChunkUniformity::Unknown => "Unknown",
        ChunkUniformity::Empty => "Empty",
        ChunkUniformity::Solid => "Solid",
        ChunkUniformity::Mixed => "Mixed",
    }
}

pub(super) fn voxel_name(voxel: VoxelType) -> String {
    format!("{voxel:?}")
}

pub(super) fn boundary_sample_name(sample: BoundaryVoxelSample) -> Option<&'static str> {
    match sample {
        BoundaryVoxelSample::InBounds(_) => None,
        BoundaryVoxelSample::OutsideBelowWorld => Some("OutsideBelowWorld"),
        BoundaryVoxelSample::OutsideAboveWorld => Some("OutsideAboveWorld"),
        BoundaryVoxelSample::OutsideHorizontalWorld => Some("OutsideHorizontalWorld"),
        BoundaryVoxelSample::MissingChunkInsideBounds => Some("MissingChunkInsideBounds"),
    }
}

pub(super) fn timestamp_utc_compact() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default();
    let days = seconds.div_euclid(86_400);
    let seconds_of_day = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;
    format!("{year:04}{month:02}{day:02}-{hour:02}{minute:02}{second:02}")
}

pub(super) fn civil_from_days(days_since_unix_epoch: i64) -> (i32, u32, u32) {
    let z = days_since_unix_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if m <= 2 { 1 } else { 0 };
    (year as i32, m as u32, d as u32)
}
