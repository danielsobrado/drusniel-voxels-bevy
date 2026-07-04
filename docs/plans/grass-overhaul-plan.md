# Drusniel Grass Overhaul Plan

Document status: older execution plan for replacing dense object-style grass with terrain-derived patch grass in the CLOD PoC first, then the Rust/Bevy runtime. The CLOD-POC WebGPU ring direction is preserved as the completed planning record [`clod-poc-grass-port-plan.md`](../plans_completed/clod-poc-grass-port-plan.md); keep this plan as background for terrain qualification, edit behavior, and Rust follow-up.

## 1. Summary

The target is a staged grass overhaul inspired by Eclipse Shader's shader grass pipeline, but implemented with Drusniel-native TypeScript, WGSL, and Rust patterns. Do not port Eclipse's GLSL tessellation or geometry shaders directly.

For CLOD-POC specifically, prefer the `GroundRing` model described in [`clod-poc-grass-port-plan.md`](../plans_completed/clod-poc-grass-port-plan.md): camera-following WebGPU ring, deterministic world cells, GPU cull/compact, indirect draws, and grass LOD bands. The Eclipse material remains useful for terrain eligibility and distance-simplification ideas, not as the primary ownership model.

Core idea:

```text
terrain page/chunk -> grass patch generator -> compact instanced cluster mesh -> shader wind -> patch/subcluster culling -> far terrain grass tint
```

The web CLOD PoC owns the first validation loop. Rust ports only after the PoC proves visual quality, edit behavior, and measured cost. Existing GLTF grass assets remain available as sparse accent clumps, but they should stop carrying primary field coverage after the new terrain-derived system is benchmarked.

Reference source:

- Eclipse Shader repo: https://github.com/Merlin1809/Eclipse-Shader/tree/Unstable
- Local reference checkout: `/home/drusniel/Eclipse-Shader`
- Copied commit: `69530b76c3d85a40a7f7d183c3df6c7b879aa8e6`
- Copied reference files: `docs/reference/eclipse-shader-grass/`

## 2. Reference Intake

The Eclipse files are copied for technical reference only. Do not paste the GLSL into production code. The useful ideas to port are terrain qualification, distance-density reduction, distance blade simplification, edge/neighbor awareness, shader wind, and far grass as terrain coverage rather than real blades.

Run this from WSL when refreshing the reference snapshot. The important corrections from the original ad hoc script are:

- `PROJECT_DIR="$HOME/drusniel/drusniel-voxels-bevy"`
- Copy `LICENSE.md` if present, falling back to `LICENSE`
- Regenerate `docs/reference/eclipse-shader-grass/REFERENCE.md` with the copied commit

```bash
set -euo pipefail

PROJECT_DIR="$HOME/drusniel/drusniel-voxels-bevy"
ECLIPSE_DIR="$HOME/Eclipse-Shader"
DEST_DIR="$PROJECT_DIR/docs/reference/eclipse-shader-grass"

test -d "$PROJECT_DIR"
test -d "$ECLIPSE_DIR"
mkdir -p "$DEST_DIR"

copy_ref() {
  local rel="$1"
  local src="$ECLIPSE_DIR/$rel"
  local dst="$DEST_DIR/$rel"

  test -f "$src" || {
    echo "Missing source file: $src" >&2
    return 1
  }

  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
  echo "Copied: $rel"
}

copy_ref "README.md"
copy_ref "shaders/shaders.properties"
copy_ref "shaders/dimensions/all_solid.vsh"
copy_ref "shaders/dimensions/all_solid.tcs"
copy_ref "shaders/dimensions/all_solid.tes"
copy_ref "shaders/dimensions/all_solid.gsh"
copy_ref "shaders/world0/gbuffers_terrain.vsh"
copy_ref "shaders/world0/gbuffers_terrain.tcs"
copy_ref "shaders/world0/gbuffers_terrain.tes"
copy_ref "shaders/world0/gbuffers_terrain.gsh"
copy_ref "shaders/lib/settings.glsl"
copy_ref "shaders/lib/TAA_jitter.glsl"
copy_ref "shaders/lib/res_params.glsl"
copy_ref "shaders/lib/bokeh.glsl"
copy_ref "shaders/lib/blocks.glsl"
copy_ref "shaders/lib/lpv_common.glsl"
copy_ref "shaders/lib/lpv_blocks.glsl"
copy_ref "shaders/lib/lpv_buffer.glsl"
copy_ref "shaders/lib/voxel_common.glsl"

if [ -f "$ECLIPSE_DIR/LICENSE.md" ]; then
  cp "$ECLIPSE_DIR/LICENSE.md" "$DEST_DIR/LICENSE.md"
elif [ -f "$ECLIPSE_DIR/LICENSE" ]; then
  cp "$ECLIPSE_DIR/LICENSE" "$DEST_DIR/LICENSE"
fi
```

