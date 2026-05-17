# Phase 7 — Defaults, Release Gate, and SDF-Drop Evaluation

Status: completed; release gate not passed for default promotion
Depends on: Phase 6
Produces code: yes

## Goal

Promote the proven NAADF query classes to default, define the release gate
that lets Path A move from experimental to supported, and evaluate the one
real performance opportunity: dropping the SDF volume build pass.

## Why

After Phases 3-6, each query class has its own evidence. Phase 7 turns that
evidence into a default configuration and a clear, checkable release bar, and
asks the one question that can make Path A a performance win rather than a
quality-neutral change.

## Work

### 7.1 Flip defaults for proven queries

- For each query class that passed its phase gate, change the checked-in
  NAADF query default so it selects the NAADF radiance backend when NAADF is
  the effective voxel backend.
- Query classes that did not pass stay on SDF.
- The SDF backend remains as the fallback for cache warming, stale cache, and
  integrated GPU. It is not removed — that is a project non-goal.

### 7.2 Define the release gate

Path A is "supported experimental" when all of the following hold:

- [ ] CPU/GPU traversal parity tests pass.
- [ ] Every NAADF-routed query has an SDF-vs-NAADF `summary.json` pair showing
      win-or-neutral frame time.
- [ ] Visual regression screenshots show no unacceptable GI regression.
- [ ] `bench_guard` passes on the NAADF GI bench.
- [ ] Cache warming / stale / integrated-GPU fallback to SDF is tested.
- [ ] The legacy renderer remains correct and default for everything Path A
      does not cover.

Record this gate in `docs/rendering/naadf-release-gate.md`.

### 7.3 Evaluate dropping the SDF volume build

- The SDF GI path requires building/updating the SDF 3D texture every frame.
- If NAADF now answers every GI query well, that build pass is dead weight for
  the common (cache-ready) case.
- Measure: bench with the SDF volume build still running vs skipped while
  NAADF is active. The SDF path must still be reconstructable for the fallback
  case, so this is "skip when not needed", not "delete".
- Only this step can turn Path A into a measured frame-time win. Do not claim
  it without the before/after `summary.json`.

### 7.4 Update documentation

- Update `naadf-upstream-parity.md` query rows to their final status.
- Update `naadf-completion-jira-plan.md` NAADF-GI tickets.
- Note in `README.md` of this plan which phases shipped and which stopped.

## Result

All four Path A lighting query classes are implemented behind explicit toggles,
but they do not default to NAADF. Review found that the radiance-cascade plugin
was not installed during the first Phase 6/7 benches. Once the pass was
registered and active, the all-query path was materially more expensive than
the earlier configuration-only numbers.

- `use_for_gi_secondary: false`
- `use_for_sun_visibility: false`
- `use_for_terrain_ao: false`
- `use_for_contact_shadows: false`

`naadf_query_mask_from_config` is now driven by explicit query toggles only;
the radiance backend no longer infers GI-secondary routing from the preview
`bounce_count`. The SDF fallback remains intact because backend selection still
zeros the query mask whenever the effective backend is `CurrentSdf`.

The SDF volume update path now skips work when all four NAADF query bits are
active. The current SDF update implementation is a stub, so this is an
observability/correctness gate rather than a proven performance win.

- Default-routing review run: `bench-runs/path-a-review-default-routing-final/summary.json`
  - 50.95 ms median, 84.57 ms p99.
  - `naadf.radiance_cascade_pass_active`: 0.
  - GI/contact/AO query counters: 0 / 0 / 0 rays per pixel.
  - SDF update needed: 1.
- Opt-in all-query active run: `bench-runs/path-a-review-all-active-final2/summary.json`
  - 46.60 ms median, 69.23 ms p99.
  - `naadf.radiance_cascade_pass_active`: 1.
  - GI/contact/AO query counters: 2 / 1 / 4 rays per pixel.
  - 282 slots used, 0 missing interest slots, 203 uploaded chunks peak.
- SDF update needed: 0; SDF skip counter advances.
- Guard: `bench-runs/path-a-review-all-active-final2-guard.log`
  - `PASS: 187 check(s), 0 warning(s).`
- Screenshot inspected:
  - `bench-runs/path-a-review-all-active-final2/visual-regression-naadf-path-a-all-naadf-path-a-all-naadf-path-a-all-settled-run0.png`

## Acceptance criteria

- [x] Proven query classes remain explicit opt-ins until active-pass benches
      justify default promotion.
- [x] SDF fallback intact and tested for warming / stale / integrated GPU.
- [x] Release gate written and all its boxes checked, or the unmet boxes
      listed explicitly.
- [x] SDF-volume-build skip evaluated with before/after bench evidence.
- [x] Parity and JIRA docs updated.

## Verification

```powershell
rtk cargo test --features naadf rendering::naadf --lib
rtk cargo test --features naadf rendering::radiance_cascades --lib
rtk cargo run --release --features naadf -- --bench bench/scenes/visual-regression-naadf-gi.toml
rtk cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

## Risks

- Flipping a default is the moment a regression reaches everyone who enables
  NAADF. Do not flip a query class that only has "neutral on one machine"
  evidence.
- Skipping the SDF build while a code path still expects the SDF texture
  causes fallback-time failures. The skip must be conditional on NAADF being
  ready and must be reversible within a frame.

## Exit gate

Defaults reflect the active-pass evidence by staying closed. The release gate
is written and assessed, and the SDF-drop opportunity is measured rather than
assumed.
