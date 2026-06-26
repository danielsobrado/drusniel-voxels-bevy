# CLOD PoC Disk/Cache Streaming (Phase 9)

PoC-scoped persistent cache for generated CLOD page artifacts, terrain summary data, and far-view helper schemas. This validates cache keys, serialization, invalidation, compression, and lazy streaming in TypeScript/Three.js before any Bevy/Rust port.

**This is not production-ready.** It is a design validation step.

## What is cached

| Artifact kind | Contents |
|---------------|----------|
| `clod-page-node` | Positions, normals, paint slots, material weights, indices, error/bounds metadata |
| `clod-page-tree` | Page tree node ids, levels, child relationships |
| `terrain-summary` | Coarse height/normal/coverage grids for far shell |
| `far-shell-summary` | Schema supported; producer not wired yet |
| `shadow-proxy-summary` | Schema supported; producer not wired yet |
| `canopy-summary` | Schema supported; producer not wired yet |

## What is not cached

- Three.js `BufferGeometry`, materials, or meshes
- Final rendered objects
- UI/debug/camera state
- Near-field live editable terrain (pages remain derived caches only)

## Configuration

`config/clod_cache.yaml` drives all cache limits, backends, compression, and debug flags. No cache constants are hardcoded in application logic.

Disable for a session:

- URL: `?cache=0` or `?cache=false`
- Debug overlay: **Disable session** button
- YAML: `cache.enabled: false`

## Cache key fields

Keys are deterministic strings:

```text
<namespace>/<schemaVersion>/<builderVersion>/<artifactKind>/<worldSeed>/<generatorVersion>/<sourceRevision>/<configHash>/<sourceHash>/<pageX>_<pageZ>_lod<lod>_<nodeId>
```

- Undefined page fields become `_`
- Hashes are lowercase hex SHA-256
- Node ids are encoded as file-path-safe segments (`L1:2,3` → `L1-2-3`)
- Safe as IndexedDB keys and future file path components (Windows-safe)

### Config hash includes

- Page size, chunk size, quadtree levels
- Simplifier target ratio/error, abandon ratio, weld epsilon, attribute weights
- Far terrain summary reduce factor

### Source hash / revision

`terrainSourceHash` is computed from all terrain-affecting inputs:

- Scene (`?scene=`)
- World seed, world page count, generator version
- Dig edit revision
- Hydrology carved bed **full SHA-256** (when hydrology terrain is active)
- Border coast / ocean config hash
- Water enabled/source/carve/hydrology flags
- Procedural terrain enabled + seed/resolution fingerprint
- Staged import manifest hash including canonical terrain edit content digest (when importing a project)
- Long-view scene flag

This hash is used as both `sourceRevision` and `sourceHash` in cache keys. Changing any terrain-affecting input invalidates cached page nodes and terrain summaries.

**TODO:** replace PoC dig revision with production edit revision when edit invalidation exists.

## Invalidation

Cache misses (not errors) when:

- `schema_version` or `builder_version` changes
- Cache-relevant CLOD config changes (`configHash`)
- World seed or source revision changes
- Record checksum fails (logged as warning, treated as miss)
- Schema/header mismatch

## Architecture

1. **Memory cache** — LRU by item count and bytes; cleared on reload
2. **Persistent store** — IndexedDB default (`indexedDbStore.ts` only)
3. **Scheduler** — Read/write budgets per frame; avoids IndexedDB on hot path bursts
4. **Manifest** — In-memory LRU eviction tracker per cache service instance. **Not** persisted to IndexedDB. Worker startup hydrates manifest entries by scanning artifact keys (up to 256) via main-thread broker RPC. Main terrain-summary cache is memory-only; page artifacts use IndexedDB on the **main thread** broker (worker never opens IndexedDB directly).

## Integration

- **Worker build** (`clod_worker.ts`): per-node cache lookup before build; write after validation
- **Terrain summary** (`world_build_startup.ts`): cache load before `buildTerrainSummary`; stale summary kept visible when configured
- **Debug overlay**: top-right stats panel when `debug.expose_overlay_stats: true` — shows **main** (terrain summary) and **worker** (page nodes) metrics separately plus combined hit rate

## How to clear cache

Debug overlay buttons:

- **Clear memory** — main-thread runtime LRU cache only
- **Clear persistent** — clears main memory cache and worker IndexedDB artifacts (`drusniel-clod-poc-cache-pages`) via worker message

Or delete the IndexedDB database `drusniel-clod-poc-cache-pages-v2` in browser devtools.

## Cold / warm validation

1. Start dev server: `npm --prefix tools/clod-poc run dev -- --host 127.0.0.1`
2. Open `http://127.0.0.1:5180/?world=8` (first run = cold cache)
3. Reload the same URL (second run = warm cache)
4. Check debug overlay: worker section should show `nodes cached > 0` and `net saved > 0` on warm run
5. Compare console `[cache]` logs for hit rate, bytes read, decode ms, and `build avoided` ms

Example warm-run metrics to record (your machine):

| Metric | Cold (1st load) | Warm (reload) |
|--------|-----------------|---------------|
| Worker nodes cached | 0 | ~all LOD nodes |
| Worker net saved ms | 0 | > 0 |
| Worker decode ms | 0 | > 0 |
| Combined hit rate | ~0% | > 50% typical |

Document your numbers in console via **Dump metrics** after each run.

## Known limitations

- **Main-thread broker** (`drusniel-clod-poc-cache-pages-v2`): sole IndexedDB owner; CLOD worker uses RPC for get/put/clear
- **Main terrain summary**: memory cache only
- Eviction manifest is **memory-only**; IndexedDB manifest persistence was removed after worker `UnknownError` issues
- Frame budget enforcement in the scheduler is approximate (see TODO in `cacheScheduler.ts`)
- Warm-cache page nodes restore original `NodeBuildStat` from artifact metadata (`fromCache: true`)
- Warm-cache LOD0 pages omit `chunkMeshes`; first edit after load does one full page extract, then partial chunk remeshing
- No Vite/Node file backend yet

## Production port notes (Bevy/Rust)

- TODO: port cache schema to Bevy/Rust only after PoC acceptance passes
- TODO: add Vite file-cache backend after IndexedDB behavior is validated
- Keep CLOD invariants: stale pages visible until replacement ready; never build page LOD on frame path
- Use the same key format and `DCP1` binary sections for cross-platform artifact exchange
