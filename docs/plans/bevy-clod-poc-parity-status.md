# Bevy / clod-poc Parity Status

Document status (updated 2026-07-01): current code check from the Bevy tree and `tools/clod-poc`.

## Implemented in Bevy

The following clod-poc-facing systems are already represented in the Rust/Bevy runtime and should not be treated as pending port work:

| Area | clod-poc reference | Bevy implementation | Status |
|---|---|---|---|
| Visual hydrology | `tools/clod-poc/src/water/hydrologySystem.ts`, `tools/clod-poc/src/water/visualHydrologyField.ts`, `tools/clod-poc/src/systems/hydrology_packing.ts` | `src/terrain/hydrology/` | Ported |
| Spells | `tools/clod-poc/src/spells/`, `tools/clod-poc/config/spells.yaml` | `src/gameplay/spells/mod.rs`, `assets/config/spells.yaml`, `assets/shaders/spell_beam.wgsl` | Ported |
| Construction | `tools/clod-poc/src/construction/`, `tools/clod-poc/config/construction.yaml` | `src/gameplay/building/`, `assets/config/building_materials.yaml`, `assets/shaders/building.wgsl` | Ported |

## Notes

- Hydrology is a derived visual field: it samples terrain generation into water height, far water height, wet mask, flow direction/speed, river depth, moisture and body-kind arrays. Voxel water remains authoritative.
- Spells cover the current fire/water/air menu and cast VFX surface: config loading, UI state, events, audio event mapping, and the beam material/shader path.
- Construction covers the runtime building surface: snap placement, ghost preview, placement validation, stability/collapse, persistence, material rendering, deletion helpers, and optional terrain conformance.

## Remaining Parity Focus

The next parity work should stay on verification and gaps, not re-porting these systems:

- WorldSource GPU readback runtime acceptance is verified from a native Windows shell: `bench-runs/world-source-runtime-acceptance/summary.json` records `acceptance_pass: true`, 5 available GPU samples, `drift_gate.status: passed`, and 0 failures. `world_source_acceptance` now validates and pairs with that artifact; it stays red only when `runtime_gpu_readback_acceptance.status` is not `accepted`.
- Explicit `terrain_source.mode = legacy` has been removed from supported config/runtime selection. `legacy` now fails terrain-source YAML deserialization, and async chunk generation no longer has a selectable legacy terrain branch. Remaining cleanup is dead-code/doc removal after a native Windows visual guard rerun.
- `bench_guard` now scopes the LOD seam-audit JSON check to seam-audit scenes/counters, so `visual-regression.toml` summaries are not failed solely for missing `seam-audit.json`.
- Bevy GPU vegetation parity has an opt-in vertical slice behind `--features gpu_vegetation`: source instance storage upload, compute cull buffers/node, indirect draw path, shadow cascade buffers, and forest A/B bench scenes. Native PowerShell smoke benches now complete after fixing compute binding/layout validation issues, but the current forest A/B artifacts contain 0 queued instanced props, so real-GPU A/B benches with actual instanced prop coverage are still required before performance claims.
- Run the relevant clod-poc Node/Vite checks directly, not through `rtk`, when changing the web side.
- Run Bevy benches from a native Windows shell for visual/frame-timing claims; this WSL path should not be used for visual benches.
- For construction changes, verify placement/stability/persistence behavior and terrain-conform edits when enabled.
- For hydrology or water changes, compare generated hydrology/debug outputs and water visuals rather than treating the water clipmap as the Bevy target.
- For CLOD scripted edit changes, both complete QA runners now emit the edit plan, mutation request, authoritative-hook, and collider-refresh audit CSVs. Real refreshed collider rows still require the authoritative terrain mutation path to be enabled.
