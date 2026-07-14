# World Persistence Contract

Created: 2026-07-14

The continent runtime composes three independent feature layers. They must remain separate in
storage and deterministic in application order.

1. The environmental baseline is regenerated from the pinned `WorldManifest`. Interactive tree,
   stone, and grass identities are `hash64(worldId, tileKey, layer, candidateIndex)`. Candidate
   enumeration is row-major within a 256 m world tile and is a generator-versioned contract.
2. Authored cities, districts, and roads are world metadata. They compile deterministically into
   terrain stamps and scatter exclusion fields. Terrain composition is macro field, hydrology
   carve, authored stamps, then voxel overlay. The compiled stamp hash participates in terrain
   source identity.
3. RPG deltas store only changes from the environmental baseline. A hidden or destroyed
   environmental prop carries its tile, layer, and candidate index. Restoring a save builds sparse
   per-tile exclusion words; tiles without deltas allocate no exclusion data.

Schema v2 embeds the Phase 1 `WorldManifest` and uses the `continent-v1` profile. Loading a v1
`infinite-islands-v1` record goes through `migrateSaveManifest`; it is pinned to an explicit legacy
generator identity instead of adopting current generator inputs. A different generator version or
terrain-source hash returns `migration-required`. Regeneration keeps world-space voxel and RPG
deltas and emits a prop reconciliation report listing baseline candidates that no longer exist.

Runtime diagnostics expose `prop_delta_count` and `prop_exclusion_tiles`. The standing
`npm run world:verify` sweep checks tile determinism, prop identity stability and uniqueness,
delta exclusion, stamp application, and scatter clearing on deterministic sampled tiles.

Editor authoring UX is deliberately outside this contract. Editors write validated world metadata;
the runtime owns compilation, source hashing, persistence, migration, and reconciliation.
