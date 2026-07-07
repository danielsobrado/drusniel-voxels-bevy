# Streamed Page GPU Bounds Guard Plan

## Goal

Stop malformed streamed CLOD pages from becoming visible.

The current infinite-islands visual failure shows terrain, water, far shell, and vegetation sometimes landing in different world-space regions. Before moving more stabilization work to WebGPU, the streamed-page path needs a hard safety guard: every GPU/worker-built page must prove that its returned mesh lies inside the expected page footprint before the page is marked renderable.

This guard is a correctness and diagnosis layer. It is not the final fix for the source coordinate bug. It prevents bad generated pages from entering the render tree while counters and logs identify exactly which build path produced them.

## Non-goals

- Do not rewrite CLOD selection.
- Do not change far clipmap rendering.
- Do not remove CPU fallback.
- Do not accept partial GPU page success unless the scheduler already has explicit per-page success handling.
- Do not hide validation failures by weakening convergence or safety thresholds.
- Do not move CLOD correctness validation fully to WebGPU yet.

## Existing invariants to preserve

- `VoxelWorld` remains authoritative. Pages are derived caches.
- Page builds stay off the frame path.
- Stale pages stay visible until a replacement validates.
- Missing or invalid pages fall back to normal chunks or CPU worker fallback.
- Near-field player bubble remains live editable Surface Nets LOD0.
- No failed GPU page may be marked ready.
- WebGPU unavailable paths must keep working.

## Suspected failure class

The screenshots suggest page data is valid-looking locally but wrong globally. Typical causes:

1. mesh vertices returned in page-local space but inserted as world-space;
2. mesh vertices returned in world-space but translated again;
3. page key and page origin disagree;
4. root/page level scale is wrong;
5. finite startup-world origin is mixed with infinite-world origin;
6. orbit camera, player position, vegetation ring, far shell, and streamed-root build center use different centers.

A bounds guard catches the visible symptom independent of which cause is active.

## Page footprint model

Each page request must carry or derive an expected world-space footprint.

```ts
interface ExpectedPageFootprint {
  pageKey: string;
  level: number;
  originX: number;
  originZ: number;
  sizeX: number;
  sizeZ: number;
  minY: number;
  maxY: number;
  marginXz: number;
  marginY: number;
}
```

The X/Z footprint is strict enough to catch coordinate drift but includes a small margin for skirts, welding, and border vertices.

Initial constants:

```ts
const STREAMED_PAGE_XZ_MARGIN_CELLS = 2;
const STREAMED_PAGE_Y_MARGIN_M = 96;
const STREAMED_PAGE_MAX_REASONABLE_HEIGHT_M = 4096;
```

The Y range should not be used as aggressively as X/Z. For islands, mountains, volcanoes, waterlines, and edits can create high variance. X/Z is the primary guard.

## Guard rules

A streamed page is valid only if all of these pass:

```text
finite positions:        every xyz is finite
non-empty sanity:        empty pages allowed only if explicitly marked empty
index range:             every index < vertexCount
triangle sanity:         no NaN/Inf positions; degenerate count below threshold
xz bounds:               minX/maxX/minZ/maxZ inside expected footprint + margin
y bounds:                minY/maxY inside broad configured guard
centroid sanity:         centroid inside expected footprint + margin
extent sanity:           mesh extent is not larger than expected footprint + margin
world-origin sanity:     page key origin and mesh centroid agree
```

Failure means the page is not renderable.

## Where to validate

Validate at the last common point before page insertion, not deep in only one backend.

Recommended call sites:

1. CPU worker returned page nodes.
2. WebGPU streamed-root batch returned page nodes.
3. cache restore path before a cached streamed page is marked ready.
4. scheduler apply path before swapping page/root nodes into renderable state.

The final apply guard is mandatory even if earlier paths validate. Earlier validation gives better logs; final validation protects correctness.

## Files to inspect before implementation

```text
tools/clod-poc/src/terrain/streaming/clod_streaming_roots.ts
tools/clod-poc/src/terrain/streaming/gpu_clod_root_mesher.ts
tools/clod-poc/src/terrain/streaming/gpu_clod_root_batch_buffers.ts
tools/clod-poc/src/clod/quadtree.ts
tools/clod-poc/src/clod/source_mesh.ts
tools/clod-poc/src/clod/validate.ts
tools/clod-poc/src/clod_worker_client.ts
tools/clod-poc/src/runtime/clod_frame_loop.ts
tools/clod-poc/src/runtime/terrain_frame_phase.ts
```

## New module layout

Add a small validation module under streaming:

```text
tools/clod-poc/src/terrain/streaming/streamed_page_bounds_guard.ts
tools/clod-poc/src/terrain/streaming/streamed_page_bounds_guard.test.ts
```

Keep this module pure TypeScript logic. No Three.js, no WebGPU, no DOM.

## Proposed API

