---
name: visual-qa
description: Validate a visual or performance measurement before trusting it, and run the clod-poc QA/shot/perf harnesses correctly. Use when measuring a rendering change, A/B-ing a fix, driving a visual bisect, claiming a perf win or regression, or when a metric looks suspiciously flat or suspiciously good.
---

# Visual QA

A metric that does not separate a known-good build from a known-bad one is not
evidence, however precise it looks. This skill exists because that check was skipped
once and invalidated an entire investigation's conclusions.

Reference: `docs/qa/visual-qa.md`, `docs/qa/STATUS.md`.

## 1. Validate the discriminator first

Before a signal is used to accept a fix, reject a hypothesis, or drive a bisect:

1. Run it on a **known-good** build.
2. Run it on a **known-bad** build.
3. Require clear separation. If good ≈ bad, the metric is measuring something else —
   stop and find a different signal. Do not proceed to unknowns.

Report the good/bad calibration numbers alongside any verdict. A verdict without them
is unfalsifiable.

Worked failure: a per-pixel flicker probe ran ~15 times and ruled out several
hypotheses before being checked against a known-good commit, where it read 17.0% vs
17.2% at the suspect. Every "disproven by measurement" verdict built on it had to be
withdrawn. See `docs/tree-flicker-and-vegetation-regressions-2026-07-21.md`.

## 2. Confounds to rule out explicitly

- **Flag mismatch.** The probe URL must match the repro URL. Flags like
  `webgpuSelection=1` and `materialTiers=1` select different code paths; a probe
  without them cannot observe a bug that needs them.
- **Missing hooks.** `customProps=1` is required for `setPose` and the automation
  hooks. Without it the probe silently measures the default far camera.
- **The world moves between commits.** Vegetation/erosion/authority changes relocate
  content, so a fixed pose is in-canopy at one commit and open field at the next. A
  low reading may mean "nothing in frame". Check the captured frame, or re-derive the
  pose per commit.
- **Throttled counters.** Debug counters mirrored on a 250ms tick
  (`DEBUG_COUNTER_MIRROR_INTERVAL_MS`) cannot express per-frame behaviour.
- **Stale counters.** Some mirrors are guarded by `if (currentStats)` and freeze at
  their last write when the underlying getter returns null (e.g. after `setPose`).
  Confirm a counter *responds* to the variable you are changing before believing it.
- **Coverage dependence.** Prefer per-object normalisation over per-screen-pixel when
  on-screen content differs between the builds compared.

## 3. Broken builds are skips, not verdicts

A commit that renders nothing (e.g. composed WGSL failing with `unresolved call
target`) cannot vote. Screen it out first:

```powershell
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5181 --strictPort
$env:CLOD_POC_BASE_URL="http://127.0.0.1:5181/"; npx tsx tools/screen-tree-buildable.ts
```

Grepping the source `.wgsl` is not sufficient — a function can be defined and called
in the same file and still be unresolved after `wgsl_modules.ts` composes it. Check
the composed result in the browser.

Binary, unambiguous signals (compile error present, mesh count zero) are safe to
automate. Subjective ones ("is it flickering") currently are not — a human glance is
the working discriminator for those, so spend those glances carefully: pre-screen
broken commits, and pick bisect points that split the range most.

## 4. Harnesses

Vite-based commands run **without** `rtk`; `rtk cmd /c` only sets env for Node tools.

```powershell
npm --prefix tools/clod-poc run typecheck   # tsc only — rtk OK
npm --prefix tools/clod-poc test            # vitest — NO rtk
npm --prefix tools/clod-poc run build       # vite build — NO rtk
npm --prefix tools/clod-poc run qa -- --summary tests/qa-sample-summary.json
```

Perf A/B — same world, scene, warmup, and frame count on both sides:

```powershell
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
rtk cmd /c "set CLOD_POC_BASE_URL=http://127.0.0.1:5180/&& npm --prefix tools/clod-poc run perf:main -- --world 8 --warmup 120 --frames 300 --case current-textured --out perf-runs/baseline"
```

Use `--warmup 600` when WebGPU compute pipelines, indirect draws, or debug readbacks
are involved; async pipeline compilation otherwise pollutes the sample window.

Deterministic shots use `window.__drusnielClod` (`ready`/`error`, `diag`, `stats`,
`setPose`/`getPose`, `settle`, `flyCamEnabled`).

## 5. Reporting

State the scene, the before/after numbers from `summary.json`, the counters that
moved, and any visual tradeoff. Include the good/bad calibration for the metric used.
**If a change was not benchmarked, say so directly.** Do not claim a perf fix from FPS
alone, and do not relax a threshold to hide a regression.