Reference interpretation:

- `shaders/world0/gbuffers_terrain.*` are entry wrappers for the world terrain stages.
- `shaders/dimensions/all_solid.tcs` is the distance-density reference: grass-capable terrain gets more subdivision near camera and less far away.
- `shaders/dimensions/all_solid.tes` interpolates terrain data into the next stage.
- `shaders/dimensions/all_solid.gsh` is the blade-emission reference: material/up-normal/range gates, distance blade simplification, random bend, edge bend, player bend, and wind.
- `shaders/dimensions/all_solid.vsh` prepares grass-side metadata and block-neighbor checks.

## 3. Current Baseline

PoC baseline:

- `tools/clod-poc/src/grass.ts` builds instanced blade meshes per nearby LOD0 page.
- Default settings are heavy for a browser validation tool: `distance: 96`, `bladeSpacing: 1.6`, `maxBlades: 35000`.
- Placement is deterministic and sampled from LOD0 terrain, which is the right ownership model.
- The blade mesh is fixed at four rows and does not simplify by distance.
- Patch visibility is coarse distance visibility; there is no near/mid/far grass representation split.
- Dig rebuilds can rebuild affected LOD0 page patches, but the known README limit still applies: grass placement is not fully resampled for every terrain-edit consequence.

Rust/Bevy baseline:

- Dense grass-like assets currently route through prop systems and `config/props.yaml` high-count entries such as `usn_grass_large`, `usn_grass_large_extruded`, and `usn_grass_small`.
- `src/props/instanced_render.rs` already has useful infrastructure: `TinyGroundClutter`, LOD thresholds, hysteresis, subcluster culling, buffer upload counters, shadow LOD, and bench toggles.
- `src/props/foliage.rs` applies CPU transform wind to prop entities. This is acceptable for sparse accents, not for field-scale dense grass.
- `assets/shaders/grass.wgsl` already demonstrates WGSL-side wind, alpha masking, near fade, and vegetation lighting ideas that can be reused or simplified.

## 4. Implementation Phases

### Phase 1: PoC Grass V2

Implement in `tools/clod-poc/src/grass.ts` and nearby PoC UI/overlay modules.

- Keep grass independent from the active CLOD cut so selection changes do not duplicate, remove, or pop blades.
- Continue deriving placement from LOD0 page terrain data, not from current visible LOD nodes.
- Replace the fixed four-row blade with distance tiers:
  - Near: segmented blades or small crossed clusters for shape and wind.
  - Mid: cheap blade or cluster mesh with fewer vertices.
  - Far: no real blades; use terrain tint/coverage modulation only.
- Add Eclipse-style eligibility gates:
  - grass material weight above threshold,
  - upward normal/slope threshold,
  - height range,
  - camera range,
  - edge/cliff/cave suppression from local height and normal discontinuities.
- Add deterministic density falloff by distance before instance creation and visibility:
  - near full density,
  - mid reduced density,
  - far coverage tint only.
- Add shader wind only. Do not update per-blade transforms on the CPU each frame.
- Add PoC debug counters and overlays:
  - generated candidate count,
  - accepted blade count,
  - visible patches,
  - culled patches,
  - near/mid/far tier counts,
  - edge-suppressed candidates,
  - per-dig grass rebuild cost.
- After digging, rebuild affected LOD0 grass patches and invalidate any cached tier data that depends on those terrain samples.

### Phase 2: PoC Validation Gate

The PoC must pass this gate before Rust runtime work starts.

- Visual checks:
  - grass remains stable when the active CLOD cut changes,
  - near-field bubble off/on does not reveal ownership seams,
  - far grass reads as coverage without alpha-heavy overdraw,
  - edge/cliff/cave suppression prevents obvious floating blades,
  - dig edits do not leave dense grass hanging over removed terrain.
- Performance checks:
  - compare current grass settings against Grass V2 with the same world size and camera path,
  - record generated/visible blades, visible patches, frame timing, and build/rebuild timings,
  - keep screenshots for near, mid, far, edge, and dig cases.

