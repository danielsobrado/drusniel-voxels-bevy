# Lighting cache findings — open items and future refinements

Status snapshot (July 2026) of known issues in the lighting cache paths that
were **not** fixed by the far sun-visibility invalidation rework
(`3e7e6383`, merged as `60fc3675`). That change made sun-light cache entries
keyed by `tile|sunBin` with explicit region-scoped invalidation driven by new
voxel-edit deltas, kept the pending queue and non-intersecting in-progress
builds alive across invalidations, cancelled superseded sun-bin builds, and
gated GPU atlas repacks on a content revision. Everything below is what
remains.

Findings are split by confidence: the first group was verified against the
code in this repo; the second group comes from an external review of `main`
(commit `5ee4b470`) and has **not** been independently verified — treat each
item as a lead to confirm before acting on it.

## Verified open findings (far sun-visibility cache)

### 1. The height provider is edit-blind

`src/terrain/sun_visibility/far_light_height.ts` samples the startup-baked
`TerrainSummaryField.heightMax` array plus the analytic sampler. Neither
reflects dig/voxel edits, so even a correctly scoped post-dig rebuild
reproduces pre-edit visibility. The invalidation plumbing is now in place, but
it invalidates toward a data source that never changes.

**Refinement:** give the light height provider an edit-aware contract — either
update the summary `heightMax` in edited cells when edits commit, or overlay
voxel-edit heights in `heightAt()` (mind the allocation-free hot-loop
constraint documented in that file). Do not use a revision from one data
source while reading heights from another.

### 2. `createLightUpdate()` ignores its `options` argument

`src/terrain/sun_visibility/light_update.ts` accepts `args.options` but
reloads the bundled YAML and applies URL overrides internally.
`frame_loop_startup.ts` builds and passes a parsed options object that is
silently discarded.

**Caution:** the naive fix regresses — the startup object carries only
`active`/`diagnostics`/`debug_view`, so honoring it directly would replace the
bundled YAML tile/ray/build values with defaults. The fix needs merge
semantics (supplied options override the bundled config per field), plus a
test that bundled `tile`/`ray` values survive.

### 3. `keep_last_known` is not actually implemented

`cache.keepLastKnown` only changes the *pending* fallback value (0.5 vs 1) in
`light_cache_core.ts`. Invalidation deletes entries immediately, so an
invalidated tile reads as neutral until its rebuild lands; there is no
stale-until-replaced retention. Relatedly, the `staleTiles` set in
`far_light_cache_runtime.ts` is declared and reported in stats but never
populated — it is vestigial.

**Refinement:** keep the previous tile as an explicit stale entry and serve it
until the replacement finishes (exact current tile → stale tile → neutral).
Either implement `staleTiles` as part of that or remove it. Low urgency while
finding 1 stands, because the "stale" tile and its rebuild currently contain
identical data.

### 4. Atlas packing mixes sun bins and always does a full repack

`cache.tiles()` returns every retained entry, including tiles built for
superseded sun bins, and `updateSunLightGpuAtlas()` packs whichever it is
given — so the atlas can hold a mixture of old-bin and current-bin tiles while
the sun moves. Repacks are also always full-surface (544×544 alloc + full
upload); the content-revision guard makes them rare, but each one still packs
every tile.

**Refinement:** select tiles deterministically for the current bin (with the
stale fallback from finding 3), and move to a persistent atlas buffer with
dirty tile rects / subtexture uploads if repack cost ever shows up in
profiles.

### 5. Region invalidation reach is isotropic

`invalidateRegions()` expands tile bounds by `ray.maxDistanceWorld` (2048 m)
in every direction, so a dig near the camera invalidates the entire 17×17
material window — correct but maximally conservative. Occlusion only travels
down-sun: a receiver is affected only if the edit lies within reach along the
ray from the receiver *toward* the sun.

**Refinement:** per sun bin, restrict invalidation to the down-sun corridor
from the changed region. Cheap win for terraforming responsiveness; irrelevant
until finding 1 makes edit rebuilds meaningful.

