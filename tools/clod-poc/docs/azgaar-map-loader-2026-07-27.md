# Azgaar Full JSON map loader

Import [Azgaar Fantasy Map Generator](https://github.com/Azgaar/Fantasy-Map-Generator) **Full JSON** exports into clod-poc as a portable macro atlas, then drive the existing finite-world `HeightmapSource` path.

## Quick start

1. Put a Full JSON export under `tools/clod-poc/public/maps/` (for example `sample.json`).
2. Start the dev server and open:

```text
http://127.0.0.1:5180/?azgaar=/maps/sample.json&materialTiers=1
```

Query params:

| Param | Default | Meaning |
|---|---|---|
| `azgaar` / `azgaarMap` | *(none)* | URL to Azgaar Full JSON. Presence enables the loader (wins over `heightmap=`). |
| `azgaarAtlasLongEdge` | `1024` | Macro atlas long edge in pixels. |
| `azgaarPhysicalWidthM` | *(from map)* | Optional override of physical width in metres. |
| `heightmapBaseM` / `heightmapSpanM` / `heightmapDetail` / `heightmapFlipZ` | same as PNG heightmap | Applied after converting Azgaar raw heights `0–100` → luminance. |

PNG heightmaps via `?heightmap=` remain supported for grayscale exports.

## Module layout

```text
src/world_source/azgaar/
  azgaar_json_importer.ts       # Full JSON → imported world + campaign
  azgaar_macro_world_source.ts  # grid/pack → height/biome/feature atlas
  azgaar_macro_world_generator.ts
  azgaar_cartography_source.ts  # Voronoi pack geometry
  azgaar_biome_catalog.ts
  azgaar_heightmap_adapter.ts   # macro → HeightmapSource
  azgaar_world_source.ts        # WorldSource wrapper
  azgaar_map_loader.ts          # fetch + defaults
  azgaar_import_worker_client.ts
```

Bevy Rust port lives in `src/world/source/azgaar/`.
