# Agent Instructions

Keep changes surgical, simple, and verified. This repo has an active rendering/performance workflow, so profiling is part of implementation whenever a change can affect frame timing or visuals.

Use `$godogen` to generate or update this Bevy game from a natural-language description.

## Shell Rules

- Always prefix shell commands with `rtk`.
- Byte-cap commands with unknown or potentially large output, for example:

```powershell
rtk cargo test 2>&1 | head -c 4000
```

- Useful wrappers:

```powershell
rtk --version
rtk gain
rtk gain --history
rtk proxy <cmd>
```

Do not invent project commands. If a new command is needed, add it to the Makefile via PR.

## Standard Commands

```powershell
rtk make dev          # Start local development environment
rtk make test         # Run full test suite
rtk make lint         # Run Go and TypeScript linters
rtk make reconcile    # Run reconciliation harness against Power BI
rtk make build        # Build production artifacts
```

## Profiling

Profile any change that can affect rendering, terrain meshing, props, shadows, water, post-processing, or frame timing.

Expected workflow:

1. Run a baseline bench for the relevant scene.
2. Make the change.
3. Re-run the same bench scene.
4. Compare `bench-runs/<run>/summary.json`, screenshots, counters, and timing rows.
5. Report measured wins and regressions plainly. Do not add broad timing rows together; some overlap.

Use release benches for performance claims:

```powershell
rtk cargo run --release -- --bench bench/scenes/visual/visual-regression.toml
```

Common A/B scenes:

- `bench/scenes/visual/visual-regression-high.toml`
- `bench/scenes/visual/visual-regression-performance100.toml`
- `bench/scenes/visual/visual-regression-live-lod.toml`

Run the regression guard when touching known bottlenecks:

```powershell
rtk cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

If a visual change improves performance but regresses screenshots, document the intentional tradeoff. If a performance-sensitive change was not profiled, say so explicitly.

Outside bench mode, `VOXEL_RENDER_TIMING=1` enables equivalent render timing capture in the debug timing CSV.

## NAADF Benches

For NAADF preview or GI changes, measure startup visual stability:

```powershell
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-startup-stability.toml
```

Inspect staged screenshots (`settle-120`, `settle-240`, `settle-360`, `settle-540`, `settle-720`, `settle-899`, `settle-1200`, `settle-1499`) and report the first `frame`/`elapsed_secs` where the image is fully textured, not the blue silhouette or early occupancy preview. Include `ready_wait_secs`, `render_ready_secs`, NAADF preview counters, and startup trace phase CSVs. Runtime readiness alone does not prove texture stability.

For NAADF-only preview performance, run:

```powershell
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-preview-only.toml
```

That scene disables legacy terrain, water, buildings, shadows, reflections, and prop queues.

## Collider And Runtime Lock

When changing spawn placement, player movement, terrain colliders, terrain readiness, or fall-through guards, run:

```powershell
rtk cargo run --release -- --bench bench/scenes/collider/collider-walk-log.toml
```

This logs player coordinates, validity, collider readiness, stall/fall-through events, dig/crust rejection counters, and route behavior.

Runtime, editor viewport, and bench launches share one runtime lock by default. Use `DRUSNIEL_BENCH_RUNTIME_LOCK` only when an isolated bench lock is intentional.

## Compile-Time Notes

- Keep `.cargo/config.toml` `sccache` unless diagnosing compiler-wrapper issues.
- Keep Bevy `dynamic_linking` and dev profile optimizations for normal local iteration.
- Do not add nightly-only compile accelerators by default.
- If changing linker, debug-info, or profile settings, verify the exact Windows command and document the tradeoff. Do not make shipping/release claims from dynamic-linking dev builds.

## Editor Verification

Rebuild the editor runtime sidecar and restart the desktop editor only for editor-facing changes: editor UI, Tauri integration, bridge/protocol, native viewport behavior, sidecar packaging, or tasks explicitly requiring desktop-editor verification.

Main runtime, rendering, meshing, benchmark, and gameplay diagnostics should be verified with the relevant game binary, bench scene, or targeted runtime probe unless the user asks for editor verification.

When editor verification is relevant, use existing scripts under `editor/frontend`. Rust changes are not visible in the editor until the sidecar is rebuilt and the editor is restarted.

## Editor Diagnostics

Use `DRUSNIEL_EDITOR_DIAGNOSTICS=1` only for focused debugging of viewport input, targeting, selection, native viewport focus/attach, or bridge behavior. Include relevant log excerpts when reporting findings.

With diagnostics enabled, the Tauri shell exposes a local-only automation endpoint at `http://127.0.0.1:17778`. It must bind only to loopback and requires a non-trivial `DRUSNIEL_EDITOR_AUTOMATION_TOKEN` for every non-health request:

