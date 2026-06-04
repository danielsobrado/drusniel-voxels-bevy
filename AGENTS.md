# Agent Instructions

This repo has an active rendering/performance workflow. Treat profiling as part of the implementation, not as optional cleanup after the fact.

Use $godogen to generate or update this Bevy game from a natural language description.


## Profiling Rules

1. Any change that can affect rendering, terrain meshing, props, shadows, water, post-processing, or frame timing should be measured.
2. Use release benches for performance claims:

```powershell
cargo run --release -- --bench bench/scenes/visual/visual-regression.toml
```

3. Benchmark variants already exist for common A/B work:
   - `bench/scenes/visual/visual-regression-high.toml`
   - `bench/scenes/visual/visual-regression-performance100.toml`
   - `bench/scenes/visual/visual-regression-live-lod.toml`
4. Read `bench-runs/<run>/summary.json` and compare before/after numbers. Do not add broad timing rows together because some are parent/child or overlapping brackets.
5. For render investigations, use the built-in counters and timing rows first. If a change claims an improvement, report which rows changed and by how much.
6. Run the regression guard when the change touches known bottlenecks:

```powershell
cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

7. If the change is visual, inspect the fixed checkpoint screenshots from the bench output. Do not accept a performance win that introduces visible regressions unless the tradeoff is intentional and documented.
8. Outside bench mode, `VOXEL_RENDER_TIMING=1` enables the same render timing capture in the debug timing CSV for local diagnosis.
9. For NAADF preview or GI changes, also measure initial visual stability. Run:

```powershell
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-startup-stability.toml
```

Inspect the staged screenshots (`settle-120`, `settle-240`, `settle-360`, `settle-540`, `settle-720`, `settle-899`, `settle-1200`, `settle-1499`) and report the first `frame`/`elapsed_secs` in `summary.json` where the image is fully textured rather than the blue silhouette/early occupancy preview. Treat `ready_wait_secs` and `render_ready_secs` as runtime readiness only; they do not prove visual texture stability. Include those timings, NAADF preview counters, and any startup trace phase CSVs from the run.
10. For NAADF-only preview performance, run the fullscreen preview-only scene, which disables legacy terrain, water, buildings, shadows, reflections, and prop queues:

```powershell
rtk cargo run --release --features naadf -- --bench bench/scenes/naadf/visual-regression-naadf-preview-only.toml
```

## Expected Workflow

1. Run a baseline bench for the relevant scene.
2. Make the change.
3. Re-run the same bench scene.
4. Compare `summary.json`, screenshots, and any relevant counters.
5. State the measured result plainly, including regressions if they exist.

If you did not profile a performance-sensitive change, say that explicitly instead of implying the result is verified.

## Compile-Time Notes

- Project Cargo config already enables `sccache` via `.cargo/config.toml`; keep it unless diagnosing compiler-wrapper issues.
- `Cargo.toml` already enables Bevy `dynamic_linking` and dev profile optimizations for faster local iteration. Do not remove those for normal development.
- Do not add nightly-only compile accelerators such as the parallel front-end or Cranelift to the default project config unless the task explicitly asks for that experiment.
- If changing linker/debug-info/profile settings to reduce compile times, verify the exact command still works on Windows and document the tradeoff. Avoid shipping/release claims from dynamic-linking dev builds.

## Gameplay, Spawn, And Collider Benches

Use the collider walk bench when changing spawn placement, player movement, terrain colliders, terrain readiness, or fall-through guards:

```powershell
rtk cargo run --release -- --bench bench/scenes/collider/collider-walk-log.toml
```

This bench drives spawn-adjacent routes, a historical fall-through route, and a dig-crust checkpoint that digs beneath the player and verifies the hard crust rejects below-floor/bedrock edits. It logs player coordinates, validity, collider readiness, stall events, fall-through events, and dig/crust rejection counters, and uses simple path steering to turn at borders and avoid missing ground or steep/blocking terrain.

Runtime, editor viewport, and bench launches share the same runtime lock by default so only one Drusniel runtime runs at a time. Use `DRUSNIEL_BENCH_RUNTIME_LOCK` only when an isolated bench lock is intentional.

## Editor Runtime Verification

Rebuild the editor runtime sidecar and restart the desktop editor only when the task changes an editor-facing path: the editor UI, Tauri integration, editor bridge/protocol, editor native viewport behavior, editor runtime sidecar packaging, or behavior that was explicitly requested to be verified inside the desktop editor.

Main play-game runtime, rendering, meshing, benchmark, and gameplay diagnostics do not require starting or restarting the desktop editor unless the user asks to verify them through the editor. For those tasks, verify with the relevant game binary, bench scene, or targeted runtime probe instead.

When editor verification is relevant, use the existing editor scripts from `editor/frontend`; do not assume Rust code changes are visible in the editor until the sidecar has been rebuilt and the editor has been restarted.

## Rule

Always prefix shell commands with `rtk`.

Examples:

```bash
rtk git status
rtk cargo test
rtk npm run build
rtk pytest -q
```

## Meta Commands

```bash
rtk gain            # Token savings analytics
rtk gain --history  # Recent command savings history
rtk proxy <cmd>     # Run raw command without filtering
```

## Verification

```bash
rtk --version
rtk gain
which rtk
```

## Editor Diagnostics

Use `DRUSNIEL_EDITOR_DIAGNOSTICS=1` when starting the editor/runtime to enable heavy, structured diagnostics for viewport input, targeting, selection, native viewport attach/focus, and bridge behavior. Keep it disabled by default; enable it only for focused debugging sessions and include the relevant log excerpts when reporting findings.

When diagnostics are enabled, the Tauri shell also exposes a local-only screen simulation endpoint at `http://127.0.0.1:17778` for automated verification:

