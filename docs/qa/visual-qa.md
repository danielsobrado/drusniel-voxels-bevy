# Visual QA

The Bevy QA harness slice is host-side. It does not alter the game startup path.
It reads an existing bench `summary.json`, resolves configured
checkpoint screenshots, runs optional image diffs, runs luminance probes, checks
timing thresholds, and writes durable JSON/Markdown reports.

Run a bench first, then run QA against the produced summary:

```powershell
rtk cargo run --release -- --bench bench/scenes/visual/visual-regression.toml
rtk cargo run --bin qa -- --config assets/config/qa_visual.yaml --summary bench-runs/<run>/summary.json --output bench-runs/qa/<label>
```

Missing baselines are reported as `baseline_missing` and exit successfully unless
`fail_when_baseline_missing` is enabled in the config. To create/update local
baselines from a known-good run:

```powershell
rtk cargo run --bin qa -- --config assets/config/qa_visual.yaml --summary bench-runs/<run>/summary.json --output bench-runs/qa/<label> --update-baselines
```

Current supported checks:

- `region_luminance`
- `region_variance`
- `pixel_luminance`
- image diff metrics against configured baselines
- timing thresholds from existing `summary.json` fields and area rows

The default config is `assets/config/qa_visual.yaml`. It intentionally starts
with one visual smoke scene so the harness stays cheap while the schema settles.

Config is validated on load: unknown keys are rejected, and each scene's
`bench_scene` / `checkpoint` / screenshot names are resolved against the real
bench scene TOML, so a typo fails immediately instead of producing an empty run.
A checkpoint or screenshot that is present in config but missing from the
consumed `summary.json` is reported as a scene failure (it does not abort the
whole run), and the Markdown report prints the exact command to reproduce it.

clod-poc has a matching executable first slice:

```powershell
rtk npm --prefix tools/clod-poc run qa -- --summary tests/qa-sample-summary.json
```

That runner consumes web-captured summary JSON with precomputed screenshot
metrics. Browser capture and Playwright automation are tracked in
`docs/plans/qa-regression-harness-continuation-status.md`.

## Validate the discriminator before you trust it

A metric that does not separate a known-good build from a known-bad one is not
evidence, however precise it looks. Before using any new visual or perf signal to
accept a fix, reject a hypothesis, or drive a bisect:

1. Run it on a **known-good** build and a **known-bad** build.
2. Require a clear separation between them.
3. Only then spend it on unknowns.

Skipping step 1 is expensive. In the 2026-07-21/22 tree-flicker investigation, a
per-pixel flicker probe was run ~15 times and used to rule out several hypotheses
before anyone checked it against a known-good commit — where it read **17.0%**,
against 17.2% at the suspect commit. It had never been measuring the bug, and every
"disproven by measurement" verdict built on it had to be withdrawn. Full write-up:
[`../tree-flicker-and-vegetation-regressions-2026-07-21.md`](../tree-flicker-and-vegetation-regressions-2026-07-21.md).

### Confounds that invalidate a browser measurement

- **Different flags, different code path.** A probe URL that omits the flags the bug
  needs measures a configuration that cannot reproduce it. Match the repro URL
  exactly — e.g. `webgpuSelection=1&materialTiers=1` selects the WebGPU path, and a
  probe running without them exercises something else.
- **`customProps=1` is required** for `setPose` / automation hooks. Without it the
  probe silently measures the default far camera.
- **The world layout moves between commits.** Vegetation/erosion/authority changes
  relocate trees, so a fixed world pose is in-canopy at one commit and open field at
  the next. A low reading can mean "nothing in frame", not "no defect". Sanity-check
  the captured frame, or re-derive the pose per commit.
- **Counters may be throttled mirrors.** `trees.*` and friends are written on a
  250ms `DEBUG_COUNTER_MIRROR_INTERVAL_MS` tick, so they cannot express per-frame
  churn.
- **Counters may be stale rather than current.** The `trees.*` mirror is guarded by
  `if (currentTreeStats)`, and `getTreeStats()` returns null after `setPose`, so the
  values freeze at their last write. Verify a counter *responds* to the input you are
  varying before you believe a reading.
- **Coverage-invariance.** Prefer a signal normalised per-object over per-screen-pixel
  when the amount of content on screen can vary between the builds you compare.

### Screen out broken builds before spending human review

Some commits do not render the subject at all — e.g. a composed WGSL module failing
with `unresolved call target`, which produces an empty scene rather than a symptom.
These are **skips, not verdicts**, and voting on them corrupts a bisect.

```powershell
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5181 --strictPort
$env:CLOD_POC_BASE_URL="http://127.0.0.1:5181/"; npx tsx tools/screen-tree-buildable.ts
```

`tools/clod-poc/tools/screen-tree-buildable.ts` boots the page and reports
BROKEN/BUILDABLE from console WGSL errors plus tree-mesh presence. Binary,
unambiguous signals like this are safe to automate; subjective ones like "is it
flickering" currently are not.

Note that grepping the **source** file is not a sufficient screen: a function can be
defined and called in the same `.wgsl` file and still be unresolved after the
`wgsl_modules.ts` transforms compose it. Check the composed result in the browser.

## Reproduce the mechanism headless when the browser can't validate

Headless WebGPU is not reliable on every box (the 2026-07 investigation hit
`No Chromium launch recipe produced a stable WebGPU device`), and some bugs are not visual
at all — they live in CPU logic a screenshot cannot separate from its cause. For those,
reproduce the **mechanism** as a deterministic `vitest` integration test instead of chasing
it through the renderer.

Movement/gameplay logic (player controller, cell readiness, water authority, colliders, swim
contact) is pure CPU. `player/unknown_water_movement.test.ts` is the worked example: it walks
the real `PlayerController` across a hydrology-built boundary — dry inside the startup grid,
`"unknown"` beyond (exactly `water_authority.ts`'s `hydrologySampleReady` behavior) — on
collision-ready floor, and reproduces the "stuck at the frontier" freeze through **both** of
its independent paths (the `movementReadinessAt` look-ahead gate and the swim-contact
`blocked_unknown` freeze), with no GPU. That pinned the diagnosis when the browser trace
could not.

### State which link each test covers, and where the ceiling is

A headless mechanism test proves a *link*, not the whole chain. Say the ceiling out loud so a
green test is not mistaken for full validation. For the unknown-water movement freeze:

- `player/unknown_water_movement.test.ts` — *unknown water freezes movement* (fail-closed, intended).
- `water/hydrology_prefetch_lead.test.ts` — *the prefetch center leads the heading* (the fix's math).
- `water/hydrology_predictive_prefetch.test.ts` — *leading streams tiles ahead that camera-centering
  does not reach* (real `HydrologyTileCache` + a mock worker).
- **Browser-only:** whether the async tile worker keeps up under real movement so the frontier is
  never `"unknown"` — timing headless cannot model. Confirm that last mile in-browser (here,
  `?movementTrace=1` showing no `[water-freeze]` / `[movement-gate]` while walking).

Binary CPU reproductions like these are safe to trust and cheap to keep as regression gates; only
the GPU/worker-timing tail needs a human at the browser.
