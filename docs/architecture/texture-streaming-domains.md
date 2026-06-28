# Texture streaming domains

Drusniel must not put terrain, construction, NPC, decal, and UI textures into one giant shared array. They have different lifetime rules and different memory pressure. This document defines the domain split for `tools/clod-poc` and the future main Bevy implementation.

## Domain summary

| Domain | Resident rule | Eviction | Notes |
| --- | --- | --- | --- |
| Terrain common | Always loaded | Never | Grass, rock, sand, snow, dirt, moss, gravel, wet soil. |
| Terrain biome window | Max two active biome layers | Active window | Current biome plus adjacent/target biome only. |
| Construction | Core trim sheets always loaded; optional sets streamed | LRU by last used/visible | Wood, stone, thatch, clay/plaster, metal, glass. |
| Characters/NPCs | Core archetype sets plus visible outfits | LRU by distance/visibility | Skin, hair, cloth, leather/armor; palette masks for variation. |
| Decals | Core dirt/damage sets; optional decals streamed | LRU by visibility | Moss, wetness, dirt, burn marks, damage. |
| UI/editor previews | Small preview pool | LRU by last used | Never shares world material arrays. |

## Terrain biome texture window

Terrain has many authored biome recipes, but runtime terrain arrays may only carry:

1. Common terrain layers.
2. At most two active biome-specific terrain layers.

The two active biome layers are the current biome and either the adjacent biome, target biome, or next predicted biome. The loader rebuilds the procedural texture array when the active pair changes. Inactive biomes fall back to common layers until they enter the window.

The TypeScript cap is enforced by:

- `MAX_ACTIVE_BIOME_TEXTURES = 2`
- `resolveActiveBiomeMaterials()`
- `resolveActiveProceduralMaterialOrder()`
- `withActiveBiomeProceduralMaterials()`
- `createBiomeTextureStreamingManager()`

Configuration uses:

```yaml
procedural_textures:
  terrain:
    active_biome_materials: [meadows-ground, forest-floor]
    material_order: [grass, rock, sand, snow, dirt, moss, gravel, wet_soil]
```

`material_order` is common-only by default. Active biome layers are appended by code.

## Runtime manager

`BiomeTextureStreamingManager` samples the current camera/player biome and a predicted adjacent biome. It maps biome IDs to authored terrain material IDs:

| Biome | Material |
| --- | --- |
| meadows | `meadows-ground` |
| forest | `forest-floor` |
| swamp | `swamp-muck` |
| mountain | `mountain-scree` |
| plains | `plains-grass` |
| coast | `coast-sand` |
| ocean | `ocean-floor` |

On active-pair changes, CLOD POC rebuilds procedural terrain textures with common layers plus the two active biome layers, swaps them into `TerrainMaterialController`, and reapplies terrain textures to resident terrain materials.

Debug counters exposed through long-view stats:

- `terrainTextureWindowSwaps`
- `terrainTextureActiveBiomes`

## Construction textures

Construction textures are not biome textures. They should use reusable trim sheets and material arrays because the player can place pieces anywhere.

Recommended core sets:

- wood
- stone
- thatch
- clay/plaster
- metal
- glass

Variation should come from vertex color masks and decals, not unique textures per piece. A wall, beam, floor, and door should share material sets where possible.

Construction far LODs should use simple baked color/normal or impostor materials.

## NPC / character textures

NPC textures are their own domain. They should not use terrain or construction arrays.

Recommended core sets:

- skin
- hair
- cloth
- leather/armor

NPC variation should come from outfit IDs and palette masks. Near NPCs can load full material sets. Mid NPCs should use lower mip/outfit atlases. Far NPCs should use impostors or palette-only materials.

## Decals

Decals are overlays used by terrain, construction, and characters. They remain separate because their lifetime is visibility/event-driven, not biome-driven.

Examples:

- dirt
- moss
- wetness
- burn marks
- damage
- blood or combat marks, if enabled later

## UI and editor previews

UI textures and editor previews are separate from world texture arrays. They can use small preview atlases and LRU eviction by last use.

## Implementation status

Done in CLOD POC:

1. Domain policy constants and `texture_streaming.yaml`.
2. Authored biome material recipes.
3. Two-biome active terrain texture window.
4. Runtime manager that rebuilds terrain procedural textures on active-pair changes.
5. Material-controller support for swapping procedural texture arrays at runtime.

Next steps:

1. Add construction trim-sheet content schema.
2. Add character outfit/palette content schema.
3. Add per-domain memory reporting to the debug overlay.

Do not solve construction or NPC textures by expanding the terrain array.