```powershell
$env:DRUSNIEL_EDITOR_AUTOMATION_TOKEN = "replace-with-local-random-token"
curl http://127.0.0.1:17778/health
curl -X POST -H "Authorization: Bearer $env:DRUSNIEL_EDITOR_AUTOMATION_TOKEN" http://127.0.0.1:17778/focus
curl -X POST -H "Authorization: Bearer $env:DRUSNIEL_EDITOR_AUTOMATION_TOKEN" "http://127.0.0.1:17778/screenshot?label=viewport-check"
curl -X POST -H "Authorization: Bearer $env:DRUSNIEL_EDITOR_AUTOMATION_TOKEN" "http://127.0.0.1:17778/move?space=viewport&x=100&y=100"
curl -X POST -H "Authorization: Bearer $env:DRUSNIEL_EDITOR_AUTOMATION_TOKEN" "http://127.0.0.1:17778/click?space=viewport&x=100&y=100&button=left"
```

Use `space=viewport` for native Bevy viewport-relative coordinates, `space=window` for editor-window-relative coordinates, and `space=screen` for absolute screen coordinates.

`DRUSNIEL_EDITOR_AUTOMATION_ADDR`, when set, must still bind to loopback (`127.0.0.1` or `::1`). Do not expose screen simulation on a LAN or wildcard address. The HTTP endpoint will not start unless `DRUSNIEL_EDITOR_AUTOMATION_TOKEN` is set to a non-trivial local token; send it as `Authorization: Bearer <token>` for every non-health request.

Viewport/window mouse actions intentionally fail if the editor cannot become the foreground window, preventing accidental clicks into another app. Screenshots use the Tauri window capture path first, so they can still verify editor layout when another window is covering the desktop.

## Terrain Debug Views

Live in-game overlays for diagnosing LOD seams, holes, normals, and skirt
geometry. Implementation: [`src/voxel/terrain_debug.rs`](src/voxel/terrain_debug.rs).
Plan + interpretation recipe: [`docs/lod/wireframe-debug-plan.md`](docs/lod/wireframe-debug-plan.md).

| Hotkey | What it does | Output |
|---|---|---|
| **Alt+F7** | Toggle wireframe overlay on terrain. Edges drawn from barycentric UVs, coloured by mesh section × LOD tint. | On-screen indicator: "TERRAIN DEBUG: WIRE ON" |
| **Alt+F8** | Toggle normals-as-colour mode. Replaces lit terrain with `vec3(world_normal * 0.5 + 0.5)`. Combinable with Alt+F7. | On-screen indicator: "TERRAIN DEBUG: NORMALS ON" |
| **Alt+Shift+F7** | Capture current frame. ⚠ Known bug: also fires the Alt+F7 toggle — state flips on every capture. | `debug/wireframe-<ts>.png` + `debug/wireframe-<ts>.json` (camera pose, FOV, mode flags, terrain settings hash) |
| **Shift+F9** | Terrain hole-probe dump (per-chunk LOD, neighbor LODs, snap stats, lod-delta>1 faces, missing-neighbor counts). | `debug/terrain-hole-probe-<ts>.json` |

Wireframe colour key — section × LOD tint:

| Section colour | Meaning | | LOD tint | LOD |
|---|---|---|---|---|
| White | Main Surface Nets mesh | | White (none) | LOD0 |
| Cyan | Horizontal skirt / transition apron | | Dark blue | LOD1 |
| Magenta | Vertical skirt | | Green | LOD2 |
| Yellow | Transvoxel transition apron (MC+Transvoxel) | | Orange | LOD3 / Culled |

Diagnostic recipe (friend's rule of thumb, per [`docs/lod/wireframe-debug-plan.md`](docs/lod/wireframe-debug-plan.md) WIRE-008):

- **Stepped geometry** in wireframe → DC/QEF/SDF placement issue.
- **Smooth geometry, stepped colour in Alt+F8** → normals issue (not geometry).
- **Holes (no triangles where there should be some)** → missing chunk / failed mesh / wrong dirty flag. Cross-check `missing_boundary_neighbors_at_mesh` in the hole-probe dump.
- **Coloured (non-white) edges visible at an altitude band** → a skirt is being used to hide a real gap. Skirt is a band-aid, not a fix.

To launch with MC+Transvoxel for an A/B against Surface Nets, use `.\scripts\startVoxels.ps1 -Mc` (also compiles in the `mc_transvoxel` cargo feature) and set `enabled: true` + `mode: replace_surface_nets` in [`assets/config/mc_transvoxel.yaml`](assets/config/mc_transvoxel.yaml). Pre-staged config variants live at [`bench-runs/baseline-mctx/mc_transvoxel.{replace,sandbox}.yaml`](bench-runs/baseline-mctx/).

Standard commands the agent should use:

```bash
make dev          # Start local development environment
make test         # Run full test suite
make lint         # Run Go and TypeScript linters
make reconcile   # Run reconciliation harness against Power BI
make build        # Build production artifacts
```

Do not invent new commands. Add to Makefile via PR if a new command is needed.

Protect context usage. **Any command with unknown or potentially large output must be byte-capped.**

Default pattern:

```bash
COMMAND 2>&1 | head -c 4000
```

# Behavioral guidelines to reduce common LLM coding mistakes. 

Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