```ts
export interface StreamedPageBoundsGuardConfig {
  enabled: boolean;
  xzMarginCells: number;
  yMarginMeters: number;
  maxReasonableHeightMeters: number;
  rejectInvalid: boolean;
}

export interface StreamedPageFootprint {
  pageKey: string;
  level: number;
  originX: number;
  originZ: number;
  sizeX: number;
  sizeZ: number;
  minY: number;
  maxY: number;
}

export interface StreamedPageMeshBounds {
  vertexCount: number;
  indexCount: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  centroidX: number;
  centroidY: number;
  centroidZ: number;
}

export type StreamedPageBoundsRejectReason =
  | "disabled"
  | "ok"
  | "non_finite_position"
  | "index_out_of_range"
  | "unexpected_empty_mesh"
  | "degenerate_mesh"
  | "xz_out_of_bounds"
  | "y_out_of_bounds"
  | "centroid_out_of_bounds"
  | "extent_too_large"
  | "origin_mismatch";

export interface StreamedPageBoundsGuardResult {
  ok: boolean;
  reason: StreamedPageBoundsRejectReason;
  footprint: StreamedPageFootprint;
  bounds: StreamedPageMeshBounds;
  overflowX: number;
  overflowZ: number;
  overflowY: number;
}

export function validateStreamedPageBounds(
  mesh: PageMesh,
  footprint: StreamedPageFootprint,
  config: StreamedPageBoundsGuardConfig,
): StreamedPageBoundsGuardResult;
```

## Footprint derivation

Do not infer footprint from mesh vertices. Derive it from page/root identity.

The expected footprint should come from the same source used by scheduling:

```text
page key -> page level -> page world origin -> page size
```

Add one helper:

```ts
export function expectedFootprintForStreamedPage(
  pageKey: string,
  level: number,
  chunksPerPage: number,
  chunkSize: number,
): StreamedPageFootprint;
```

If existing code already has page key parsing, reuse it. Do not create a second incompatible parser.

## Failure behavior

Default behavior:

```text
invalid GPU batch page -> reject whole GPU batch -> CPU fallback for that batch
invalid CPU fallback page -> throw or keep page missing; do not mark ready
invalid cached page -> drop cache entry and rebuild
fallback disabled -> throw and fail acceptance
```

Do not render a partly valid root batch yet. Keeping all-or-nothing behavior keeps safety-page convergence simple.

## Counters

Add counters with clear names:

```text
live_clod_stream_bounds_guard_enabled
live_clod_stream_bounds_guard_checked_pages
live_clod_stream_bounds_guard_rejected_pages
live_clod_stream_bounds_guard_rejected_batches
live_clod_stream_bounds_guard_cache_drops
live_clod_stream_bounds_guard_cpu_fallback_pages
live_clod_stream_bounds_guard_max_overflow_xz
live_clod_stream_bounds_guard_max_overflow_y
live_clod_stream_bounds_guard_reason_non_finite_position
live_clod_stream_bounds_guard_reason_index_out_of_range
live_clod_stream_bounds_guard_reason_unexpected_empty_mesh
live_clod_stream_bounds_guard_reason_degenerate_mesh
live_clod_stream_bounds_guard_reason_xz_out_of_bounds
live_clod_stream_bounds_guard_reason_y_out_of_bounds
live_clod_stream_bounds_guard_reason_centroid_out_of_bounds
live_clod_stream_bounds_guard_reason_extent_too_large
live_clod_stream_bounds_guard_reason_origin_mismatch
```

Also expose last failure details for debug only:

```text
live_clod_stream_bounds_guard_last_page_key
live_clod_stream_bounds_guard_last_reason_code
live_clod_stream_bounds_guard_last_bounds_min_x
live_clod_stream_bounds_guard_last_bounds_max_x
live_clod_stream_bounds_guard_last_bounds_min_z
live_clod_stream_bounds_guard_last_bounds_max_z
live_clod_stream_bounds_guard_last_expected_min_x
live_clod_stream_bounds_guard_last_expected_max_x
live_clod_stream_bounds_guard_last_expected_min_z
live_clod_stream_bounds_guard_last_expected_max_z
```

Use numeric reason codes for perf JSON compatibility.

## Logging

Log one compact warning per rejected page, rate-limited:

```text
[clod-stream-bounds] rejected page=L0:34,31 reason=xz_out_of_bounds bounds=[...] expected=[...] overflow=768.0m backend=gpu
```

Do not spam every frame for the same page. Store the last rejected page/reason and suppress repeats for a short window.

## Configuration

Add config in the existing streamed-root runtime config path, not hard-coded in the validator:

```yaml
liveClodRootBoundsGuard: 1
liveClodRootBoundsGuardReject: 1
liveClodRootBoundsGuardXzMarginCells: 2
liveClodRootBoundsGuardYMargin: 96
liveClodRootBoundsGuardMaxHeight: 4096
```

URL overrides:

```text
liveClodRootBoundsGuard=0|1
liveClodRootBoundsGuardReject=0|1
```

