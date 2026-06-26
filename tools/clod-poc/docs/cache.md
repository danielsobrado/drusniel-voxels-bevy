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
- Safe as IndexedDB keys and future file path components

### Config hash includes

- Page size, chunk size, quadtree levels
- Simplifier target ratio/error, abandon ratio, weld epsilon, attribute weights
- Far terrain summary reduce factor

### Source hash / revision

PoC `sourceRevision` is derived from world seed, scene, world size, generator version, and dig revision. **TODO:** replace with real edit revision when edit invalidation exists.

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
4. **Manifest** — Tracks `storedBytes`, `lastAccessedUnixMs` for persistent eviction

## Integration

- **Worker build** (`clod_worker.ts`): per-node cache lookup before build; write after validation
- **Terrain summary** (`world_build_startup.ts`): cache load before `buildTerrainSummary`; stale summary kept visible when configured
- **Debug overlay**: top-right stats panel when `debug.expose_overlay_stats: true`

## How to clear cache

Debug overlay buttons:

- **Clear memory** — runtime LRU cache
- **Clear persistent** — IndexedDB + manifest (current implementation clears both layers)

Or delete the IndexedDB database `drusniel-clod-poc-cache` in browser devtools.

## Cold / warm validation

1. Start dev server: `npm --prefix tools/clod-poc run dev -- --host 127.0.0.1`
2. Open `http://127.0.0.1:5180/?world=8` (first run = cold cache)
3. Reload the same URL (second run = warm cache)
4. Check debug overlay and console `[cache]` logs for hit rate, bytes read, decode ms
5. Compare build progress: warm run should skip most page mesh builds

Document your machine numbers in console via **Dump metrics** or:

```js
window.__drusnielClod?.stats // if wired
```

## Known limitations

- IndexedDB is browser persistence, not true filesystem I/O
- Worker and main thread each open the same DB (by design for PoC)
- Frame budget enforcement in the scheduler is approximate (see TODO in `cacheScheduler.ts`)
- Parent LOD nodes cached from children hashes use page coordinates only (no child mesh digest yet)
- No Vite/Node file backend yet

## Production port notes (Bevy/Rust)

- TODO: port cache schema to Bevy/Rust only after PoC acceptance passes
- TODO: add Vite file-cache backend after IndexedDB behavior is validated
- Keep CLOD invariants: stale pages visible until replacement ready; never build page LOD on frame path
- Use the same key format and `DCP1` binary sections for cross-platform artifact exchange
