# Phase 8 — Deterministic Far Canopy Shell (PoC)

## Current behavior (before Phase 8)

`buildFarCanopyShell()` in `src/gpu/far_canopy_shell.ts` consumed procedural textures from
`createExtendedCanopyTexture()` in `src/clod/terrain_summary.ts`. Coverage was FBM noise gated
by page coverage — not aligned with deterministic tree/biome rules.

`createFarShellController()` built the legacy canopy once at startup for long-view scenes.

## What changed

Phase 8 adds a **summary-driven canopy clipmap** under `src/canopy/`:

| Module | Role |
|--------|------|
| `canopy_config.ts` | YAML loader + validation |
| `deterministic_tree_distribution.ts` | Seed-stable forest mask, species, crown sampling |
| `canopy_terrain_sampler.ts` | Terrain height/slope/water adapter |
| `canopy_summary_builder.ts` | World-space summary tiles |
| `canopy_clipmap.ts` | Camera-centered lazy tile manager |
| `canopy_texture.ts` | Composite `DataTexture` set for the shell |
| `canopy_system.ts` | Integration controller |
| `canopy_debug.ts` | Tile bounds, fade rings, stats line |

`far_canopy_shell.ts` now exposes `buildFarCanopyShellFromTextureSet()` for summary textures.
Legacy `buildFarCanopyShell()` delegates to the new path with synthetic textures.

## Architecture (text)

```
camera → canopy_clipmap (budgeted tile builds)
              ↓
     canopy_summary_builder ← tree_distribution + terrain_sampler
              ↓
     canopy_texture (composite DataTextures)
              ↓
     far_canopy_shell (TSL displacement + dither fade)
```

## Scene gates

- `long-view-forest-4km` → deterministic canopy **on** by default
- `long-view-4km` → off unless `?canopy=1`
- `?canopy=0` disables
- `?canopySynthetic=1` forces legacy synthetic textures (A/B only)
- `?canopyDebug=coverage|tiles|wireframe|fade`

## Acceptance checks

- [ ] Forest mass follows deterministic coverage (not pure noise)
- [ ] Water cells have ~zero coverage
- [ ] Steep slopes rejected per config
- [ ] Tile builds respect `max_tiles_built_per_frame`
- [ ] Metrics: `canopy_visible_tiles`, `canopy_shell_tris`, `canopy_fallback_synthetic_tiles`
- [ ] `npm test` + `npm run build` pass

## Visual validation commands

```powershell
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1
```

| URL | Purpose |
|-----|---------|
| `?scene=long-view-forest-4km&seed=12345&world=16&clodPerf=1` | Forest valley |
| `?scene=long-view-forest-4km&canopyDebug=coverage` | Coverage heatmap |
| `?scene=long-view-forest-4km&canopySynthetic=1` | Synthetic A/B |
| `?scene=long-view-forest-4km&freezeCanopy=1` | Frozen clipmap |

Shot harness (dev server running):

```powershell
rtk cmd /c "set CLOD_POC_BASE_URL=http://127.0.0.1:5180/&& npm --prefix tools/clod-poc run shoot -- --scene long-view-forest-4km --seed 12345 --world 16 --clodPerf=1 --freeze 1 --hud 1 --framealign 0 --out shots/phase-8/forest-4km.png --stats shots/phase-8/forest-4km-stats.json"
```

## Known limitations

- Tile builds run synchronously on the main thread (budgeted). **TODO:** Worker offload.
- Height source is terrain summary / analytic field, not far-summary clipmap tiles yet.
- No near-tree impostor handoff renderer in PoC — dither band prepares for it.
- Species model is a simple proxy, not ecology simulation.

## Future Bevy/Rust port (not implemented)

- Source of truth: real prop/tree placement + saved prop chunks
- Summary invalidation on terrain + prop edits
- GPU clipmap atlas; participate in far lighting/shadow proxies
- Derived cache only — not authoritative gameplay data

## TODO

- [ ] Wire far-summary `sampleCanopyCoverage` into terrain sampler
- [ ] Worker-thread tile building
- [ ] Connect billboard/impostor fade at `impostor_end_m`
- [ ] Replace PoC deterministic rules with production prop persistence
