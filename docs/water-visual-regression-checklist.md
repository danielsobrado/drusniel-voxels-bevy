# Water Visual Regression Checklist

## Scenes
- `bench/scenes/lake-water-close.toml`
- `bench/scenes/lake-water-mid.toml`
- `bench/scenes/lake-water-oblique-reflection.toml`
- `bench/scenes/ocean-water-reference.toml`
- `bench/scenes/river-water-reference.toml`
- `bench/scenes/shallow-shore-reference.toml`

## Required Counters
- `Counter Water Bodies Total`
- `Counter Water Body Fancy Count`
- `Counter Water Body Cheap Count`
- `Counter Water Reflection Active`
- `Counter Water Reflection Sampled`
- `Counter Water Reflection Mask Pixels`
- `Counter Water Reflection Compositor Applied Pixels`
- `Counter Water Debug Nearest Body Kind` (`0=Unknown`, `1=Ocean`, `2=Lake`, `3=River`, `4=Pond`)
- `Counter Water Debug Nearest Max Depth`
- `Counter Water Debug Nearest Material Mode` (`0=Unknown`, `1=Fancy`, `2=Cheap`, `3=Hidden`)

## Screenshot Sanity
- No chunk-by-chunk material patchwork.
- No flat blue texture slabs.
- Lake reflection is visible when close or oblique.
- Ocean remains active and wavy.
- Shore foam appears only at edges.
- LOD transitions do not visibly change the same lake.
