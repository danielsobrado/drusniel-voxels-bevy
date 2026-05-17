# NAADF Release Gate

Status: Path A release gate assessed on 2026-05-16; default promotion not passed.

NAADF remains disabled by default for the application. Path A lighting queries
are implemented behind explicit toggles, but they do not default to NAADF
traversal because the active render-app pass is not yet perf-neutral.

## Gate Checklist

- [x] CPU/GPU traversal and record parity tests pass.
  - `rtk cargo test --features naadf rendering::naadf --lib`
  - `rtk cargo test --features naadf --test naadf_gpu_layout`
- [ ] Every NAADF-routed query has an SDF-vs-NAADF `summary.json` pair showing
      win-or-neutral frame time on the validation machine.
- [x] Visual regression screenshots show no unacceptable GI regression at the
      fixed checkpoints.
- [x] `bench_guard` passes on the NAADF GI and all-query benches.
- [x] Cache warming and stale-cache fallback remain covered by backend-selection
      tests; integrated GPU remains disabled by default.
- [x] The current renderer remains the default when NAADF is not explicitly
      selected.
- [x] Known regressions or caveats are listed below.

## Evidence

### Parity and Unit Tests

- `rtk cargo check --features naadf`
- `rtk cargo test --features naadf rendering::radiance_cascades --lib`
  - 18 passed.
- `rtk cargo test --features naadf rendering::naadf --lib`
  - 119 passed.
- `rtk cargo test --features naadf --test naadf_gpu_layout`
  - 2 passed.

### Query Benches

| Query class | SDF summary | NAADF summary | Result |
| --- | --- | --- | --- |
| Sun visibility | `bench-runs/phase3-sdf/summary.json` | `bench-runs/phase3-naadf-sun/summary.json` | NAADF faster in Phase 4 validation: 58.99 -> 40.24 ms median, 92.22 -> 55.30 ms p99. |
| Contact shadows | `bench-runs/phase5-contact-sdf/summary.json` | `bench-runs/phase5-contact-naadf/summary.json` | NAADF neutral/win: 35.74 -> 35.24 ms median, 41.01 -> 38.64 ms p99. |
| Terrain AO | `bench-runs/phase5-terrain-ao-sdf/summary.json` | `bench-runs/phase5-terrain-ao-naadf/summary.json` | NAADF neutral/win: 35.51 -> 35.35 ms median, 39.92 -> 38.22 ms p99. |
| GI secondary | `bench-runs/phase6-gi-sdf/summary.json` | `bench-runs/path-a-review-gi-secondary-active/summary.json` | Active NAADF pass is not perf-neutral: 36.97 -> 54.94 ms median, 39.13 -> 69.09 ms p99. |
| All Path A queries | `bench-runs/path-a-review-default-routing-final/summary.json` | `bench-runs/path-a-review-all-active-final2/summary.json` | Active all-query path is opt-in only: default routing reports pass active 0 and all-query reports pass active 1 with 2/1/4 rays per pixel. |

All accepted NAADF Phase 5, Phase 6, Phase 7, and review runs passed `bench_guard`
with `PASS: 187 check(s), 0 warning(s).`

### Visual Evidence

Inspected fixed-checkpoint screenshots:

- `bench-runs/phase5-contact-naadf/visual-regression-naadf-contact-naadf-contact-naadf-contact-settled-run0.png`
- `bench-runs/phase5-terrain-ao-naadf/visual-regression-naadf-terrain-ao-naadf-terrain-ao-naadf-terrain-ao-settled-run0.png`
- `bench-runs/path-a-review-gi-secondary-active/visual-regression-naadf-gi-secondary-naadf-gi-secondary-naadf-gi-secondary-settled-run0.png`
- `bench-runs/path-a-review-all-active-final2/visual-regression-naadf-path-a-all-naadf-path-a-all-naadf-path-a-all-settled-run0.png`

## Defaults

Checked-in `assets/config/naadf.yaml` remains `enabled: false` and
`gpu.allow_integrated_gpu: false`.

When NAADF is selected and ready, these Path A query toggles default to false
and must be enabled explicitly for opt-in review benches:

- `use_for_gi_secondary`
- `use_for_sun_visibility`
- `use_for_terrain_ao`
- `use_for_contact_shadows`

## Known Caveats

- The SDF volume update skip is implemented and tested, but the current SDF
  update path is still a stub. The Phase 7 bench therefore proves the skip is
  neutral, not that it is a meaningful performance win.
- Active Path A GI-secondary/all-query routing is visually sane and guard-clean,
  but not perf-neutral. It is not default-promotable yet.
- Integrated-GPU fallback is verified by policy/configuration and backend tests;
  this run did not include a physical integrated-GPU hardware pass.
- NAADF Path A is a lighting backend. The legacy mesh/PBR/grass renderer still
  draws the frame.
