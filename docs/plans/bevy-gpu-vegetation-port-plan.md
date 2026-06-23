# Bevy GPU Vegetation/Prop Cull + Indirect Draw — Port Plan

> Created: 2026-06-17 · Status: Planning
> Scope: `src/props/instanced_render.rs`, `src/world/environment/vegetation/`,
> `assets/shaders/instanced_prop.wgsl`, `assets/config/props.yaml`,
> `bench/scenes/forest/`
> Related: [`props-virtual-geometry-execution-plan.md`](props-virtual-geometry-execution-plan.md)
> (meshlet pilot — complementary, see "Relationship to the meshlet pilot"),
> [`clod-poc-grass-port-plan.md`](clod-poc-grass-port-plan.md) (the WebGL sandbox port).

This is the **main-engine** counterpart to the clod-poc grass port. It adapts the
GPU vegetation scatter/cull/indirect-draw idea from LAAS/fable5 to Drusniel's
existing Bevy/wgpu renderer. It is a **refinement** of an externally-suggested
plan, rewritten against what the repo actually contains (audit below) so it does
not reinvent infrastructure that already exists.

## What this is / is not

- **Is:** moving the **per-frame CPU cull/LOD/compaction** of the existing custom
  prop-instancing pipeline onto the GPU (compute cull → compacted visible buffer →
  GPU-written indirect draw args), behind a feature gate, with the current CPU path
  as fallback.
- **Is not:** a renderer rewrite, a new `src/rendering/gpu_vegetation/` subsystem,
  removal of any CPU vegetation/prop/grass/wind/LOD system, or moving gameplay/
  destructible state onto the GPU.

## Repo reality (audit findings — the load-bearing context)

Bevy **0.18.1**, config convention is **YAML** (`bench_guard.toml` is the lone
exception).

