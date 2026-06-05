# MTX-037 — MC+Transvoxel Go/No-Go Memo

> Decided: 2026-06-05 · Decision: **NO-GO as a drop-in SN replacement** ·
> **PARTIAL-GO signal**: the perf result validates *face-local transition meshing* as
> the right direction once MC's holes are fixed.
> Method: A/B vs the current SN + transition-promotion path (`d78d0bb`), same binary,
> toggled by `assets/config/mc_transvoxel.yaml` `enabled` (`mode: replace_surface_nets`,
> `lod_delta_policy: max_one`). Scenes: `morph-seam-spike-probe.toml` (visual + hole
> probe at the spike mountain, camera `[315.6,36.7,356.2]`) and
> `visual-regression-live-lod.toml` (perf).

## Result vs the MTX-037 criteria

| # | Criterion | SN + promotion (baseline) | **MC replace_surface_nets** | Verdict |
|---|-----------|---------------------------|------------------------------|---------|
| 1 | Visual seam closure (no ledges/holes) | band closed; minor distant terracing | **visible holes** + **chunk-square / terrace lines**; skips `lod_delta>1` faces | **FAIL** |
| 3 | Hole-probe `solid-before-render` ray fraction ≤ 5% | ~16% (27/169) | **14.8% (25/169)** | **FAIL** (barely better than SN) |
| 4 | LOD step (height-fan interior median) ≤ 0.10 vox | interior −0.93 | interior −1.01, near_face −0.72 | ~parity (both have the smoothing convex bias) |
| 5 | Performance | frame p99 ~100 ms, **Mesh Dirty p99 ~60 ms** | **frame p99 ~28 ms, Mesh Dirty p99 ~1.5 ms** | **PASS (dramatic)** |
| 6 | Edit locality | n/a this run | not evaluated | — |

## What this means

- **MC does not close the seams better than SN+promotion** — the whole point of the
  spike. It leaves small holes (the open issues in
  [mc-transvoxel-hole-diagnosis.md](mc-transvoxel-hole-diagnosis.md)) and makes chunk
  boundaries read as a square/terrace grid, and its `max_one` policy logs
  `lod_delta_gt_one_face_mask … skipping transition on those faces` — those boundaries
  get no transition at all. User confirmed both in live view (holes + terrace lines).
- **But MC's perf is ~3–40× better on this workload** (frame p99 100→28 ms, Mesh Dirty
  p99 60→1.5 ms). That is the load-bearing finding: MC is cheap because it does **not**
  re-mesh a whole Lod1 ring at Lod0 — it meshes the chunk at its native LOD plus small
  transition cells, and throttles to `max_chunks_per_frame: 2`. The throttle also means
  slow convergence (stale chunks / transient holes during motion), so the perf number
  is not free — but the structural cost is far lower than whole-chunk promotion.

## Decision

**NO-GO** to switch the default to `McTransvoxel` now: it regresses the visual (holes +
chunk-seam terraces) that SN+promotion currently gets right, and the seam-closure and
ray-fraction gates fail.

**However**, MTX-037's perf evidence **confirms the face-local direction**: the SN
promotion's perf cost (`Mesh Dirty p99 ~60 ms`, the transient "moving cracks") is
inherent to whole-chunk Lod0 promotion, and a transition-cell mesher avoids it. The
productive path is therefore **fix MC's holes** (the diagnosis doc's open items) and the
`lod_delta>1` skip, then re-run this A/B — rather than keep paying the promotion's cost
or hand-rolling a third transition mesher on the SN path.

## Recommended next steps (priority order)

1. **Resolve the MC holes** ([mc-transvoxel-hole-diagnosis.md](mc-transvoxel-hole-diagnosis.md))
   and the chunk-seam grid; re-run this exact A/B (`morph-seam-spike-probe` +
   `visual-regression-live-lod`). Gate to flip on a PASS of criteria 1 & 3 while keeping
   the perf win.
2. Handle `lod_delta>1` transitions (currently skipped) so deep LOD jumps don't open
   untreated faces — or enforce a strict 2:1 LOD restriction so they never occur.
3. Until then, **production stays SN + promotion** (visual-correct, perf-regressed). The
   perf regression is documented in
   [lod-terrace-investigation.md](lod-terrace-investigation.md).

## Repro

```
# MC on:  set assets/config/mc_transvoxel.yaml -> mc_transvoxel.enabled: true
cargo run --release -- --bench bench/scenes/visual/morph-seam-spike-probe.toml      # visual + hole probe
cargo run --release -- --bench bench/scenes/visual/visual-regression-live-lod.toml  # perf
# then restore enabled: false
```
