# Benchmark scenes

`bench/scenes` is now organized into topic folders. The scene loader is still backward-compatible for bare file names, so existing
`--bench bench/scenes/<scene>.toml` invocations continue to work without requiring immediate updates.

## Current folders

- `visual/` - baseline visual/benchmark scenes and generic reference configs
- `naadf/` - NAADF-specific scenes and their notes
- `water/` - water and shoreline/reflective cases
- `forest/` - forest stress and prop-visibility variants
- `props/` - prop-only probes
- `terrain/` - terrain-focused checks
- `collider/` - collider, movement, and gameplay probes
- `ui/` - UI scenes

## Suggested convention

- Keep generic scene names that are intentionally shared from docs and scripts out of deeply nested folders only when the scene already has
  strong domain grouping.
- Prefer adding new scenes directly under the most specific folder for that benchmark.
