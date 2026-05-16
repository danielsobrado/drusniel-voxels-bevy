# Phase 6 — Indirect GI Secondary Rays on NAADF

Status: planned
Depends on: Phase 5
Produces code: yes

## Goal

Route `NAADF_QUERY_GI_SECONDARY` through `trace_gi_backend()` to real NAADF
secondary-ray tracing — actual indirect bounce light feeding the radiance
cascades. This is the hardest query and is done last.

## Why

Indirect GI is the payoff: bounce light, color bleeding, sky contribution.
It is also the most expensive and the most sensitive to noise and traversal
cost, so it follows the cheaper occlusion queries that proved the traversal
path first.

## Target files

```text
assets/shaders/radiance_cascades.wgsl    (trace_gi_backend body)
assets/shaders/naadf/gi_trace.wgsl       (reuse hemisphere sampling helpers)
assets/shaders/naadf/world_trace.wgsl    (shared traversal from Phase 1)
src/rendering/radiance_cascades.rs       (query mask wiring, history reset)
```

## Work

### 6.1 Reuse the preview GI sampling

- `gi_trace.wgsl` already implements cosine-weighted hemisphere sampling with
  frame-index jitter and secondary sun-visibility rays.
- Reuse those helpers; do not write a second sampler. Factor them into a
  shared module if `gi_trace.wgsl` and the cascade both need them.

### 6.2 Replace the stub in `trace_gi_backend`

- `trace_gi_backend()` routes `NAADF_QUERY_GI_SECONDARY` to
  `trace_naadf_gi_unavailable()`. Replace with NAADF secondary-ray tracing via
  `trace_naadf_world`.
- Feed the bounce result into the cascade accumulation the same way the SDF
  secondary result is consumed today.

### 6.3 Frame jitter and history

- Secondary-ray samples must carry a per-frame seed so the radiance cascade
  temporal history can converge instead of locking to a biased estimate.
- A backend switch must reset GI history (`backend_switch_generation` already
  exists for this). Confirm the reset path fires.

### 6.4 Keep ray counts deterministic in bench mode

- Fixed seed and fixed sample count under `--bench` so screenshots are
  reproducible.

## Acceptance criteria

- [ ] `trace_gi_backend` traces NAADF secondary rays for the GI query, behind
      its toggle.
- [ ] Indirect contribution is visible in controlled fixtures and absent when
      the query is disabled.
- [ ] Backend switch resets GI history; no smear across the switch.
- [ ] Warming / stale cache falls back to SDF.
- [ ] GI bench frame time and noise are within agreed limits of the Phase 0
      baseline; screenshots show no unacceptable regression.

## Verification

```powershell
rtk cargo check --features naadf
rtk cargo test --features naadf rendering::radiance_cascades --lib
rtk cargo run --release --features naadf -- --bench bench/scenes/visual-regression-naadf-gi.toml
rtk cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

## Risks

- Indirect GI is noise-prone. Without per-frame jitter feeding temporal
  accumulation, it converges to a biased result rather than the true integral.
- Secondary rays multiply traversal cost. If Phase 4 showed NAADF traversal
  only neutral for a single ray, multi-ray GI may regress frame time. Bench
  early and honestly.

## Exit gate

NAADF indirect GI works behind a toggle, converges, falls back cleanly, and
meets the bench/visual limits.
