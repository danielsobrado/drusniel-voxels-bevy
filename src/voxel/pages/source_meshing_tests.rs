use super::*;

fn export(position: IVec3) -> TerrainMainSurfaceExport {
    TerrainMainSurfaceExport {
        local_positions: Vec::new(),
        normals: Vec::new(),
        material_weights: Vec::new(),
        paint_slots: Vec::new(),
        indices: Vec::new(),
        chunk_pos: position,
        lod: LodLevel::Lod0,
        revision: 1,
    }
}

#[test]
fn source_anchor_changes_only_at_page_boundaries() {
    assert_eq!(
        source_anchor_chunk(IVec3::new(0, 5, 0), 4),
        IVec3::new(2, 0, 2)
    );
    assert_eq!(
        source_anchor_chunk(IVec3::new(3, 9, 3), 4),
        IVec3::new(2, 0, 2)
    );
    assert_eq!(
        source_anchor_chunk(IVec3::new(4, 9, 4), 4),
        IVec3::new(6, 0, 6)
    );
    assert_eq!(
        source_anchor_chunk(IVec3::new(-1, 9, -1), 4),
        IVec3::new(-2, 0, -2)
    );
}

#[test]
fn source_queue_includes_near_chunks_and_skips_cached_or_out_of_radius_chunks() {
    let cached = IVec3::new(3, 0, 0);
    let exports = [(cached, export(cached))].into_iter().collect();
    let positions = vec![
        IVec3::new(1, 0, 0),
        IVec3::new(2, 0, 0),
        cached,
        IVec3::new(4, 0, 0),
        IVec3::new(5, 0, 0),
    ];

    let queued = source_positions_within_radius(
        positions.into_iter(),
        &exports,
        IVec3::ZERO,
        0,
        10,
        4,
        4,
    );

    assert_eq!(
        queued,
        vec![
            IVec3::new(1, 0, 0),
            IVec3::new(2, 0, 0),
            IVec3::new(4, 0, 0),
        ]
    );
}

#[test]
fn visible_page_sources_are_prioritized_before_hidden_near_pages() {
    let positions = vec![
        IVec3::new(0, 0, 0),
        IVec3::new(8, 0, 0),
        IVec3::new(1, 0, 0),
        IVec3::new(9, 0, 0),
    ];

    let queued = source_positions_within_radius(
        positions.into_iter(),
        &HashMap::new(),
        IVec3::ZERO,
        0,
        6,
        12,
        4,
    );

    assert_eq!(
        queued,
        vec![
            IVec3::new(8, 0, 0),
            IVec3::new(9, 0, 0),
            IVec3::new(0, 0, 0),
            IVec3::new(1, 0, 0),
        ]
    );
}

#[test]
fn source_queue_groups_chunks_by_page_before_vertical_order() {
    let positions = vec![
        IVec3::new(8, 5, 0),
        IVec3::new(4, 8, 0),
        IVec3::new(8, 1, 0),
        IVec3::new(4, 1, 0),
    ];

    let queued = source_positions_within_radius(
        positions.into_iter(),
        &HashMap::new(),
        IVec3::ZERO,
        0,
        0,
        16,
        4,
    );

    assert_eq!(
        queued,
        vec![
            IVec3::new(4, 1, 0),
            IVec3::new(4, 8, 0),
            IVec3::new(8, 1, 0),
            IVec3::new(8, 5, 0),
        ]
    );
}

#[test]
fn empty_queue_rescans_only_after_cooldown() {
    let mut queue = PageSourceMeshingQueue::default();
    queue.source_anchor = Some(IVec3::ZERO);
    queue.world_chunk_count = 10;
    let mut schedule = SourceMeshingSchedule {
        queue_rescan_in_frames: 2,
        ..Default::default()
    };

    assert!(!should_refresh_queue(
        &queue,
        IVec3::ZERO,
        10,
        false,
        &mut schedule,
    ));
    assert!(!should_refresh_queue(
        &queue,
        IVec3::ZERO,
        10,
        false,
        &mut schedule,
    ));
    assert!(should_refresh_queue(
        &queue,
        IVec3::ZERO,
        10,
        false,
        &mut schedule,
    ));
}

#[test]
fn invalidation_bypasses_queue_rescan_cooldown() {
    let mut queue = PageSourceMeshingQueue::default();
    queue.source_anchor = Some(IVec3::ZERO);
    queue.world_chunk_count = 10;
    let mut schedule = SourceMeshingSchedule {
        queue_rescan_in_frames: 20,
        ..Default::default()
    };

    assert!(should_refresh_queue(
        &queue,
        IVec3::ZERO,
        10,
        true,
        &mut schedule,
    ));
}

#[test]
fn source_meshing_uses_all_lod0_neighbors() {
    let neighbors = all_lod0_neighbors();
    assert_eq!(neighbors.neg_x, Some(LodLevel::Lod0));
    assert_eq!(neighbors.pos_x, Some(LodLevel::Lod0));
    assert_eq!(neighbors.neg_y, Some(LodLevel::Lod0));
    assert_eq!(neighbors.pos_y, Some(LodLevel::Lod0));
    assert_eq!(neighbors.neg_z, Some(LodLevel::Lod0));
    assert_eq!(neighbors.pos_z, Some(LodLevel::Lod0));
}