`Reject=0` is debug-only. It may log bad pages while allowing rendering for diagnosis, but acceptance must run with rejection enabled.

## Implementation steps

### Step 1 — Pure validator

Create `streamed_page_bounds_guard.ts`.

Implement:

- bounds computation over positions;
- finite checks;
- index range checks;
- empty mesh handling;
- xz footprint checks;
- broad y checks;
- centroid and extent checks;
- reason-code mapping.

### Step 2 — Unit tests

Add tests for:

```text
valid page passes
page-local mesh inserted at origin fails for far page
world mesh translated twice fails by xz overflow
NaN vertex fails
Infinity vertex fails
index out of range fails
empty explicitly allowed page passes
unexpected empty page fails
slightly skirted border passes with margin
large stretched strip fails extent_too_large or xz_out_of_bounds
centroid outside footprint fails
Y mountain inside broad range passes
absurd Y fails
```

### Step 3 — Scheduler integration

Find the final page apply path in `clod_streaming_roots.ts`.

Before marking a page/root ready:

```ts
const guard = validateStreamedPageBounds(node.mesh, footprint, config.boundsGuard);
if (!guard.ok) {
  recordBoundsGuardFailure(guard, "apply");
  rejectPageOrBatch(...);
  return;
}
```

The apply guard is the critical safety layer.

### Step 4 — GPU batch integration

In `gpu_clod_root_mesher.ts`, validate all returned page nodes before returning success.

Rule:

```text
any page invalid -> GPU batch failure -> CPU fallback for all requested pages in the batch
```

This keeps the scheduler simple.

### Step 5 — CPU fallback integration

Validate CPU fallback pages too.

If CPU fallback generates invalid bounds, do not keep falling back forever. Report a hard failure. That means the issue is not WebGPU; it is page footprint/origin logic or source mesh construction.

### Step 6 — Cache integration

On cache restore:

```text
valid cached page -> use it
invalid cached page -> drop cache entry, increment cache_drops, rebuild page
```

Do not poison future runs with invalid streamed-root cache data.

### Step 7 — Debug overlay and stats

Add a small HUD/debug line:

```text
bounds guard: checked=N rejected=M last=reason page=key overflow=Xm
```

Keep it out of normal gameplay UI unless debug overlay is on.

### Step 8 — Acceptance hard checks

Add acceptance checks:

```text
live_clod_stream_bounds_guard_enabled = 1
live_clod_stream_bounds_guard_checked_pages > 0
live_clod_stream_bounds_guard_rejected_pages = 0
live_clod_stream_bounds_guard_rejected_batches = 0
live_clod_stream_bounds_guard_cache_drops = 0 after clean cache
```

For a temporary diagnosis run, allow rejected pages > 0 only if the test expects fallback and verifies no rejected page became renderable.

## Test commands

```bash
cd tools/clod-poc

npm run typecheck
npm test -- src/terrain/streaming/streamed_page_bounds_guard.test.ts
npm test -- src/terrain/streaming/gpu_clod_root_batch_mesher.test.ts
npm test -- tools/infinite_acceptance/thresholds.test.ts
npm test -- tools/infinite_acceptance/thresholds_validation.test.ts
npm test
npm run build
```

Manual visual test:

```bash
node tools/run-infinite-islands-acceptance.mjs --reuse --gate perf --scene biome-near
node tools/run-infinite-islands-acceptance.mjs --reuse --gate perf --scene walk
```

Manual populated URL should include:

```text
populatedPerf=1&liveClodRootBoundsGuard=1&liveClodRootBoundsGuardReject=1
```

## Expected outcomes

Short term:

```text
broken stretched pages stop appearing
bad cache entries are dropped
GPU page failures route to CPU fallback or hard fail safely
acceptance does not mark bad pages ready
counters identify reason and page key
```

Long term:

```text
once source coordinate bug is fixed, rejected_pages returns to zero
bounds guard remains as permanent regression protection
```

## Risks

### False positives on skirts or border welds

Mitigation: start with a small X/Z margin in cells, not zero. Keep a debug-only non-reject mode for diagnosis.

### Hiding the real coordinate bug

Mitigation: counters and logs must include expected vs actual bounds. The guard rejects bad output but does not silently repair it.

### CPU fallback loop

Mitigation: if GPU and CPU both fail the same page footprint, fail hard instead of retrying forever.

### Acceptance slowdown from logging

Mitigation: rate-limit repeated page/reason logs and store numeric counters.

## Follow-up after this guard

When a page is rejected, use the failure data to patch the actual source:

```text
origin_mismatch -> page key / origin derivation bug
xz_out_of_bounds with correct extent -> wrong transform space
extent_too_large -> bad indices, merged roots, or coordinate scale bug
centroid_out_of_bounds -> page inserted under wrong parent/root
cache drop only -> stale invalid cache format
```

After `rejected_pages = 0`, proceed to GPU far-summary build and GPU vegetation candidate rejection.
