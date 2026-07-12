# CLOD Shadow Bench Presets

PR 0012 adds ready-to-run bench presets for the  CLOD shadow path.

The presets build on the config/runtime wiring from PR 0010 and PR 0011.  They
all use the same snapshot path so the only intended variable is the runtime
shadow mode.

## Presets

```txt
bench/scenes/clod-shadow-proxy.toml   -> parity target: visual near + proxy mid/far + no-cast over budget
bench/scenes/clod-shadow-visual.toml  -> control: every selected page casts from visual terrain mesh
bench/scenes/clod-shadow-nocast.toml  -> diagnostic floor: CLOD terrain pages do not cast shadows
bench/scenes/clod-shadow-off.toml     -> integration baseline: CLOD shadow runtime disabled
```

## Commands

```bash
cargo run --release -- --bench bench/scenes/clod-shadow-proxy.toml
cargo run --release -- --bench bench/scenes/clod-shadow-visual.toml
cargo run --release -- --bench bench/scenes/clod-shadow-nocast.toml
cargo run --release -- --bench bench/scenes/clod-shadow-off.toml
```

## What to compare

Use the output from PR 0009:

```txt
Clod Shadow Runtime Mode
Clod Shadow Runtime Mode Code
Clod Shadow Visual Pages
Clod Shadow Proxy Pages
Clod Shadow NoCast Pages
Clod Shadow Visual Triangles
Clod Shadow Runtime Triangles
Clod Shadow Saved Triangles
Clod Shadow Saved Percent
```

The expected ordering for terrain shadow-pass cost is:

```txt
visual-only  >  proxy  >  no-cast
```

`off` is not the same as `no-cast`.  `off` disables the CLOD shadow runtime path
entirely.  `no-cast` keeps the runtime active and reports CLOD metrics, but turns
all CLOD terrain pages into no-cast pages.

## Acceptance checks

- `proxy` reports non-zero proxy pages and positive saved-triangle percentage.
- `visual` reports visual mesh casters and near-zero saved-triangle percentage.
- `nocast` reports no visual/proxy caster pages for CLOD terrain.
- `off` reports disabled mode and no active CLOD snapshot/spawn path.
- Screenshots from `proxy` and `visual` should be visually close except for
  expected small differences from proxy simplification.

## Notes

If a local branch has custom visual-regression paths, copy only the
`[render_toggles]` block from these presets into that scene.  The presets are
intentionally small so they can follow the bench parser defaults used by the
existing visual-regression scenes.