## External review findings — unverified, other lighting subsystems

From an external review of `main@5ee4b470`. File pointers are the review's
claims; verify each before implementing.

### Forest lighting

- **Field is world-mapped, not camera-centred** (claimed critical for
  infinite islands): `ForestLightingSystem` populates its field from the
  camera-centred tree ring but maps UVs as `worldPos / worldCells` clamped to
  [0,1], so areas outside the local proxy ring go empty, out-of-world
  coordinates clamp to border texels, and one 128² texel covers ~32 m in a
  4096 m world (canopy influence is 7.5 m). Suggested fix: explicit
  origin/extent uniforms for a local field, ideally a toroidal texture with
  strip updates.
- **Tree lighting-proxy builds may never converge while walking**: the proxy
  cache keys on the centre quantized to one tree-ring cell and rejects a
  finished build if the requested key moved on, so steady movement can discard
  every build. Suggested fix: separate desired/build centres, accept results
  within a staleness distance, snap to the lighting-field cell size, and count
  `discardedBuilds`/`discardedBuildMs`.
- **The 2 ms budget excludes the commit path**: completion packs the full
  field into two RGBA textures, scans four float arrays for maxima, and
  updates materials outside the budget; understory proxy collection is
  synchronous and allocates per visible instance. Suggested fix: make
  packing/commit resumable phases and split the timing counters.
- **Scratch allocations and blur cost**: `blurredCanopy`/`shadow`
  `Float32Array`s are reallocated per rebuild and the blur calls
  `Math.hypot()` per cell per kernel tap. Suggested fix: persistent scratch
  buffers, precomputed kernel weights or a separable blur.
- **Shader-only GUI settings trigger full field rebuilds**: forest-lighting
  controls use `onChange()`, and `applySettings()` cancels and restarts the
  whole build even for AO/shadow/fog-strength/debug settings that only need
  uniform updates. Suggested fix: split structural vs shader-only settings and
  use `onFinishChange()` for structural ones.
- **`maxUpdatePagesPerFrame` is parsed but unused** — remove it or implement
  actual page budgeting.

### Other

- **Per-frame lighting state cloning**: both sky implementations allocate new
  vectors/colours on every `lighting()` call, and multiple frame phases each
  call it. Suggested fix: one immutable lighting snapshot per frame.
- **Shadow-proxy builds chase obsolete centres**: an active job may run up to
  30 s before being considered stale and finishes the old centre before
  starting the latest one. Suggested fix: the same overlap-window strategy as
  the tree proxies (finish while the player is in the safe region, cancel on
  exit, coalesce to the latest snapped centre, count wasted build time).

## Suggested counters (from the review, curated)

Worth adding when working in these areas, so productive vs discarded time is
visible:

```text
forestLighting.proxyBuildDiscards / proxyDiscardedMs
forestLighting.packMs / commitMs / uploadBytes
sunLight.atlasPackMs / atlasUploadBytes / atlasNoOpFrames
sunLight.canceledSunBinBuilds
sunLight.staleTileHits
sunLight.globalInvalidations / localInvalidations
```

Acceptance conditions the counters should demonstrate:

```text
No forest-lighting build is discarded repeatedly during steady movement.
No atlas upload occurs when no tile or atlas origin changed.   (done)
One local terrain edit does not clear the full cache.          (done)
Reported budgets include proxy collection, packing and commit.
Infinite-world coordinates never clamp to a shared border texel.
```

## Live verification hooks (sun-visibility)

- `window.__drusnielSunLightStats()` — entries / pendingTiles / refreshes
  (`refreshes` counts only full wipes; region invalidation does not bump it).
- `window.__drusnielSunLightOptions` — live-mutable; raising
  `build.maxBuildMsPerFrame` accelerates drain checks (reload resets it).
- Spurious-bump repro (must NOT reset the cache):
  `import("/src/terrain/terrain_edits.ts").then(m => m.replaceVoxelEdits(m.getVoxelEditSnapshot()))`.
