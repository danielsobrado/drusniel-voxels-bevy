# QA Regression Harness Continuation Status

Status date: 2026-06-17.

This is the continuation ledger for `qa-regression-harness-plan.md`. Keep this
file current when a QA slice lands so the next agent can continue without
re-reading every implementation detail.

## Bevy Host QA

Status: v1 landed.

Done:

- Added `src/bin/qa.rs`.
- Added `src/diagnostics/qa/` modules for YAML config validation, bench
  `summary.json` parsing, image diff metrics, luminance probes, timing checks,
  JSON/Markdown reports, and the host runner.
- Added `assets/config/qa_visual.yaml` with one visual smoke scene:
  `visual_ridge_start` / `ridge-run-noon` / screenshot `start`.
- Added short docs in `docs/qa/STATUS.md` and `docs/qa/visual-qa.md`.
- Updated `qa-regression-harness-plan.md` to mark clod-poc as deferred from the
  Bevy PR and to document the actual command.
- Review follow-ups (2026-06-17): centralized constants in `qa/constants.rs`
  (schema version, Rec.709 luminance weights, default diff thresholds);
  `load_config` now resolves each scene's `bench_scene` against the real bench
  TOML and fails with `UnknownCheckpoint` / `UnknownScreenshotPoint` at load;
  `deny_unknown_fields` on the config structs so a typo'd key fails instead of
  silently using a default; a missing checkpoint/screenshot in the summary is
  now captured as a scene failure in the report instead of aborting the run;
  timing no longer hard-fails on a missing required metric when
  `fail_on_threshold` is false (status `missing_metric`); probe/timing failures
  carry LAAS-style "Likely:" cause hints; the Markdown report includes the exact
  reproduction command and next-action hints; added the image-diff,
  region-mean/unreadable-probe, and config-validator unit tests called for in
  the plan.

Command:

```powershell
rtk cargo run --bin qa -- --summary bench-runs/<run>/summary.json
```

Verified:

```powershell
rtk cargo test --lib qa::
rtk cargo check --bin qa
rtk cargo run --bin qa -- --summary bench-runs/2026-06-12T17-50-48Z/summary.json
```

The sample run reported `baseline_missing`, which is expected before committed
baselines exist.

Known gaps:

- The Bevy QA binary consumes an existing bench run; it does not spawn `--bench`
  yet.
- No baseline manifest exists yet.
- No committed visual baselines exist yet.
- Frame `p95` is not in the Bevy bench summary; v1 uses available frame fields
  such as `p99_frame_ms`.
- `cargo clippy --bin qa -- -D warnings` currently fails on existing workspace
  warnings outside the QA changes.

Next Bevy steps:

1. Add optional bench spawning to `src/bin/qa.rs`.
2. Add baseline manifest support.
3. Add a small committed smoke baseline set.
4. Add water and LOD movement scenes after baseline policy is settled.

## clod-poc Web QA

Status: v1 landed as an executable Node/TS report runner.

Done:

- Added `tools/clod-poc/src/qa.ts`.
- Added `npm run qa` (runs `tsx src/qa.ts`, matching the `spike`/`build-pages`
  convention; the earlier tsc-to-`.qa-tmp` runner shim was removed).
- Added `tools/clod-poc/config/qa_visual.yaml`.
- Added `tools/clod-poc/tests/qa-sample-summary.json`.
- Added `tools/clod-poc/src/qa.test.ts`.
- Review follow-up (2026-06-17): a missing checkpoint/screenshot now produces a
  failing report instead of throwing, mirroring the Bevy runner.

Command:

```powershell
rtk npm --prefix tools/clod-poc run qa -- --summary tests/qa-sample-summary.json
```

The clod-poc v1 runner uses the same high-level YAML/report shape as the Bevy
runner, but it consumes a web-captured summary JSON instead of reading PNG files
directly. Screenshot entries may carry luminance/diff metrics produced by a
browser capture tool.

Expected clod-poc summary shape:

```json
{
  "scene": "web",
  "checkpoints": [
    {
      "name": "main",
      "p95_frame_ms": 18.0,
      "areas": { "renderer": { "draw_calls": 128 } },
      "screenshots": [
        {
          "id": "viewport",
          "name": "viewport",
          "path": "sample://viewport",
          "metrics": {
            "luminance_mean": 0.48,
            "luminance_stddev": 0.17
          }
        }
      ]
    }
  ]
}
```

Known gaps:

- No Playwright/browser capture command exists yet.
- No `window.__clodQa` hook has been added to `main.ts` yet.
- The clod-poc runner does not parse PNG pixels itself; it evaluates metrics from
  captured summary JSON.
- Region probes require `metrics.regions` entries keyed by probe id or normalized
  region tuple unless the probe covers the full viewport.
- No clod-poc baselines are committed.

Next clod-poc steps:

1. Add a small `window.__clodQa` hook exposing `ready`, `stats`, `settle(frames)`,
   `getPose`, `setPose`, and `capture(name)`.
2. Add Playwright as a dev dependency and implement `tools/qa_capture.ts`.
3. Have the capture tool write the summary JSON consumed by `src/qa.ts`.
4. Add one committed smoke baseline or document a local-only baseline policy.

## Cross-Target Contract

Status: partial.

Shared:

- `qa_visual.yaml` uses the same top-level `qa.scenes[]`, `screenshots[]`,
  `probes[]`, and `timing[]` shape.
- Both runners write `qa-report.json` and `qa-report.md`.
- Both runners treat missing baselines as non-failing `baseline_missing` unless
  configured otherwise.

Still different:

- Bevy reads PNG files and computes image/probe metrics itself.
- clod-poc v1 reads precomputed screenshot metrics from a web summary.

Do not start rendering optimization plans that depend on visual regression safety
until the Bevy runner has a baseline workflow and at least one committed smoke
baseline.
