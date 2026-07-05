type JsonRecord = Record<string, unknown>;

type CounterMap = Record<string, number>;

function countersFromStats(stats: JsonRecord): CounterMap {
  return (stats["counters"] as CounterMap | undefined) ?? {};
}

export function buildInfiniteQaSummary(scene: string, stats: JsonRecord): JsonRecord {
  const counters = countersFromStats(stats);
  return {
    schema_version: 1,
    scene,
    platform: "web",
    checkpoints: [{
      name: "main",
      median_frame_ms: counters["frame_ms_avg"] ?? stats["frameMs"] ?? 0,
      p95_frame_ms: counters["frame_ms_p95"] ?? stats["frameMsP95"] ?? 0,
      p99_frame_ms: counters["frame_ms_p99"] ?? 0,
      areas: {
        renderer: {
          draw_calls: counters["draw_calls"] ?? stats["drawCalls"] ?? 0,
          triangles: counters["total_scene_tris"] ?? stats["triangles"] ?? 0,
        },
        clod: {
          radius_m: counters["streamer_clod_radius_m"] ?? 0,
          terrain_draw_calls: counters["terrain_draw_calls"] ?? 0,
          terrain_triangles: counters["rendered_terrain_tris"] ?? 0,
          ring_boundary_holes: counters["ring_boundary_holes"] ?? 0,
          live_clod_gap_holes: counters["live_clod_gap_holes"] ?? 0,
          clod_far_gap_holes: counters["clod_far_gap_holes"] ?? 0,
          priority_owner_overlap_cells: counters["priority_owner_overlap_cells"] ?? 0,
          priority_unowned_cells: counters["priority_unowned_cells"] ?? 0,
          missing_live_chunks_in_required_radius: counters["missing_live_chunks_in_required_radius"] ?? 0,
          missing_clod_pages_in_required_radius: counters["missing_clod_pages_in_required_radius"] ?? 0,
        },
        live_bubble: {
          required_pages: counters["live_bubble_required_pages"] ?? 0,
          ready_pages: counters["live_bubble_ready_pages"] ?? 0,
          building_pages: counters["live_bubble_building_pages"] ?? 0,
          failed_pages: counters["live_bubble_failed_pages"] ?? 0,
          cached_pages: counters["live_bubble_cached_pages"] ?? 0,
          streamed_collider_pages: counters["live_bubble_streamed_collider_pages"] ?? 0,
          collider_registrations: counters["live_bubble_collider_registrations"] ?? 0,
          collider_removals: counters["live_bubble_collider_removals"] ?? 0,
          max_inflight_chunks: counters["live_bubble_max_inflight_chunks"] ?? 0,
        },
        live_clod_stream: {
          radius_m: counters["live_clod_stream_radius_m"] ?? 0,
          required_pages: counters["live_clod_stream_required_pages"] ?? 0,
          cached_pages: counters["live_clod_stream_cached_pages"] ?? 0,
          max_cached_pages: counters["live_clod_stream_max_cached_pages"] ?? 0,
          max_inflight_batches: counters["live_clod_stream_max_inflight_batches"] ?? 0,
          safety_cache_capacity_ok: counters["live_clod_stream_safety_cache_capacity_ok"] ?? 0,
          active_root_pages: counters["live_clod_stream_active_root_pages"] ?? 0,
          safety_required_pages: counters["live_clod_stream_safety_required_pages"] ?? 0,
          safety_ready_pages: counters["live_clod_stream_safety_ready_pages"] ?? 0,
          safety_pending_pages: counters["live_clod_stream_safety_pending_pages"] ?? 0,
          safety_inflight_pages: counters["live_clod_stream_safety_inflight_pages"] ?? 0,
          refinement_pending_pages: counters["live_clod_stream_refinement_pending_pages"] ?? 0,
          refinement_inflight_pages: counters["live_clod_stream_refinement_inflight_pages"] ?? 0,
          parent_coverage_violations: counters["live_clod_stream_parent_coverage_violations"] ?? 0,
          built_this_frame: counters["live_clod_stream_built_this_frame"] ?? 0,
          failed_pages: counters["live_clod_stream_failed_pages"] ?? 0,
          evictions: counters["live_clod_stream_evictions"] ?? 0,
          build_ms: counters["live_clod_stream_build_ms"] ?? 0,
        },
        vegetation_ring: {
          unbounded: counters["vegetation_ring_unbounded"] ?? 0,
          center_x: counters["vegetation_ring_center_x"] ?? 0,
          center_z: counters["vegetation_ring_center_z"] ?? 0,
          grass_center_x: counters["vegetation_grass_center_x"] ?? 0,
          grass_center_z: counters["vegetation_grass_center_z"] ?? 0,
          distance_to_grass_m: counters["vegetation_ring_distance_to_grass_m"] ?? 0,
        },
        hydrology: {
          outside_sample_valid: counters["infinite_hydrology_outside_sample_valid"] ?? 0,
          outside_body_mask: counters["infinite_hydrology_outside_body_mask"] ?? 0,
          outside_depth_m: counters["infinite_hydrology_outside_depth_m"] ?? 0,
          nonrepeat_delta: counters["infinite_hydrology_nonrepeat_delta"] ?? 0,
          nonrepeat_ok: counters["infinite_hydrology_nonrepeat_ok"] ?? 0,
          camera_outside_startup: counters["infinite_hydrology_camera_outside_startup"] ?? 0,
        },
        far_shell: {
          enabled: counters["far_shell_enabled"] ?? 0,
          triangles: counters["far_shell_tris"] ?? 0,
          radius_m: counters["far_shell_radius_m"] ?? 0,
          grid_res: counters["far_shell_grid_res"] ?? 0,
          ownership_ok: counters["streamer_far_shell_ownership_ok"] ?? 0,
        },
        far_summary: {
          required: counters["far_summary_tiles_required"] ?? 0,
          ready: counters["far_summary_tiles_ready"] ?? 0,
          missing: counters["far_summary_tiles_missing"] ?? 0,
          stale: counters["far_summary_tiles_stale"] ?? 0,
        },
      },
    }],
  };
}
