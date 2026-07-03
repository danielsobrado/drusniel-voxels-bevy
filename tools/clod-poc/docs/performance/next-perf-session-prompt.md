# Prompt: clod-poc performance session (caches / precalculation / budgets)

Paste this file's content (or reference its path) as the opening prompt of a fresh conversation.

---

You are working in `tools/clod-poc` (browser WebGPU three.js prototype, Vite + vitest + TSL node materials) of `danielsobrado/drusniel-voxels-bevy`. Goal: find and implement further performance improvements — caches, precalculations, budgeted/amortized work, dirty-tracking — **incrementally and evidence-first**. Work solo (no sub-agents, no cloud reviews), keep changes surgical, and update `tools/clod-poc/docs/performance/live-frame-cost-fix-report.md` as you go so progress survives token limits.

## Hard rules

- Evidence before optimization: measure with the hooks below, name the counter that justifies each change, and re-measure after.
- NEVER run vitest / vite build / perf tooling through `rtk` (breaks them with phantom errors). Only `rtk npm --prefix tools/clod-poc run typecheck` is rtk-safe. Native Windows shell, not WSL.
- Headed browser = real GPU; headless Playwright = SwiftShader (fake numbers, 0 trees).
- Don't trust the HUD "avg FPS" (since-startup average); use `window.__drusnielPerf.snapshot()`.
- One change at a time; typecheck + affected vitest suites after each; full suite before finishing.
- Do not rewrite the renderer / replace three.js / port to Bevy.

## State as of 2026-07-03 (all verified, see live-frame-cost-fix-report.md)

- Default scene (`http://127.0.0.1:5180/?perfProbe=1`) runs ~127 fps, frameMs ≈ 6.5 ms (was 2.8 fps / 333 ms). Root cause was the sun-visibility cache building one ~335 ms tile per frame (budget checked before build); fixed via allocation-free `heightAt`, resumable `stepLightTileBuild(deadline)`, real deadline, nearest-first pending with out-of-ring pruning. Kill switch `?sunLightCache=0`; stats `window.__drusnielSunLightStats()`.
- `farSummaryMs` is a composite bracket (sun light, NAADF, shadow proxy, far shell, biome stream, stats DOM, tiles); per-frame sub-buckets `farSum*Ms` now record in ALL scenes (module store in `src/app/frame_loop/far_summary_subphase_timing.ts`).
- Black tree impostors: `tree_impostor_baker.ts` albedo bake used classic `MeshBasicMaterial`+`onBeforeCompile` (silently dropped by WebGPURenderer → black atlases). WebGPU node-material branch added; **browser re-verify pending** (reload → impostors should be colored; debug-color-by-LOD shows purple for the impostor tier).
- GPU per frame ≈ 5 ms (`r.postfxScene` ~4.7); not a bottleneck today.
- Full suite last run: 380 files / 2101 tests green.

## Measurement hooks

- `?perfProbe=1` + `window.__drusnielPerf.snapshot()` → frameMs, all phase brackets incl. `farSum*Ms`, veg counters, `gpuPasses` (per-pass GPU ms; `render` is the TOTAL containing shadow/postfxScene/screen).
- `window.__drusnielSunLightStats()` → buildMsLastFrame/avg, pendingTiles, hits/misses, refreshes.
- Trees panel "debug color by LOD": near=green, mid=orange, far=blue, impostor=purple.
- P0 bench: `npm run perf:p0 -- --renderer webgpu --out ../../validation-artifacts/clod-poc-p0-<name> --world 8 --seed 1 --warmup 120 --frames 300 --timeout 240000` (gates in `tools/perf-p0-gates.ts`). Do NOT edit the repo while it runs (dev-server HMR corrupted a previous run).
- Perf A/B harness + shot harness commands: see repo `CLAUDE.md`.

## Ranked open leads (each with its evidence)

