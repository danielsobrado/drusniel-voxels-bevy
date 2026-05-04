# World persistence contract

Sprint 14A exposes the existing Bevy voxel persistence system for editor backend use. It does not introduce a new file format.

## Default save

- Path: `world_data.bin`
- Encoding: bincode 1.x over serde data structures
- Root payload: `WorldData`
- Runtime load behavior: `VoxelPlugin` keeps using the same default save path and attempts to load it at startup unless forced regeneration is enabled.

## Current saved data

`WorldData` contains:

- `world_size_chunks`: Bevy `IVec3` world dimensions in chunks
- `terrain_config_fingerprint`: `u64` fingerprint of the terrain generation config at save time
- `chunks`: list of `ChunkData`

`ChunkData` contains:

- `position`: Bevy `IVec3` chunk-space position
- `voxels`: full 16x16x16 voxel array in `Chunk::index(x, y, z)` order
- `face_visibility`: 15-bit visibility mask for chunk face-pair occlusion culling

Water is included only when represented as `VoxelType::Water` in chunk voxel data.

## Not currently saved

- Explicit on-disk schema version
- Props or foliage placement data
- Protected areas or unbreakable zones
- Editor selections, panels, view state, snapshots, undo, or redo history
- Runtime mesh entities, material handles, collider entities, or LOD state
- Water-body overrides separate from voxel water

## Editor-facing DTOs

The Rust persistence module now exposes serializable DTOs for future backend commands:

- `EditorWorldMetadata`
- `EditorWorldSummary`
- `EditorChunkSummary`
- `EditorSaveResult`
- `EditorLoadResult`

These DTOs are an API contract for the editor bridge. `EDITOR_PERSISTENCE_CONTRACT_VERSION` versions the DTO shape; it is not written into `world_data.bin`.

## Editor-facing functions

Default-save helpers:

- `editor_load_default_world()`
- `editor_save_default_world(world)`
- `editor_saved_world_exists()`
- `editor_delete_saved_world()`
- `editor_export_world_metadata()`
- `editor_get_chunk_summaries()`
- `editor_default_world_summary()`

Path-aware helpers also exist for tests and future adapters:

- `save_world_to_path(world, path)`
- `load_world_from_path(path)`
- `read_world_data_from_path(path)`
- `saved_world_exists_at_path(path)`
- `delete_saved_world_at_path(path)`
- `editor_load_world_from_path(path)`
- `editor_save_world_to_path(world, path)`
- `editor_export_world_metadata_from_path(path)`
- `editor_get_chunk_summaries_from_path(path)`
- `editor_world_summary_from_path(path)`
