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
