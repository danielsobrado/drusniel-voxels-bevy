# Bevy / clod-poc Parity Status

Document status (2026-06-30): current code check from the Bevy tree and `tools/clod-poc`.

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

- Next missing parity is WorldSource GPU readback acceptance: `world_source_acceptance` must stay red while GPU readback is unavailable, and the `--runtime-assisted` readback path must produce `bench-runs/world-source-runtime-acceptance/summary.json` with accepted samples before the legacy bridge is removed.
- Run the relevant clod-poc Node/Vite checks directly, not through `rtk`, when changing the web side.
- Run Bevy benches from a native Windows shell for visual/frame-timing claims; this WSL path should not be used for visual benches.
- For construction changes, verify placement/stability/persistence behavior and terrain-conform edits when enabled.
- For hydrology or water changes, compare generated hydrology/debug outputs and water visuals rather than treating the water clipmap as the Bevy target.
- For CLOD scripted edit changes, both complete QA runners now emit the edit plan, mutation request, authoritative-hook, and collider-refresh audit CSVs. Real refreshed collider rows still require the authoritative terrain mutation path to be enabled.
