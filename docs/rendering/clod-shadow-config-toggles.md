# CLOD Shadow Config + Render Toggles

PR 0010 adds a single feature gate for the  CLOD shadow path.

It builds on:

```txt
0006 Bevy runtime snapshot contract
0007 Bevy proxy spawn wiring
0008 asset loading + stats
0009 F3/bench adapters
0010 config/toggle integration
```

## New module

```rust
src/rendering/clod_shadow_config.rs
```

Main types:

```rust,ignore
ClodShadowRuntimeMode
ClodShadowRuntimeSettings
ClodShadowRenderToggles
ClodShadowConfigPlugin
```

The default mode is:

```txt
Proxy
```

That preserves the exported runtime plan:

```txt
UseVisualMeshCaster      -> visual terrain page casts
SpawnProxyShadowCaster   -> visual page no-casts + proxy caster spawns
ApplyNotShadowCaster     -> visual page no-casts
```

## Runtime modes

```txt
proxy         normal Fable-parity path
visual-only   force all pages to cast from visual meshes
no-cast-only  force all pages to NotShadowCaster
disabled      skip the CLOD shadow path
```

`visual-only`, `no-cast-only`, and `disabled` are A/B modes for debugging and
bench scenes.  They are not the intended shipping visual mode.

## Environment variables

```txt
VOXEL_CLOD_SHADOWS=proxy|visual|nocast|off
VOXEL_CLOD_SHADOW_SNAPSHOT=assets/generated/clod/shadow_runtime.json
VOXEL_CLOD_SHADOW_AUTO_RELOAD=0|1
VOXEL_CLOD_SHADOW_LOAD_SNAPSHOT=0|1
VOXEL_CLOD_SHADOW_LIGHT_LAYERS=0|1
VOXEL_CLOD_SHADOW_F3=0|1
VOXEL_CLOD_SHADOW_BENCH=0|1
```

Examples:

```bash
VOXEL_CLOD_SHADOWS=off cargo run --release
VOXEL_CLOD_SHADOWS=visual cargo run --release
VOXEL_CLOD_SHADOWS=proxy VOXEL_CLOD_SHADOW_AUTO_RELOAD=1 cargo run
```

## Bench/render toggles

`ClodShadowRenderToggles` mirrors the keys that should be exposed by bench scene
TOML and the debug UI:

```txt
disable_clod_shadows
force_visual_mesh_shadows
force_no_cast_shadows
disable_clod_shadow_proxies
disable_clod_shadow_snapshot_loading
disable_clod_shadow_light_layers
disable_clod_shadow_f3
disable_clod_shadow_bench_metrics
clod_shadow_snapshot_path
clod_shadow_auto_reload
```

Recommended bench scenes:

```txt
visual-regression-high.toml                  -> proxy mode enabled
visual-regression-disable-clod-shadows.toml  -> disable_clod_shadows = true
visual-regression-visual-shadow-casters.toml -> force_visual_mesh_shadows = true
visual-regression-no-terrain-shadows.toml    -> force_no_cast_shadows = true
```

## Integration steps

Add the module:

```rust,ignore
pub mod clod_shadow_config;
```

Add the plugin before the CLOD shadow loader/spawn/debug adapters:

```rust,ignore
app.add_plugins((
    ClodShadowConfigPlugin,
    ClodShadowSnapshotLoaderPlugin,
    ClodShadowSpawnPlugin,
    ClodShadowF3OverlayPlugin,
    ClodShadowBenchIntegrationPlugin,
));
```

Use `ClodShadowRuntimeSettings::effective_action(...)` inside the PR 0007 spawn
loop before applying a plan entry:

```rust,ignore
let Some(action) = settings.effective_action(plan.action) else {
    return;
};
```

Use these checks at call sites:

```rust,ignore
settings.should_load_snapshot()
settings.should_spawn_proxy_casters()
settings.should_configure_light_layers()
settings.should_show_f3()
settings.should_emit_bench_metrics()
```

## F3 line

The config module also exposes:

```rust,ignore
clod_shadow_config_debug_line(&settings)
```

Example:

```txt
clod shadow config: mode proxy load true proxies true f3 true bench true path assets/generated/clod/shadow_runtime.json
```

## Acceptance checks

- `VOXEL_CLOD_SHADOWS=off` disables the CLOD shadow path.
- `VOXEL_CLOD_SHADOWS=visual` turns proxy plans into visual mesh casters.
- `VOXEL_CLOD_SHADOWS=nocast` turns all CLOD terrain pages into no-cast pages.
- `VOXEL_CLOD_SHADOWS=proxy` preserves the exported  plan.
- Bench output records which mode was active for A/B comparisons.
- F3 shows the mode and snapshot path when enabled.