### Phase 3: Rust Terrain-Derived Grass Subsystem

Add the Rust implementation beside existing props first. Do not remove prop grass until parity is measured.

- Add a terrain-derived grass patch subsystem that consumes chunk/page terrain surface data and emits compact patch instance buffers.
- Use the PoC's accepted rules for material, slope, height, edge suppression, distance tiers, and deterministic sampling.
- Reuse existing runtime ideas from `src/props/instanced_render.rs`:
  - `TinyGroundClutter` distance thresholds as initial tuning,
  - hysteresis,
  - subcluster culling,
  - render timing counters,
  - shadow LOD and alpha-mask phase decisions.
- Move dense grass wind into WGSL/material uniforms.
- Keep CPU transform wind in `src/props/foliage.rs` only for sparse accent props.
- Add diagnostics that separate terrain-derived grass from existing instanced props:
  - generated patches,
  - visible patches,
  - queued grass instances,
  - grass subclusters total/visible/culled,
  - grass buffer bytes uploaded,
  - grass shadow instances queued,
  - terrain edit grass rebuild time.

### Phase 4: Prop Grass Demotion

After Rust terrain-derived grass has parity screenshots and timing:

- Demote high-count `usn_grass_*` entries in `config/props.yaml` to sparse accent clumps, or disable their dense defaults.
- Keep flowers, bushes, hero clumps, and authored vegetation as props.
- Ensure field coverage comes from terrain-derived grass and far terrain tint, not thousands of independent GLTF grass objects.
- Update docs and debug UI labels so "grass coverage" and "grass prop accents" are visibly separate concepts.

## 5. Non-Goals

- No GLSL tessellation or geometry shader port to WGSL.
- No direct copy of Eclipse Shader GLSL into Drusniel code.
- No Rust CLOD integration claims until PoC Grass V2 has screenshots and timing.
- No broad renderer refactor as part of the grass plan.
- No removal of existing prop grass before measured parity.

## 6. Test Plan

Web PoC:

```bash
rtk npm --prefix tools/clod-poc run test
rtk npm --prefix tools/clod-poc run build
rtk npm --prefix tools/clod-poc run build-pages 8
```

Manual PoC checks:

- `rtk npm --prefix tools/clod-poc run dev`
- Check near-field bubble off/on.
- Check dig rebuilds and cave mouths.
- Check near/mid/far density tiers.
- Check far terrain tint without real blade overdraw.
- Check seam, edge, cliff, and page-boundary behavior with debug overlays.

Rust:

```bash
rtk cargo run --release -- --bench bench/scenes/forest/forest-look-sweep.toml
rtk cargo run --release -- --bench bench/scenes/forest/forest-prop-subclusters-4x4.toml
rtk make test
```

Use `VOXEL_RENDER_TIMING=1` or bench summaries to compare:

- instanced prop counts,
- terrain grass patch counts,
- queued instances,
- subcluster culling,
- buffer uploads,
- grass wind updates,
- render phase items,
- screenshots,
- frame timing.

Follow the repo profiling rule for any rendering-affecting implementation: take a baseline bench first, make the change, rerun the same bench, compare `bench-runs/<run>/summary.json`, screenshots, counters, and timing rows, and report wins/regressions plainly.

## 7. Acceptance Criteria

- Grass fields are visually dense near camera without 35k always-full browser blades.
- Mid-distance grass uses visibly cheaper geometry with no disruptive popping.
- Far grass reads as terrain coverage/tint rather than alpha-overdraw geometry.
- Grass is terrain-qualified: it appears on upward grass-capable surfaces and avoids cliffs, caves, holes, and edited-away terrain.
- Digging/rebuilt terrain does not leave floating dense grass patches in the PoC.
- Rust dense grass no longer depends on high-count GLTF grass prop defaults.
- Performance reports separate terrain-derived grass from legacy prop grass.

## 8. Defaults And Assumptions

- The CLOD-POC grass ring planning record is `docs/plans_completed/clod-poc-grass-port-plan.md`.
- This file remains the background plan for terrain-derived grass concepts and eventual Rust follow-up.
- Reference files live under `docs/reference/eclipse-shader-grass/`.
- PoC implementation comes first, Rust second, prop demotion third.
- Existing GLTF grass remains available as sparse accent vegetation.
- The implementation uses Drusniel-native TypeScript, WGSL, Rust, Bevy, and Three.js patterns.
