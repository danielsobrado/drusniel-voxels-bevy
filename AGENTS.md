# Agent Instructions

This repo has an active rendering/performance workflow. Treat profiling as part of the implementation, not as optional cleanup after the fact.

## Profiling Rules

1. Any change that can affect rendering, terrain meshing, props, shadows, water, post-processing, or frame timing should be measured.
2. Use release benches for performance claims:

```powershell
cargo run --release -- --bench bench/scenes/visual-regression.toml
```

3. Benchmark variants already exist for common A/B work:
   - `bench/scenes/visual-regression-high.toml`
   - `bench/scenes/visual-regression-performance100.toml`
   - `bench/scenes/visual-regression-live-lod.toml`
4. Read `bench-runs/<run>/summary.json` and compare before/after numbers. Do not add broad timing rows together because some are parent/child or overlapping brackets.
5. For render investigations, use the built-in counters and timing rows first. If a change claims an improvement, report which rows changed and by how much.
6. Run the regression guard when the change touches known bottlenecks:

```powershell
cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

7. If the change is visual, inspect the fixed checkpoint screenshots from the bench output. Do not accept a performance win that introduces visible regressions unless the tradeoff is intentional and documented.
8. Outside bench mode, `VOXEL_RENDER_TIMING=1` enables the same render timing capture in the debug timing CSV for local diagnosis.

## Expected Workflow

1. Run a baseline bench for the relevant scene.
2. Make the change.
3. Re-run the same bench scene.
4. Compare `summary.json`, screenshots, and any relevant counters.
5. State the measured result plainly, including regressions if they exist.

If you did not profile a performance-sensitive change, say that explicitly instead of implying the result is verified.

## Editor Runtime Verification

After any task that changes the editor, the Bevy runtime, Tauri integration, viewport behavior, or editor-visible UI, rebuild the editor runtime sidecar and restart the desktop editor so the change can be tested in the running app.

Use the existing editor scripts from `editor/frontend`; do not assume Rust code changes are visible in the editor until the sidecar has been rebuilt and the editor has been restarted.

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

```bash
curl http://127.0.0.1:17778/health
curl http://127.0.0.1:17778/focus
curl "http://127.0.0.1:17778/screenshot?label=viewport-check"
curl "http://127.0.0.1:17778/move?space=viewport&x=100&y=100"
curl "http://127.0.0.1:17778/click?space=viewport&x=100&y=100&button=left"
```

Use `space=viewport` for native Bevy viewport-relative coordinates, `space=window` for editor-window-relative coordinates, and `space=screen` for absolute screen coordinates.

Viewport/window mouse actions intentionally fail if the editor cannot become the foreground window, preventing accidental clicks into another app. Screenshots use the Tauri window capture path first, so they can still verify editor layout when another window is covering the desktop.

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
