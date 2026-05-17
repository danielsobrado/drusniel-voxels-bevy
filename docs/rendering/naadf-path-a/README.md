# NAADF Path A — NAADF as a GI Lighting Backend

Status: implemented; release gate not passed for default promotion
Last reviewed: 2026-05-16
Scope: route selected radiance-cascade GI queries through NAADF traversal
instead of the current SDF volume, while keeping the legacy mesh renderer as
the thing that draws the screen.

## What Path A is

The legacy mesh renderer keeps drawing the visible game (terrain, water,
props, grass, PBR). NAADF traversal only answers the *lighting* questions
behind it: sun visibility, contact shadows, terrain ambient occlusion, and
indirect bounce. The screen still looks like the legacy game, lit by NAADF.

This is the realistic near-term use of NAADF for this project. It is **not**
Path B (NAADF as the primary renderer).

## What Path A delivers — honest framing

- The SDF path samples a fixed-resolution 3D texture: cheap per ray, bounded
  extent, blurry. NAADF traversal is a DDA loop: likely **not faster per
  ray**, but covers the whole streamed world at full voxel resolution.
- Path A's win is **GI correctness and range**, at a target of
  **perf-neutral** — not "the game runs faster".
- The only real performance upside is Phase 7: if NAADF covers every GI query
  well, the SDF volume build pass can be dropped. That is a measured
  opportunity, not a promised result.

Do not claim a performance improvement at any phase without before/after
`summary.json` evidence. See repository `CLAUDE.md`.

## The integration seam already exists

`assets/shaders/radiance_cascades.wgsl` already carries the backend routing:

- `voxel_backend` (`GI_BACKEND_CURRENT_SDF` / `GI_BACKEND_NAADF`)
- `voxel_backend_query_mask` and `use_naadf_for_query()`
- `trace_gi_backend()`, `soft_shadow_backend()`, `terrain_ao_backend()`
- `trace_naadf_gi_unavailable()` — the deliberate stub Path A replaces

`src/rendering/radiance_cascades.rs` already carries the gate:

- `apply_radiance_backend_selection_with_shader_support()`
- `naadf_gi_shader_backend_available()` — forces SDF until buffers are bound
- Query mask constants for GI secondary, sun visibility, terrain AO, contact
  shadow

Path A fills in that stub. It does not invent new architecture.

## Phases

| Phase | File | Outcome |
| --- | --- | --- |
| 0 | [phase-0-baseline-and-audit.md](phase-0-baseline-and-audit.md) | SDF GI baseline archived; coordinate space confirmed |
| 1 | [phase-1-shared-world-trace.md](phase-1-shared-world-trace.md) | One reusable `trace_naadf_world` WGSL function |
| 2 | [phase-2-bind-naadf-buffers.md](phase-2-bind-naadf-buffers.md) | NAADF buffers bound into the cascade pipeline |
| 3 | [phase-3-sun-visibility-query.md](phase-3-sun-visibility-query.md) | Sun-visibility / soft shadow traces NAADF |
| 4 | [phase-4-validate-sun-visibility.md](phase-4-validate-sun-visibility.md) | Decision gate on the sun-visibility result |
| 5 | [phase-5-contact-shadows-and-ao.md](phase-5-contact-shadows-and-ao.md) | Contact shadow + terrain AO on NAADF |
| 6 | [phase-6-indirect-gi.md](phase-6-indirect-gi.md) | Implemented: indirect GI secondary rays on NAADF; default blocked by active-pass perf |
| 7 | [phase-7-defaults-and-release-gate.md](phase-7-defaults-and-release-gate.md) | Completed review: release gate assessed; defaults remain opt-in |

## Completion Summary

Path A is implemented behind explicit NAADF query toggles. The legacy renderer
still draws the frame and remains the default path when NAADF is not selected.
The active render-app pass is registered and bench-visible, but the default
promotion gate did not pass because the active GI/all-query path is not yet
perf-neutral.

The release evidence is recorded in
[`../naadf-release-gate.md`](../naadf-release-gate.md).

## Conventions

- Every phase keeps the SDF backend as the fallback for cache warming, stale
  cache, and integrated-GPU. The SDF GI path is never removed.
- Every phase that can affect frame time is verified with the project bench
  workflow before it is called done.
- One query class is wired at a time. Do not route every query at once.
- Phase 4 is a real stop point. If the numbers do not justify NAADF, the plan
  ends there rather than forcing the remaining phases.

## Non-goals

- Making NAADF the primary renderer (that is Path B).
- Removing the SDF GI fallback.
- Claiming the game runs faster before Phase 7 measurements exist.