```powershell
$env:DRUSNIEL_EDITOR_AUTOMATION_TOKEN = "replace-with-local-random-token"
rtk curl http://127.0.0.1:17778/health
rtk curl -X POST -H "Authorization: Bearer $env:DRUSNIEL_EDITOR_AUTOMATION_TOKEN" http://127.0.0.1:17778/focus
rtk curl -X POST -H "Authorization: Bearer $env:DRUSNIEL_EDITOR_AUTOMATION_TOKEN" "http://127.0.0.1:17778/screenshot?label=viewport-check"
rtk curl -X POST -H "Authorization: Bearer $env:DRUSNIEL_EDITOR_AUTOMATION_TOKEN" "http://127.0.0.1:17778/move?space=viewport&x=100&y=100"
rtk curl -X POST -H "Authorization: Bearer $env:DRUSNIEL_EDITOR_AUTOMATION_TOKEN" "http://127.0.0.1:17778/click?space=viewport&x=100&y=100&button=left"
```

Use `space=viewport` for native Bevy viewport-relative coordinates, `space=window` for editor-window-relative coordinates, and `space=screen` for absolute screen coordinates. Mouse actions fail if the editor cannot become the foreground window; screenshots can still verify layout through the Tauri capture path.

## Terrain Debug Views

Implementation: `src/voxel/terrain_debug.rs`. Plan and interpretation recipe: `docs/lod/wireframe-debug-plan.md`.

Hotkeys:

- `Alt+F7`: toggle wireframe overlay.
- `Alt+F8`: toggle normals-as-colour mode.
- `Alt+Shift+F7`: capture `debug/wireframe-<ts>.png` and `.json`. Known bug: also toggles `Alt+F7`.
- `Shift+F9`: dump `debug/terrain-hole-probe-<ts>.json`.
- `F5`: keep terrain on Surface Nets.
- `Alt+F5`: toggle MC+Transvoxel spike; F3 shows `MC+TVX: ON/OFF`.

Debug interpretation:

- Stepped wireframe geometry: DC/QEF/SDF placement issue.
- Smooth geometry but stepped `Alt+F8` colour: normals issue.
- Holes: missing chunk, failed mesh, or wrong dirty flag. Check `missing_boundary_neighbors_at_mesh`.
- Non-white edges at an altitude band: skirt hiding a real gap.

MC+Transvoxel defaults are controlled by `assets/config/mc_transvoxel.yaml`; default builds include the `mc_transvoxel` feature. Bench replace mode uses `enabled: true` plus `mode: replace_surface_nets`, or `bench-runs/baseline-mctx/*.yaml`. Spike status: `docs/lod/mc-transvoxel-plan.md`.

## Coding Conduct

- State assumptions when ambiguity matters; ask when guessing would be risky.
- Prefer the minimum code that solves the request. Avoid speculative options, abstractions, and configurability.
- Touch only files and lines needed for the task. Match existing style.
- Clean up unused imports, variables, or functions created by your own change.
- Turn work into verifiable goals. For bug fixes, prefer a reproducing test before the fix; for refactors, verify before and after behavior when practical.