1. **Re-run the P0 bench** post-fixes. The old run's `farSummaryMs` p50 ≈ 30 ms / p95 375–620 ms was plausibly the sun-light builder; expect collapse. The 2 failed cases were mid-run-commit contamination; `far-summary-source-evidence` gate is structurally unpassable (far-summary *accepts* fall through by design; grass skips classification via `minClusterSize: 16`; trees never enter the prefilter) — fix plan §4/§5 of `clod-poc-critical-path-fix-plan.md` (Fixes 1.2, 1.3, 1.5).
2. **NAADF job queue stuck**: bench finalCounters showed `naadf_queued_jobs` 4,252 vs `naadf_committed_jobs` 8, resident chunks ~4,100. Check `farSumNaadfMs` first; if the queue is scanned per frame or never drains, that's a cache/drain bug (entry: `naadfIntegration.update` from `clod_poc_bootstrap.ts` ~line 422).
3. **Grass renders 0 blades** in the default scene (`grassGpuCandidateCountBeforePrefilter: 0`, HUD "0 blades patches=4/4") — correctness first; it will add GPU cost once fixed, so re-baseline after.
4. **Latent far-summary tile-cache churn**: `src/far-summary/summary-cache.ts` marks ready tiles stale after 1 untouched frame, cools after 2; `integration.ts` calls `buildSomeTiles` with an UNBOUNDED default budget every frame. All counters were 0 in tested scenes (inactive) — fix before any scene activates it; same resumable-deadline pattern as sun light applies.
5. **Shadow proxy builds**: `shadow_proxy_build_ms` 2.0–3.2 s cumulative (bench scene), grid 512 / 263k verts, runs inside the farSummary bracket (`farSumShadowProxyMs` now measures it). Budget/chunk or skip-when-unchanged if it shows up.
6. **Vegetation early-reject is ~inert** (−1.0% candidates): grass (147k candidates) bails on `minClusterSize`, trees (61.5k) never prefilter. Candidate-budget win, not frame-ms (vegetationTotalMs ≈ 0.7 ms) — only pursue when GPU candidate budgets matter.
7. **18 full far-summary-atlas uploads** per frozen bench case with `fallbackReasonCode=0` (dirty path otherwise healthy, dirtyPct 0.03) — find what forces full invalidation (`src/naadf/gpu/farSummaryAtlas.ts`, upload config).
8. **Sun-light follow-ups**: per-tile cost still ~20–30 ms (amortized); ring warmup ~30 s+. Ideas: worker offload, hierarchical/max-mip ray march, shorter `max_distance_world`, prioritized budget increase during warmup. Config: `src/app/config/sun_light.yaml`.
9. **`r.postfxScene`** re-check after impostor fix + grass fix add real pixels; froxel compute is cheap (~0.5 ms). PostFX parity work is tracked separately (`docs/plans/clod-poc-fable5-postfx-alignment-jira-plan.md`).
10. **Terrain material cache** default-on (bench pair showed it removes ~236 ms of worst-case spikes; hits 304/misses 189, stale 0) — plan Fix 2.3.

## Key docs

- `tools/clod-poc/docs/performance/live-frame-cost-fix-report.md` — what was fixed today + verified numbers (keep updating this).
- `tools/clod-poc/docs/performance/clod-poc-critical-path-fix-plan.md` — P0 bench analysis, failed gates, phased fixes.
- `tools/clod-poc/docs/performance/p0-performance-validation.md` — P0 runner/gate reference.

## Commands

```powershell
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort   # dev server (no rtk)
rtk npm --prefix tools/clod-poc run typecheck                                      # tsc only — rtk OK
npm --prefix tools/clod-poc test -- <path-filter>                                  # vitest — NO rtk
npm --prefix tools/clod-poc test                                                   # full suite before finishing
```

Start with lead 1 (P0 re-run) or lead 2 (`farSumNaadfMs` reading) — both are cheap evidence steps that decide everything after.
