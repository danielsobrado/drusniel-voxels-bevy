# CLOD PoC Content Registry & Validator

This document defines the purpose, architecture, configuration layout, validation rules, and extension workflow for the CLOD PoC Content Registry and Validator layer.

## Purpose

The Content Registry decouples semantic terrain definitions (materials, biomes, texture channels, presets, snap pieces) from the core mesh decimation, quadtree selection, and rendering algorithms. By transitioning from ad-hoc numeric slots to a validated, type-safe content registry, the CLOD system can scale cleanly to support complex rules without compromising system stability.

## Architecture

The content layer splits definitions by category into five flat maps, which are populated from human-readable YAML configurations (or fall back to bundled defaults):

```
                   [ YAML Configs / Bundled Defaults ]
                                  │
                                  ▼
                        [ loadContentRegistry ]
                                  │
                       (Merges & constructs maps)
                                  │
                                  ▼
                         [ ContentRegistry ]
                        ├── materials
                        ├── textureSlots
                        ├── biomes
                        ├── clodDebugPresets
                        └── snapPieces
                                  │
                                  ▼
                    [ validateContentRegistry ]
                       (Validates 22 rules)
                                  │
                                  ▼
                     [ ContentValidationReport ]
                       ├── ok (boolean)
                       ├── errors (list)
                       └── warnings (list)
```

1. **Vite / Client side**: Loads YAML files as raw text strings using `?raw` imports, which Vite bundles directly.
2. **Vitest / Node side**: Reads the YAML files directly from disk (`config/content/*.yaml`) to verify changes during automated test passes.
3. **Validator**: Validates the merged tables for referential integrity, format correctness, and ranges, ensuring all IDs are kebab-case and unique.

## Config File Layout

All configurations live under `tools/clod-poc/config/content/`:
- `materials.yaml`: Terrain and physical material configurations (walkability, transparency, etc.).
- `texture_slots.yaml`: Mappings of numeric texture blend indices to materials.
- `biomes.yaml`: Biome tags and height bands determining material composition.
- `clod_debug_presets.yaml`: User-configurable viewer overlays and error limits.
- `snap_pieces.yaml`: Blueprint properties for modular pieces.

## Validator Rules

The registry validator executes 22 strict checks:
1. **Duplicate IDs**: Rejects duplicate IDs in any category.
2. **Invalid ID Format**: IDs must be lowercase kebab-case (`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`).
3. **Missing Materials**: Ensures referenced materials actually exist.
4. **Missing Texture Slots**: Checks all texture slot references.
5. **Band Ranges**: Rejects bands where `minHeight >= maxHeight`.
6. **Band Overlaps**: Rejects biomes with overlapping height bands.
7. **Band Gaps**: Warns if a biome has height gaps between its bands (fails in strict mode).
8. **Slot Indexes**: Must be non-negative integers.
9. **Slot Index Uniqueness**: Slot indices must be unique unless marked `alias: true`.
10. **Color RGB**: Must be an array of three integers in `0..255`.
11. **Strength**: Must be finite and `>= 0`.
12. **Transparent Digging**: Transparent materials cannot be diggable unless `allowTransparentDigging` is true.
13. **Water**: Water materials must be transparent.
14. **Snap Dimensions**: Must be positive finite numbers.
15. **Snap Directions**: Directions must be normalizable vectors.
16. **Snap Groups**: Must match known snap groups.
17. **Preset Errors**: Presets must have `errorPx > 0`.
18. **Band Materials**: Ensures referenced material IDs exist.
19. **Band Texture Slots**: Checks textureSlotId references.
20. **Biome Default Materials**: Confirms default material existence.
21. **Biome Water Materials**: Ensures biome waterMaterialId exists and points to water or a transparent material.
22. **MMO / World of Claudecraft Filter**: Rejects production YAML strings containing banned MMO terms (`claudecraft`, `quest`, `mob`, `npc`, `dungeon`, `loot`, `leveling`, `xp`, `mana`, `class`, `spell`, `alliance`, `horde`, `raid`, `boss`).

## Extension Guide

### How to add a Material
1. Open `config/content/materials.yaml`.
2. Add a new entry:
   ```yaml
   - id: limestone
     name: Limestone
     kind: rock
     colorRgb: [200, 190, 170]
     strength: 4.5
     walkable: true
     diggable: true
     paintable: true
   ```

### How to add a Texture Slot
1. Open `config/content/texture_slots.yaml`.
2. Map a new index to a material ID:
   ```yaml
   - id: limestone-texture
     name: Limestone Texture
     slotIndex: 8
     source: builtin
     materialId: limestone
     tags: [rock]
   ```

### How to add a Biome
1. Open `config/content/biomes.yaml`.
2. Add a biome with height bands:
   ```yaml
   - id: gravel-desert
     name: Gravel Desert
     defaultMaterialId: sand
     waterMaterialId: water
     tags: [arid]
     terrainBands:
       - id: desert-dunes
         name: Desert Dunes
         minHeight: -10
         maxHeight: 40
         materialId: sand
         textureSlotId: sand
       - id: desert-hills
         name: Desert Hills
         minHeight: 40
         maxHeight: 150
         materialId: rock
         textureSlotId: rock
   ```

### How to add a Debug Preset
1. Open `config/content/clod_debug_presets.yaml`.
2. Define a preset for the viewer:
   ```yaml
   - id: extreme-detail
     name: Extreme Detail
     showWireframe: true
     showPageBoundaries: false
     showLockedBorders: false
     showNodeLabels: false
     colorByLod: false
     errorPx: 0.5
   ```

## Why Snap Pieces are Placeholders

Snap pieces are placeholders only in the PoC to support future snaps without modifying the viewer runtime. Currently, they are parsed and validated to secure the interface contract before a full structural snapping system is wired into the rendering loops.

## Attributions

A portion of the registry validation and modular module merging architecture was inspired by the MMO content registry in the MIT-licensed `world-of-claudecraft` reference codebase, located under `tools/clod-poc/reference/world-of-claudecraft-content/`.
