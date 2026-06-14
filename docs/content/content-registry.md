# Drusniel Content Registry & Validator System

## Purpose
The Content Registry and Validator system centralizes and validates all game data definition files (materials, texture atlas mappings, biomes, props, building pieces, snap points, protected areas, and future objectives) under a unified, schema-validated structure. This allows developer-friendly customization and modding via YAML configuration files while maintaining strict referential integrity at game startup.

## Architecture & Borrowed Design
The architecture is inspired by **World of Claudecraft**'s modular content merging and referential validation.
1. **Module Separation**: Raw content definitions are split into semantic configuration files under `assets/content/`.
2. **Merging & Inheritance**: At startup, the loader resolves and merges YAML configurations over hardcoded system defaults by ID.
3. **Cross-Record Validation**: A comprehensive multi-rule validation sweep ensures that references between biomes, materials, textures, snap points, and objectives are mathematically correct, topologically sound, and free of invalid cycles.

## Content File Layout
All configuration files reside in `assets/content/`:
- `materials.yaml`: Defines material types, voxel physical properties, and palettes.
- `atlas_mappings.yaml`: Sets texture slot layout and 3-sided voxel-to-tile atlas bindings.
- `biomes.yaml`: Configures surface and underground voxel layers, default fluid materials, and biome tags.
- `props.yaml`: Defines scatterable object categories, footprints, weights, and spawn conditions.
- `building_pieces.yaml`: Establishes snap-based building pieces, category rules, and snap points.
- `protected_areas.yaml`: Dictates spawn zones, unbreakable barriers, and build rules.
- `objectives.yaml`: Outlines progression tasks and quest graphs.

## Validation Rules
The validation suite enforces over 50 specific rules:
- **Identifier Rules**: Every ID must be unique, non-empty, and lowercase kebab-case.
- **MMO Filter**: Blocks prohibited references (e.g., `claudecraft`, `wow`, `paladin`, etc.).
- **Material Constraints**: Ensures indices map to valid `VoxelType` values (`0..=11`). Requires transparent/liquid attributes for water, and non-diggable properties for bedrock.
- **Atlas Dimensions**: Restricts texture slot and mapping indices to valid bounds (`< 16` based on the 4x4 texture columns).
- **Topology & Cycles**:
  - Validates that snap directions are normalizable vectors.
  - Checks compatibility between snap groups (`floor-edge`, `wall-bottom`, `wall-top`, `wall-side`, `roof-edge`, `generic`).
  - Audits objective graphs to prevent direct/indirect self-cycles and warns about unreachable objectives.

## Voxel and System Integration
- **VoxelType**: Configured materials bridge directly to Bevy's `VoxelType` enum using legacy numeric IDs.
- **AtlasMapping**: Maps textures to render array indices using the registry, replacing fragile manual line-parsing.
- **BuildingPieceRegistry**: Populates building piece parameters and snapping rules dynamically from YAML.

## Strict Mode vs Fallback Behavior
- **Default Mode**: If a configuration file is missing or contains errors, the system logs warnings/errors and falls back to hardcoded system defaults to keep dev startup unblocked.
- **Strict Mode (`DRUSNIEL_CONTENT_STRICT=1`)**: Forces strict compliance. If any file fails to load or violates a validation rule, the application will panic immediately at startup to prevent invalid runtime states.

## Verification Commands
Run the formatting, compilation, and test suite with:
```powershell
rtk cargo fmt
rtk cargo check
rtk cargo test --lib
```

## Attribution & License
Attribution note to the MIT-licensed reference copied under `docs/reference/world-of-claudecraft-content`.
