# Terrain Hex-Tiling



Optional shader polish for triplanar terrain materials. Reduces visible repeated texture patterns on large natural surfaces (grass, dirt, sand, rock).



## What it does



- Applies [Practical Real-Time Hex-Tiling](https://github.com/mmikk/hextile-demo) to triplanar terrain **albedo** and optional **normal maps**.

- Ports the demo's shipping (non-RWS) `hextiling.h` path. The hex grid is driven by the terrain texture scale (`uniforms.tex_scale`), so hex cells are ~texture-tile sized — the scale at which repetition is actually visible. Hex tiling fades back to plain triplanar over a band ending at the distance cutoffs.

- Albedo hex tiling is active at `<= mid_distance`; normal hex tiling is active at `<= near_distance` when `normal_enabled` is on.

- Known limitation: per-cell hashing uses absolute world-space cell ids, so randomisation quality degrades very far from the origin (the `hextiling_rws.h` relative-world-space variant would address this; not currently used).

- Disabled by default; enable via config or bench toggle.



## What it does not do



- **Does not fix Surface Nets LOD seams**, lips, holes, proud edges, or chunk topology mismatches.

- Does not modify meshing, skirts, colliders, chunk generation, or water.

- Does not hex-tile roughness or AO.



LOD seam fixes require explicit transition/stitch geometry or a different multiresolution partition — not texture tricks.



## Config



File: `assets/config/terrain_texturing.yaml`



| Key | Default | Meaning |

|-----|---------|---------|

| `hex_tiling.enabled` | `false` | Master switch for albedo hex tiling |

| `hex_tiling.normal_enabled` | `false` | Hextiled normals via surface gradients (requires master switch) |

| `hex_tiling.rotation_strength` | `1.0` | Per-hex random rotation amount |

| `hex_tiling.color_border_contrast` | `0.55` | Hex cell border contrast for albedo blending |

| `hex_tiling.normal_border_contrast` | `0.50` | Hex cell border contrast for normal derivative blending |

| `hex_tiling.near_distance` | `96.0` | Normal hex tiling disabled beyond this camera distance |

| `hex_tiling.mid_distance` | `160.0` | Albedo hex tiling disabled beyond this camera distance |

| `hex_tiling.disable_on_integrated_gpu` | `true` | Auto-off on integrated GPUs |

| `hex_tiling.disable_on_low_quality` | `true` | Auto-off on Low / Performance100 presets |



Environment overrides:



- `VOXEL_TERRAIN_HEX_TILING=1` — force albedo hex tiling on (still respects integrated GPU / low-quality gates unless config disables those)

- `VOXEL_TERRAIN_HEX_TILING_NORMAL=1` — force normal hex tiling on (requires master hex tiling to be effective)

- Bench toggles: `terrain_hex_tiling` and `terrain_hex_tiling_normal` in scene TOML
- Editor profiler: **Rendering settings** panel checkboxes (session-only; does not write YAML)



## Performance warning



Regular triplanar albedo: **3** texture samples per material.



Hex-tile triplanar albedo: **3 projections × 3 hex samples = 9** texture samples per material.



Hex-tile triplanar normals (surface-gradient path): **3 projections × 3 hex samples = 9** additional normal-map samples per material when within `near_distance`.



Combined albedo + normal near camera: **~18** texture samples per blended material. Use only on near/mid terrain where repetition is visible.



## How to test visually



1. Enable in `assets/config/terrain_texturing.yaml` or run a bench scene.

2. Compare grass/dirt/rock at mid distance — repeated grid patterns should soften (albedo).

3. Stand within `near_distance` with `normal_enabled: true` — normal-map repetition at grazing angles should soften without breaking triplanar blending.

4. Walk to far terrain — shading should match the cheaper triplanar path past `mid_distance` (albedo) and past `near_distance` (normals).

5. Alt+F7 wireframe / Alt+F10 hole probe are unchanged; hex tiling does not affect mesh debug views.



Bench scenes:



```powershell

rtk cargo run --release -- --bench bench/scenes/terrain/hex-tiling-off.toml

rtk cargo run --release -- --bench bench/scenes/terrain/hex-tiling-albedo.toml

rtk cargo run --release -- --bench bench/scenes/terrain/hex-tiling-albedo-normal.toml

```



## Integration points



- Shader modules: `assets/shaders/terrain/hextile.wgsl`, `assets/shaders/terrain/surfgrad.wgsl`

- Terrain shader: `assets/shaders/triplanar_terrain.wgsl` (`CommonTriplanarColor` / `CommonTriplanarNormal`-style paths)

- Rust uniforms: `src/rendering/materials/triplanar.rs` (`HexTilingUniform` @ binding 13)

- Config loader: `src/rendering/terrain_hex_tiling.rs`



## License note



Shader logic adapted from [mmikk/hextile-demo](https://github.com/mmikk/hextile-demo) (MIT License). Substantial portions retain the MIT copyright and permission notice from the reference headers (`hextiling.h`, `hextiling_rws.h`, `surfgrad_framework.h`).


