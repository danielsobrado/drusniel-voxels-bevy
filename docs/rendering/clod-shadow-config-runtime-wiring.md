# CLOD Shadow Config Runtime Wiring

PR 0011 connects the PR 0010 config resource to the runtime systems created in
PR 0007-0009.

It keeps the previous modules usable without the config plugin, but when
`ClodShadowRuntimeSettings` is present it becomes the single source of truth for:

```txt
snapshot loading
proxy mesh upload
visual/proxy/no-cast spawn decisions
shadow proxy light layers
F3 output
bench rows and summary values
```

## Runtime behavior by mode

```txt
VOXEL_CLOD_SHADOWS=proxy
  load snapshot
  upload proxy meshes
  apply exported actions
  configure lights for proxy layer 31
  emit F3 + bench metrics

VOXEL_CLOD_SHADOWS=visual
  load snapshot
  do not upload proxy meshes
  force every planned page to UseVisualMeshCaster
  do not configure proxy light layer
  emit F3 + bench metrics with mode visual-only

VOXEL_CLOD_SHADOWS=nocast
  load snapshot
  do not upload proxy meshes
  force every planned page to ApplyNotShadowCaster
  do not configure proxy light layer
  emit F3 + bench metrics with mode no-cast-only

VOXEL_CLOD_SHADOWS=off
  do not load snapshot
  remove the active snapshot resource
  clear proxy entities
  clear runtime spawn stats
  hide F3 lines through the synced F3 settings
```

## Files changed

```txt
src/rendering/clod_shadow_assets.rs
src/rendering/clod_shadow_spawn.rs
src/rendering/clod_shadow_f3_overlay.rs
src/rendering/clod_shadow_bench_integration.rs
src/rendering/clod_shadow_config.rs
```

## Spawn action resolution

`clod_shadow_spawn.rs` now resolves each exported plan action through:

```rust,ignore
effective_clod_shadow_runtime_action(settings, plan.action)
```

That means the exported snapshot is not mutated.  Debug modes are applied only at
runtime:

```txt
Proxy       -> preserve exported action
VisualOnly  -> UseVisualMeshCaster
NoCastOnly  -> ApplyNotShadowCaster
Disabled    -> skip/clear path
```

Stats are recomputed from the effective runtime action so bench comparisons are
honest:

```txt
visual-only: runtime triangles ~= visual triangles, saved 0%
proxy:       runtime triangles from proxy plan, high savings
no-cast:     runtime triangles 0, useful only as a diagnostic baseline
```

## F3 output

When the runtime settings resource is present, the F3 adapter prepends:

```txt
clod shadow config: mode proxy load true proxies true f3 true bench true path assets/generated/clod/shadow_runtime.json
```

The old helper remains available for call sites that only want the three legacy
lines.

## Bench output

Configured bench rows add:

```txt
Clod Shadow Runtime Mode
Clod Shadow Runtime Mode Code
Clod Shadow Snapshot Path
```

The numeric summary helper emits `Clod Shadow Runtime Mode Code` so summary JSON
can be grouped by mode without relying on string fields.

Mode codes are stable:

```txt
0 disabled
1 proxy
2 visual-only
3 no-cast-only
```

## Recommended plugin order

```rust,ignore
app.add_plugins((
    ClodShadowConfigPlugin,
    ClodShadowSnapshotLoaderPlugin,
    ClodShadowSpawnPlugin,
    ClodShadowF3OverlayPlugin,
    ClodShadowBenchIntegrationPlugin,
));
```

`ClodShadowConfigPlugin` should run before the loader/spawn/debug adapters so the
first update frame uses the correct snapshot path and mode.

## Acceptance checks

```bash
VOXEL_CLOD_SHADOWS=proxy cargo run --release
VOXEL_CLOD_SHADOWS=visual cargo run --release
VOXEL_CLOD_SHADOWS=nocast cargo run --release
VOXEL_CLOD_SHADOWS=off cargo run --release
```

Expected:

- proxy mode spawns proxy casters and reports saved triangles.
- visual mode reports no proxy casters and near-zero triangle savings.
- no-cast mode reports no visual/proxy caster pages.
- off mode stops snapshot loading and clears the active runtime path.
