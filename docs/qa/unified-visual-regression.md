# Unified visual and performance regression

The canonical QA configuration is now owned by:

```text
validation/manifests/visual-regression.yaml
validation/manifests/performance-regression.yaml
validation/manifests/legacy-id-map.yaml
```

The old CLOD-POC `config/qa_visual.yaml` and `config/qa_perf_move.yaml` files are removed. Do not recreate thin copies or generated mirrors.

## Static validation

```powershell
npm --prefix tools/clod-poc run visual:validate
cargo run --bin qa -- --manifest-validate-only
```

Both loaders reject unknown fields, duplicate scene and gate IDs, unsafe baseline paths, invalid gate payloads, and unsupported schema versions.

## Evaluate a CLOD summary

```powershell
npm --prefix tools/clod-poc run qa -- --tags legacy-visual --summary <qa-summary.json> --output validation-runs/<run>
npm --prefix tools/clod-poc run qa -- --tags movement --summary <qa-summary.json> --output validation-runs/<run>
```

The runner writes:

```text
report.json
report.md
report.html
junit.xml
scenes/<target>/<scene-id>/diff.png
scenes/<target>/<scene-id>/heatmap.png
scenes/<target>/<scene-id>/changed-mask.png
```

Image comparisons use linear Rec.709 RGB. Timing and counter gates are absolute. Missing required metrics fail. Optional counters report `NOT_APPLICABLE`. Advisory timing thresholds never produce a release failure.

## Deterministic browser hook

CLOD-POC exposes `window.__drusnielQa` as a thin adapter over `window.__drusnielClod`. It does not copy runtime state. Freeze is refused until readiness counters converge, then freezes camera control and the existing acceptance-scene simulation state.

## Baselines

The manifests currently mark migrated image gates as non-required because authoritative Lane B baselines belong to QA-U7 and QA-U8. Timing, counter, readiness, schema, path, and report gates are active now.
