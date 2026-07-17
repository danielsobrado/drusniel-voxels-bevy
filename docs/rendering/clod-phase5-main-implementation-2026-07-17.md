# CLOD Phase 5 — Bevy runtime integration

Date: 2026-07-17

Status: **implemented on `main`; native compile, runtime A/B, and headed visual evidence must be run locally**.

## Latest-main audit result

The repository already contained most of Phase 5:

- one ordinary Bevy mesh entity per page node;
- the existing triplanar terrain material;
- error-pixel selection, hysteresis, and 2:1 restricted cuts;
- binary live-chunk/page ownership at the near-field boundary;
- missing/failed-page fallback to live chunks;
- no page colliders.

The blocking gap was source production. The page cache only received opportunistic exports from live LOD0 meshes produced after initial generation. A normal completed world could therefore expose zero complete page columns and zero rendered CLOD nodes while the old guard still passed.

## Implementation landed

### Active LOD0 source meshing

`src/voxel/pages/source_meshing.rs` now builds clean LOD0 page inputs explicitly.

Properties:

- default-off with the existing `CLOD_PAGES=1` rollout flag;
- uses the same `generate_chunk_mesh_for_request` authority as live terrain;
- forces logical and mesh LOD0 with all six neighbours declared LOD0;
- exports only the solid main-surface section;
- never commits source meshes as render entities;
- never creates source or page colliders;
- limits synchronous source meshes with `CLOD_PAGES_SOURCE_MESH_BUDGET`;
- leaves page assembly, welding, simplification, and quadtree construction on the async compute pool.

Source generation covers the complete page-source radius, including near-field chunks. Near-field exclusion is applied only when selecting/rendering page nodes. This is required because a page column crossing the bubble boundary cannot be complete if individual near chunks are omitted.

### Scheduling

The source queue:

- groups chunks by page so the first complete page is available quickly;
- prioritizes page columns outside the live near-field bubble;
- later builds hidden near-field pages for camera movement and boundary completeness;
- prioritizes vertical chunks near the camera inside each page;
- rescans an empty queue at most once every 30 frames;
- refreshes complete-page snapshots under a separate bounded cadence;
- forces immediate refresh after camera/world changes or export invalidation.

### Diagnostics and guard

The CLOD selection CSV now adds:

```text
source_exports
complete_page_columns
source_pending_chunks
source_meshed_this_frame
source_failures_total
```

`clod_stats_guard` now rejects runs with:

- no source exports;
- no complete page columns;
- source-export failures;
- no indexed page nodes;
- no rendered pages.

Legacy CSV files remain parseable, but they provide zero source evidence and therefore cannot satisfy the current Phase 5 gate.

## Phase 5 requirement mapping

| Requirement | Runtime implementation |
|---|---|
| Plain mesh per quadtree node | Existing `src/voxel/pages/render.rs` path retained |
| Existing triplanar material | Existing terrain material handles retained |
| Selection + hysteresis + 2:1 | Existing `src/voxel/pages/selection.rs` path retained |
| Binary near-field ownership | Existing selection and ownership systems retained |
| Missing/stale fallback | Existing page mesh gate and chunk visibility fallback retained |
| No page colliders | Existing page entities remain render-only |
| Reliable page source production | Added bounded active LOD0 source meshing |
| Non-empty acceptance evidence | Added source counters and strict guard minima |

## Deliberate boundary

Phase 6 is not included here. Authoritative edit dirtiness, LOD0-first page rebuilds, ancestor invalidation, and debounce remain Phase 6 work. Phase 5 only guarantees safe fallback when a page is absent, failed, or unavailable.

## Manual verification

Run from the repository root after pulling `main`.

### 1. Format

```powershell
cargo fmt --all -- --check
```

### 2. Compile all binaries and tests

```powershell
cargo check --bins
cargo test --no-run
```

### 3. Focused tests

```powershell
cargo test voxel::pages::source_meshing
cargo test voxel::pages::runtime_stats_export
cargo test --bin clod_stats_guard
```

### 4. Phase 5 parity bench

```powershell
scripts/run-clod-parity-bench.ps1
```

The selection CSV must reach non-zero values for:

```text
source_exports
complete_page_columns
indexed_nodes
rendered_pages
```

`source_failures_total` must remain zero.

### 5. Complete CLOD QA

```powershell
scripts/run-clod-complete-qa.ps1
```

### 6. Headed A/B

Run the same representative camera route twice:

```powershell
$env:CLOD_PAGES = "0"
cargo run --release
```

```powershell
$env:CLOD_PAGES = "1"
$env:CLOD_PAGES_SOURCE_MESH_BUDGET = "4"
cargo run --release
```

Confirm:

- no live/page overlap at the bubble boundary;
- no missing terrain while source pages build;
- the live chunk fallback remains visible until a ready page cut owns the footprint;
- no page colliders appear outside the existing collider bubble;
- source meshing does not introduce unacceptable frame spikes.

Do not mark the performance or visual acceptance rows green until these native runs are recorded.
