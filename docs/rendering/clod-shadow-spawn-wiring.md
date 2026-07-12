# CLOD Shadow Spawn Wiring

PR 0007 wires the  CLOD shadow manifest into Bevy entities.

This PR is the first runtime step after the `clod-poc` validation/export work:

```txt
0001 shadow cut policy
0002 shadow manifest
0003 viewer overlay
0004 proxy mesh generation
0005 proxy viewer visualization
0006 Bevy runtime snapshot contract
0007 Bevy spawn wiring
```

## Runtime model

Every visual CLOD terrain page entity must be tagged with:

```rust
ClodTerrainVisualMeshId(visual_mesh_id)
```

where `visual_mesh_id` matches the `visualMeshId` field exported by
`tools/clod-poc/src/bevy_shadow_runtime.ts`.

When a validated `ActiveClodShadowRuntimeSnapshot` is inserted, the spawn wiring
applies each plan entry:

```txt
UseVisualMeshCaster
  remove NotShadowCaster from the visual terrain page

SpawnProxyShadowCaster
  add NotShadowCaster to the visual terrain page
  spawn a compact proxy mesh from proxyMeshes[shadowMeshId]
  place the proxy on the same transform as the visual page
  put the proxy on the shadow-only render layer

ApplyNotShadowCaster
  add NotShadowCaster to the visual terrain page
```

## Shadow-only proxy layer

Proxy casters are spawned on render layer 31 by default:

```rust
CLOD_SHADOW_PROXY_RENDER_LAYER = 31
```

The default main camera renders layer 0, so the proxy is not visible to the main
view. Shadow-casting lights are assigned both layer 0 and layer 31 by the helper
system `configure_clod_shadow_light_layers`.

If Drusniel already reserves layer 31 for another system, override the layer in
the integration and keep the same policy shape.

## Integration steps

1. Add `pub mod clod_shadow_runtime;` and `pub mod clod_shadow_spawn;` to the
   rendering module root if not already present.
2. Add `ClodShadowSpawnPlugin` after the normal terrain/CLOD spawn systems.
3. Tag each visual terrain page entity with `ClodTerrainVisualMeshId`.
4. Load/deserialize the JSON runtime snapshot from PR 0006.
5. Insert it as `ActiveClodShadowRuntimeSnapshot::new(generation, snapshot)?`.
6. Expose `ClodShadowRuntimeSpawnStats` in the F3/debug overlay.

## Debug stats

The wiring updates `ClodShadowRuntimeSpawnStats`:

```txt
visual_caster_pages
proxy_caster_pages
no_cast_pages
missing_visual_entities
missing_proxy_meshes
spawned_proxy_entities
visual_triangles
runtime_shadow_triangles
saved_triangles
```

Acceptance for this PR is not visual perfection yet. The acceptance check is that
runtime shadow caster count and triangle count now follow the CLOD shadow
manifest instead of the visual terrain cut.

## Next PR

PR 0008 should add snapshot loading from the actual generated asset path and wire
these stats into the existing F3 overlay/bench CSV rows.