### Props are already a fully custom instanced pipeline
[`src/props/instanced_render.rs`](../../src/props/instanced_render.rs) (~3,260 lines)
is a hand-rolled instanced renderer, **not** Bevy's `Material` path:
- custom shader `assets/shaders/instanced_prop.wgsl`;
- custom `RenderCommand` chain ending in `DrawMeshInstanced`
  ([:2973](../../src/props/instanced_render.rs#L2973)), which binds a per-group
  `InstanceBuffer` at vertex slot 1 and issues a **direct**
  `draw_indexed(indices, base, 0..instance_buffer.length)`
  ([:3020](../../src/props/instanced_render.rs#L3020));
- hooks into the `Opaque3d` / `AlphaMask3d` / `Shadow` render phases;
- **CPU** does frustum + distance + LOD + subcluster + per-instance shadow culling
  each frame, building compacted `instances` / `shadow_instances` vectors that are
  uploaded into the `InstanceBuffer`;
- already handles integrated-GPU fallback (`tint_enabled = !integrated_gpu`),
  subcluster grids, billboard swap, shadow LOD.

The bench toggles the external plan said to "find" already exist as scenes:
[`forest-ab-disable-instanced-props.toml`](../../bench/scenes/forest/),
`forest-disable-prop-lod-hiding.toml`, `forest-disable-prop-shadow-lod.toml`,
`forest-prop-subclusters-2x2.toml`, `forest-prop-subclusters-4x4.toml`.

### Verdict on `NoIndirectDrawing` (the investigation)
`NoIndirectDrawing` is attached to every prop-group entity at
[instanced_render.rs:715](../../src/props/instanced_render.rs#L715). It is **not**
evidence that indirect drawing is broken or unsupported. It is a deliberate marker
that **excludes these entities from Bevy's native `gpu_preprocessing` / indirect
batching** so they don't get double-handled — because the custom pipeline issues
its own draws. The current CPU path works and stays the fallback. When we add our
**own** indirect draws, `NoIndirectDrawing` stays (we still want Bevy's automatic
batching to leave these entities alone); we change only *how our own pipeline
issues the draw* (`draw_indexed` → `draw_indexed_indirect`).

**Consequence:** the GPU port is a *surgical evolution of this existing pipeline*,
not a greenfield render architecture. Most of the external plan's 12-module /
4-WGSL / 16-phase scaffolding is redundant here.

### Grass is a separate, more standard system
[`src/world/environment/vegetation/`](../../src/world/environment/vegetation/):
per-chunk grass-blade meshes with a Bevy `Material` (`GrassMaterial`, `AsBindGroup`,
wind via a `time` uniform) and CPU distance/visibility culling (`GRASS_CULL_*`,
look-ahead). It is **not** on the custom instanced pipeline, so it is a *second*
target, not the first (see Target decision).

### The repo already has a compute + custom-render-node template
The NAADF subsystem ([`src/rendering/naadf/render/`](../../src/rendering/naadf/render/),
`assets/shaders/naadf/*.wgsl`) runs `@compute` passes, custom render-graph nodes,
GPU buffers, and mip/bounds builds. **We do not need to invent compute-pass
plumbing — follow NAADF's pattern.**

### Relationship to the meshlet pilot
[`props-virtual-geometry-execution-plan.md`](props-virtual-geometry-execution-plan.md)
is a *narrow Bevy meshlet pilot* for **opaque static** props, explicitly leaving
instancing/billboards/alpha-vegetation untouched, and already defines
`PropRenderPath { Instanced, Meshlet, BillboardOnly }`. The two are
**complementary**: meshlets give cluster-LOD for unique static geometry; this plan
gives GPU-driven cull/indirect for **dense repeated instances**. They coexist under
`PropRenderPath::Instanced`. This plan must not regress or fork that enum.

## The actual gap vs GroundRing

GroundRing's edge over the current prop pipeline is precisely the three things the
CPU does today per frame:
1. **Cull/LOD selection on CPU** → move to a compute pass.
2. **Compaction on CPU** (building `instances` vectors) → GPU atomic-append into a
   compacted visible-index buffer.
3. **CPU-decided `instance_count`** → GPU-written `draw_indexed_indirect` args.

Everything else GroundRing-ish (per-instance source data, LOD bins, shadow lists,
wind, billboards) the repo already has on the CPU side.

## Target decision

**First GPU vertical slice: the props instanced path** (one decorative,
non-interactable class — e.g. foliage/tiny-clutter, which already have LOD/shadow
handling). Reasons: the custom pipeline, instance buffers, source/visible/shadow
separation, phases, and integrated-GPU fallback already exist, so the change is
contained to cull+compaction+draw.

**Grass is the second target**, addressed one of two ways (decide later, after the
prop slice proves out):
- (a) migrate grass onto the same instanced pipeline and inherit the GPU path, or
- (b) leave grass on its `Material` path and instead port the *rendering-quality*
  techniques (clumps, continuous-thin LOD, dither crossfade, `lean²` wind) from the
  [clod-poc plan](clod-poc-grass-port-plan.md) — quality without the GPU-cull rework.

## CPU/GPU contract (kept from the external plan — this part is good)

```rust
/// GPU vegetation buffers are derived render caches.
/// CPU placement/persistence remains authoritative.
/// The GPU path may compact and draw visible decorative instances,
/// but it must not own gameplay state or require readback on the frame path.
```

Invariants:
- CPU placement/persistence/biome/edit/gameplay state stays authoritative; GPU owns
  only packed source instances, visible indices, LOD bins, indirect args, debug
  counters.
- The CPU path is restorable by config without touching save data (it **is** the
  current path).
- No GPU readback on the frame path. Counters are debug/bench-only, gated.
- Chunk unload / terrain or biome edits invalidate and re-upload affected source
  ranges (the pipeline already tracks group versions + dirty uploads — extend that).
- Buffer overflow clamps safely (atomic append bounded by capacity, overflow
  counter incremented); never corrupts, never panics in release; can fall back to
  the CPU path.
- No gameplay/interactable/destructible entity is made GPU-only or hidden by the
  GPU path.

## Phased plan (surgical — extends existing files)

Each phase is independently benchable against the forest scenes and revertable via
the feature gate.

### Phase 0 — Baseline + gate
- Add `gpu_vegetation` config (minimal — see below) to `assets/config/props.yaml`;
  default **off**. Typed errors, validation, rate-limited logging.
- Capture a CPU-path baseline on `forest-*` scenes (frame ms, draw calls, prop
  visible counts) via the existing bench harness + `bench_guard`.
- **Verify:** config validates; baseline recorded; default-off changes nothing.

### Phase 1 — Persistent GPU source-instance buffer
- Upload the per-group **source** instances (already in `InstancedPropGroup.source_*`)
  into a persistent GPU storage buffer once, keyed by stable per-chunk/per-group
  ranges; re-upload only dirty ranges on edit/unload (reuse the version/dirty
  machinery the pipeline already has).
- Define `#[repr(C)] Pod`/`Zeroable` GPU structs (the repo already uses
  `bytemuck` here). Add size/alignment tests.
- **Verify:** source buffer matches CPU placement; dirty re-upload works on edit;
  no per-frame full re-upload.

### Phase 2 — Compute cull (main view) → compacted visible + indirect args
- Add compute passes following the **NAADF render-node pattern**:
  `reset_counters` → `cull_main`. Inputs: source buffer, per-group draw metadata,
  view frustum planes, camera pos, LOD distances, fade/hysteresis. Output: compacted
  visible-index buffer (atomic append, capacity-clamped) + per-group instance counts
  + `draw_indexed_indirect` args.
- Keep a **CPU reference implementation** of the cull for unit tests (distance,
  frustum, LOD choice, capacity clamp, draw-group mapping).
- **Verify:** GPU visible counts ≈ CPU path counts on a static frame (debug readback
  only); overflow == 0 at configured caps.

### Phase 3 — Indirect draw
- Change `DrawMeshInstanced` to `draw_indexed_indirect` reading the GPU-written args
  buffer instead of `0..instance_buffer.length`. Vertex shader reads
  `visible_indices[base + instance_index]` to fetch the source instance (handles the
  `first_instance`-unsupported case directly, so no reliance on base-instance).
- `NoIndirectDrawing` stays on the group entities.
- **Verify:** identical silhouette/density to the CPU path on a paused frame; no
  double-draw; draw-call count per group unchanged or lower.

### Phase 4 — Separate shadow-cascade cull lists
- Add `cull_shadow` compute per cascade against cascade frustums/bounds (shorter
  distance, LOD bias), writing per-cascade visible lists + indirect args. The CPU
  pipeline already implements per-cascade shadow caster culling
  (`rebuild_visible_and_shadow_instances_with_cascades`, `CascadeShadowBuffers`,
  budget enforcement) — mirror that on GPU.
- **Verify:** off-screen-but-shadow-casting props retained; shadow caster count ≤ the
  current budget; no new cascade-edge popping.

### Phase 5 — Fallback, metrics, A/B bench
- Toggles: config `enabled=false` / `force_cpu_fallback=true`; bench
  `disable_gpu_vegetation` / `force_gpu_vegetation` / `compare_gpu_vegetation_cpu`.
  Init failure or insufficient caps → log once, use CPU path.
- Metrics into the existing diagnostics/bench output: source count, dirty uploads,
  main visible, culled (frustum/distance), overflow, indirect draws submitted,
  shadow visible total, CPU-fallback-active, cull CPU/GPU ms.
- Add `bench/scenes/forest/forest-gpu-vegetation-ab-cpu.toml` and `-gpu.toml`
  (do not delete existing forest scenes).
- **Verify (honest):** run the A/B bench; only claim a win if measured. Acceptance:
  overflow == 0, fallback inactive when GPU forced+supported, visible > 0, indirect
  draws > 0, p95 frame time not regressed beyond the configured threshold, no missing
  vegetation band in screenshots.

### Phase 6 (later) — Grass
- Execute the Target-decision (a) or (b) for grass once the prop slice is proven.

## Minimal config (extend `assets/config/props.yaml`, YAML)

Only knobs used by Phases 0–5. Do **not** front-load deferred-feature tuning
(terrain-occlusion, billboard distances, etc. come with their phases).

```yaml
gpu_vegetation:
  enabled: false
  force_cpu_fallback: false
  disable_on_integrated_gpu: true
  target_layer: "props_foliage"     # first slice
  buffers:
    max_source_instances: 262144
    max_visible_main: 131072
    max_visible_shadow_per_cascade: 65536
  culling:
    max_draw_distance_m: 160.0
    lod_end_m: [32.0, 72.0, 128.0]  # strictly increasing; validated
    fade_band_m: 12.0
    hysteresis_m: 8.0
    shadows: true
    max_shadow_distance_m: 96.0
  debug:
    allow_gpu_readback: false        # debug/bench only
    emit_metrics: true
```
Validation: caps > 0 and visible ≤ source; LOD distances strictly increasing;
fade/hysteresis ≥ 0; shadow cascade count clamped to engine capability with a
warning; if `enabled` and the platform can't support the compute/indirect path and
no fallback is allowed, fail config load with a typed error (otherwise warn + fall
back).

## What to drop from the external plan (and why)

- **`src/rendering/gpu_vegetation/` (12 modules) + 4 WGSL files** — the custom
  instanced pipeline already exists; extend `src/props/instanced_render.rs` and add
  cull WGSL beside it. A separate subsystem duplicates pipeline/phase wiring.
- **The ~70-line config** — collapse to the minimal set above; YAML is already the
  repo norm, so that instruction is fine.
- **"Audit to discover the systems"** as if greenfield — done here; the systems,
  toggles, integrated-GPU handling, and shadow separation already exist.
- **Re-deriving why indirect is off** — answered above.
- **Phase 10 terrain-occlusion culling** — defer; only revisit if NAADF/Hi-Z
  bounds are cheap to bind. Conservative-only, debug-first. Leave a narrow TODO.

## Open questions / investigations before coding

1. **Does Bevy 0.18's native `gpu_preprocessing` + indirect batching** express
   per-instance dynamic LOD/shadow culling well enough to let us drop part of the
   custom pipeline, instead of hand-writing the compute cull? Spike this first — if
   yes, the plan shrinks again; if no, proceed with the NAADF-style custom passes.
2. Exact `draw_indexed_indirect` + storage-buffer binding shape under the repo's
   custom phase items (validate against `DrawMeshInstanced`'s bind groups).
3. Confirm `GraphicsCapabilities`
   ([`src/rendering/device/capabilities.rs`](../../src/rendering/device/capabilities.rs))
   exposes the compute/indirect features we need for the gate.

## Reference index

- Custom prop pipeline + draw: [`src/props/instanced_render.rs`](../../src/props/instanced_render.rs)
- Prop instancing data: [`src/props/instancing.rs`](../../src/props/instancing.rs), [`src/props/lod_material.rs`](../../src/props/lod_material.rs)
- Grass system: [`src/world/environment/vegetation/`](../../src/world/environment/vegetation/)
- Compute + custom render-node precedent: [`src/rendering/naadf/render/`](../../src/rendering/naadf/render/), `assets/shaders/naadf/*.wgsl`
- GPU capabilities: [`src/rendering/device/capabilities.rs`](../../src/rendering/device/capabilities.rs)
- Meshlet pilot (complementary): [`props-virtual-geometry-execution-plan.md`](props-virtual-geometry-execution-plan.md)
- Reference grass (techniques): [`docs/reference/fable5-world-demo/src/vegetation/GroundRing.ts`](../reference/fable5-world-demo/src/vegetation/GroundRing.ts)
