# Occlusion Culling

Terrain occlusion culling is enclosure-gated. In open terrain, chunk mesh visibility is restored to `Visibility::Inherited` and the runtime does not run the BFS culler; normal terrain LOD and frustum paths remain responsible for open-world visibility.

The enclosure heuristic biases open for correctness. The camera chunk and its six face-neighbors must be loaded, the camera chunk face-connectivity mask must not be fully transparent, and an upward sky probe must remain blocked for `sky_probe_chunks`. Missing chunks, out-of-world sky, empty chunks, or vertical face connectivity in the probe return open. The detected mode must hold for `hysteresis_secs` of real elapsed time before the active mode switches; detection ticks at `update_interval_secs`.

Runtime traversal uses the chunk face-connectivity mask, a frustum gate dilated by `frustum_dilation_chunks` (verdicts cached per chunk per update), a directional guard that prevents a path from reversing an axis it has already traveled, and a depth budget computed from `LodSettings::cull_distance + depth_margin_chunks`. Because the result depends on the camera frustum (and therefore rotation), the BFS is recomputed every `update_interval_secs` tick while active — there is no caching across frames — and is recomputed immediately on the frame culling activates. BFS states are deduplicated by dominance per (chunk, entry face): a state is skipped when an already-expanded state at the same chunk and entry face used a subset of its travel directions. `max_visited_chunks` bounds **distinct chunks**; a separate cost ceiling of `8 × max_visited_chunks` bounds total states. Exceeding either fails open by setting a `fail_open` flag that makes every chunk count as visible (no allocation).

Activation state is derived, not stored: `OcclusionConfig::is_active(mode)` = `enabled && enclosure_gating_enabled && !force_disabled && mode == Enclosed`. All consumers (BFS update, chunk-mesh culler, prop culler) evaluate it against `EnclosureState` directly.

Prop visibility has a single owner: `update_prop_chunk_visibility` combines distance culling and, while active, terrain occlusion (keyed on `PropChunkOwner`), maintains the F3 prop cull counters, and owns instanced-group visibility. It bypasses its throttle for one frame when occlusion toggles so transitions apply immediately and hidden groups are restored on deactivation.

Face-connectivity masks are recomputed for dirty chunks at the `update_interval_secs` cadence (they are only consumed by the equally-throttled enclosure/BFS systems), gated on the master `enabled` switch since enclosure detection needs them even while culling is inactive.

Config lives in `assets/config/occlusion.yaml`, loaded through the shared `crate::config::loader::load_config` with serde defaults (missing keys fall back to `OcclusionConfig::default()`):

```yaml
occlusion:
  enabled: true
  update_interval_secs: 0.1
  depth_margin_chunks: 2
  max_visited_chunks: 8000
  frustum_dilation_chunks: 1
  enclosure:
    sky_probe_chunks: 8
    hysteresis_secs: 0.5
```

The F3 debug overlay shows enclosure mode, chunk/prop cull counts, BFS visited states, last BFS duration in microseconds, depth budget, and overflow state. `Shift+F11` force-disables enclosure culling for local comparison.

## Review findings and fixes (2026-06-11)

A 7-angle code review of the initial implementation against this spec surfaced ten issues; all were fixed and the suite passes (691 lib tests).

| # | Finding | Fix |
|---|---|---|
| 1 | BFS result was cached per camera chunk while the new frustum gate made it rotation-dependent — turning in place left terrain holes indefinitely. | Removed the `dirty`/`camera_chunk` cache; the BFS recomputes every `update_interval` tick while active. |
| 2 | Prop culling was split across two conflicting systems: the unthrottled occlusion pass force-unhid distance-culled props every frame (flicker, defeated distance culling, dual chunk keys). | Deleted `apply_prop_visibility_from_chunks`; `update_prop_chunk_visibility` is the sole owner of prop and instanced-group visibility, keyed on `PropChunkOwner`. |
| 3 | `max_visited_chunks` counted BFS *states* keyed on (chunk, entry face, direction mask) — overflow fired far below 8000 chunks, making culling silently fail open in large caverns. | Cap now counts distinct chunks; states are bounded by an 8× ceiling; dominance dedup (subset masks per chunk/face) collapses redundant states. |
| 4 | On activation, a stale or empty visible set was enforced for up to one interval (full-screen blackout flash on enclosure entry; stale set reuse after Shift+F11 flaps). | `Local<bool> was_active` forces an immediate recompute on the activation frame. |
| 5 | `visible.dirty` bypassed the 10Hz throttle — continuous digging or chunk streaming ran the full BFS at frame rate. | The dirty-flag machinery was removed entirely (superseded by fix 1's unconditional tick recompute). |
| 6 | Face-visibility system scanned the whole chunk map every frame once the YAML default flipped `enabled` to true. | Scan throttled to `update_interval_secs`; consumers run at the same cadence. |
| 7 | `update_octree_system` rebuilt `ChunkOctree` whenever active, but nothing consumed the octree. | System and resource removed (the `OctreeAabb`/`ViewFrustum` math the BFS uses remains). |
| 8 | Hysteresis counted fixed 0.1s ticks instead of wall time, and the YAML `update_interval_secs` did not drive the enclosure detector. | Detector ticks at `config.update_interval` and accumulates real elapsed seconds into `candidate_secs`. |
| 9 | `OcclusionConfig.active` was stored derived state with three writers and a duplicated gate expression. | Field deleted; `is_active(mode)` / `gating_allowed()` are derived methods; the sync system and toggle special-case are gone. |
| 10 | Config loading hand-rolled fs + serde_yaml with an `Option`-per-field merge ladder. | Uses the shared `config::loader::load_config` with `#[serde(default)]` mirror structs and a single clamp step. |

Smaller cleanups in the same pass: allocation-free fail-open (`fail_open` flag instead of collecting all chunk positions at 10Hz), consistent stats reset including `last_depth_budget`, single BFS depth guard, per-update frustum-verdict cache, pre-push dominance check, redundant `chunk_exists` removed in `is_camera_enclosed`, `FACE_NEIGHBORS` replaced with the shared `CHUNK_FACE_NEIGHBOR_OFFSETS`, and `debug_assert`s on the main-surface section-count invariant in `lod_seam.rs`.

Known spec-level limitations (intentional, by the open-bias rules above): a camera standing in an all-air chunk (cave rooms wider than one chunk) is never detected as Enclosed, and a position with blocked sky but a wide-open horizontal view (just inside a tunnel mouth under a hill) can flip to Enclosed.

**Benchmarks not yet run:** these changes touch frame-time-sensitive paths; before relying on perf claims, run the visual-regression bench scenes and compare `bench-runs/<run>/summary.json` per CLAUDE.md.
