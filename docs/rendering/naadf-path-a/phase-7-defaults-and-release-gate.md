# Phase 7 — Defaults, Release Gate, and SDF-Drop Evaluation

Status: planned
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

- For each query class that passed its phase gate, change the
  `RayTracingSettings` default so it selects `GI_BACKEND_NAADF`.
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

## Acceptance criteria

- [ ] Proven query classes default to NAADF; unproven ones stay on SDF.
- [ ] SDF fallback intact and tested for warming / stale / integrated GPU.
- [ ] Release gate written and all its boxes checked, or the unmet boxes
      listed explicitly.
- [ ] SDF-volume-build skip evaluated with before/after bench evidence.
- [ ] Parity and JIRA docs updated.

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

Defaults reflect the evidence, the release gate is written and assessed, and
the SDF-drop opportunity is measured rather than assumed.
