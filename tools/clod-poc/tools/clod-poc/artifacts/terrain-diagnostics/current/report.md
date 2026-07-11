# Near CLOD Terrain Material Diagnosis

Generated: 2026-07-11T05:49:24.655Z

URL: `http://127.0.0.1:5180/?scene=infinite-islands&seed=1&webgpuSelection=1&farShell=0&farClipmap=0&materialTiers=0&clodPerf=0&terrainMaterial=procedural&proceduralDebug=final&canopy=0&hud=0&freeze=1`

Screenshot: `tools\clod-poc\artifacts\terrain-diagnostics\current\near-clod-final.png`

## Verdict

- **INFO NO_CONFIG_FAULT_FOUND** — No material configuration or visible-layer collapse was detected in the isolated near CLOD path.

## Material

| Field | Value |
|---|---:|
| Backend | webgpu |
| Near CLOD isolated | true |
| Source | procedural |
| Textures active | true |
| Triplanar | true |
| Biome splat | true |
| Texture scale control | 1 |
| Blend mode | blend bands |
| Blend width | 6.00 m |
| Albedo array | 1024×1024×10, mipmaps=true |
| Normal array | 1024×1024×10, mipmaps=true |

## Visible CLOD Samples

| Field | Value |
|---|---:|
| Visible pages | 4 |
| Source vertices | 602,107 |
| Sampled vertices | 100,352 |
| Height range | -7.50–101.09 m |
| Height span | 108.59 m |
| Dominant layer | sand |
| Dominant ratio | 65.2% |
| Nearest-band fallback | 6.5% |

### Biome histogram

```json
{
  "0": 10565,
  "1": 13090,
  "2": 2879,
  "3": 272,
  "5": 14310,
  "6": 59236
}
```

### Selected layer histogram

```json
{
  "sand": 65471,
  "forest floor": 13090,
  "meadows ground": 10565,
  "wet soil": 8075,
  "dirt": 2879,
  "snow": 272
}
```

## Texture Slots

| # | Name | ID | Height | Base scale | Resolved scale | Repeat period |
|---:|---|---|---:|---:|---:|---:|
| 0 | grass | generated:grass | 12.0–46.0 m | 0.0600 | 0.2400 | 4.17 m |
| 1 | rock | generated:rock | 38.0–88.0 m | 0.0400 | 0.1600 | 6.25 m |
| 2 | sand | generated:sand | 0.0–18.0 m | 0.0550 | 0.2200 | 4.55 m |
| 3 | snow | generated:snow | 62.0–128.0 m | 0.0350 | 0.1400 | 7.14 m |
| 4 | dirt | generated:dirt | 16.0–58.0 m | 0.0450 | 0.1800 | 5.56 m |
| 5 | moss | generated:moss | 18.0–72.0 m | 0.0700 | 0.2800 | 3.57 m |
| 6 | gravel | generated:gravel | 10.0–54.0 m | 0.0650 | 0.2600 | 3.85 m |
| 7 | wet soil | generated:wet_soil | 0.0–22.0 m | 0.0500 | 0.2000 | 5.00 m |
| 8 | meadows ground | authored:meadows-ground | 20.0–92.0 m | 0.0620 | 0.2480 | 4.03 m |
| 9 | forest floor | authored:forest-floor | 18.0–88.0 m | 0.0700 | 0.2800 | 3.57 m |

## Biome Layer Sets

| Biome | Layers | Names |
|---:|---|---|
| 0 | 2, 8, 1 | sand / meadows ground / rock |
| 1 | 2, 9, 1 | sand / forest floor / rock |
| 2 | 4, 7, 1 | dirt / wet soil / rock |
| 3 | 1, 1, 3 | rock / rock / snow |
| 4 | 2, 0, 1 | sand / grass / rock |
| 5 | 2, 2, 1 | sand / sand / rock |
| 6 | 2, 7, 1 | sand / wet soil / rock |

## Browser Warnings and Errors

```text
[warning] The powerPreference option is currently ignored when calling requestAdapter() on Windows. See https://crbug.com/369219127
[warning] [LongViewMaterialsConfig] Invalid material quality "procedural", allowed: full_debug, slope_tint_debug, single_projection_far, horizon_proxy, atlas_only_debug, using default "horizon_proxy".
[warning] [LongViewMaterialsConfig] Invalid material quality "procedural", allowed: full_debug, slope_tint_debug, single_projection_far, horizon_proxy, atlas_only_debug, using default "horizon_proxy".
[warning] Calling [RenderPassEncoder (unlabeled)].Draw with a vertex count of 0 is unusual.
```
