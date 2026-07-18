# Long-Map Soak and Streaming Execution — proving continuous play at continent scale

Created 2026-07-16. Status: **IN PROGRESS** (progress refreshed 2026-07-18).

Revised same day after an external review and a repo re-read. The first draft was written
hours before the unified-streaming implementation landed and was stale on arrival; this
revision is rebased against the implementation handover. Accepted from the review: LM0
rebased to the real current state; the mirror checklist replaced by a versioned
dependency record; visual closure made a prerequisite of the long soak; two route
profiles (infrastructure vs representative density); percentile gates extended with
worst-frame and threshold-bucket metrics; the frozen-diff precision test hardened into a
deterministic diagnostic mode with targeted signals; diagonal-rim poses added; "green two
consecutive days" replaced by a 5-run repeatability protocol plus environment records;
heap-slope replaced by envelope + resource-lifecycle metrics; revisit legs must prove
eviction; the teleport drill now depends on plan 3's readiness contract instead of a
second interim definition; device-loss scope labeled as the fail-loud baseline with
recovery as a recorded future contract.

Plan 1 of 5 toward the browser RPG target (procedural ocean-bounded continent with free
building, terrain deformation, melee + magic, settlements and dungeons; single-player;
desktop Chromium WebGPU). Owner decisions locked 2026-07-16: Valheim-scale continent
(~10 km radius); agents/sailing/collapse out of scope here (plans 2 and 3).

## Progress snapshot (2026-07-18)

**Where we are:** substrate proof is closed. LM0 (including visual QA), LM1, LM2 (fp32
keep), and **LM3 infrastructure** coast-to-coast are green. Representative dense content
is wired into the route runner; short-route calibration numbers exist but thresholds are
**not frozen** yet. LM4 revisit economics and LM5 soak/recovery are still open (scaffolding
exists; standing evidence does not).

| Phase | Status | Evidence / notes |
| --- | --- | --- |
| LM0.1–0.2, LM0.4 | **CLOSED** | Settled p95 → 11.0 ms gate; soak/route/FO/device-loss reconciled in evidence doc |
| LM0.3 visual QA | **CLOSED** | `shots/manual/unified-streaming-visual-qa-accepted-2026-07-18/` (`passed: true`, 18 artifacts). Shell-path: keep **replace-mode far clipmap** (`farClipmap=1&farClipmapMode=replace`); legacy annular retained as comparison only (`legacy-annular-shell.png`) |
| LM1 | **CLOSED** | Plan 3 P1 readiness unblocks LM5 teleport |
| LM2 | **CLOSED** | Keep floating origin **disabled**. Rim matrix `shots/long-map-precision/rim-matrix-accepted-2026-07-18/`; decision addendum in `docs/coordinate-system-2026-07-12.md` (fp32 better p95/specular than FO at 16-page continent) |
| LM3 infrastructure | **CLOSED** | Frozen thresholds `config/long_map_route_thresholds.json` (p50≤9, p95≤22, p99≤50, max≤100, over16.7≤725, …). Repeatability PASS `repeatability-runs/long-map-infrastructure-final-2026-07-18/` (6 runs on `6aaffba7`: median/worst p95 **19.5 / 20.0**, max **61.8 / 70.2**, over100 **0 / 0**) |
| LM3 representative | **PARTIAL** | `--representative` → `scene=rpg-village` + agents; dense stream budgets in `movement_route_profile.ts`. Short (≈4.8 km) cal-v2 on `cf1ebf32`: 4/5 clean (p95 med/worst **17.4 / 18.1**, max med/worst **68.4 / 79.2**, over100 0); run 5 failed waterMs 0.6 vs 0.5. **Representative thresholds not frozen.** Full dense coast-to-coast 5+1 not run |
| LM4 | **OPEN** | `accept:continent-revisit` scaffolding; no standing eviction / cost-table evidence |
| LM5 | **OPEN** | Plan 3 readiness available; soak/teleport/bg-fg/device-loss evidence not closed |

**Next (dependency order):**

1. Finish calibrate-harness speedups already in the working tree (`--calibrate` skips forced
   water; pre-route stream-budget boost restored before route; `--repeat N`; Quaternius
   catalog 404 fix) — then freeze **representative short-route** thresholds from a clean
   5-run spread.
2. LM3 full representative coast-to-coast under the 5+1 protocol (release gate).
3. LM4 A→B→A revisit with eviction assertions → parent Phase 7 go/no-go.
4. LM5 soak + teleport (plan 3 contract) + background/foreground + device-loss fail-loud.

Execution evidence and per-file land/park decisions:
`../performance/long-map-execution-evidence-2026-07-16.md` (may lag this snapshot; prefer
the table above and linked artifact paths for 2026-07-18 claims).

## Relationship to the unified streaming plan

`unified-streaming-far-shell-heightmaps-2026-07-16.md` is **implemented** — see
`unified-streaming-far-shell-heightmaps-handover-2026-07-16.md`. The parent plan and its
handover remain the source of truth for what landed; this plan does not restate it. This
plan adds what "RPG on a long map" needs on top: baseline closure, a coordinate-precision
decision, coast-to-coast standing soaks at two content profiles, revisit/persistence
economics, and session-length + recovery drills.

Related documents:

- `unified-streaming-far-shell-heightmaps-handover-2026-07-16.md` — implementation
  outcome, headless verification table, and the pending manual visual QA steps 1–7.
- `continent-fixes-and-next-steps-2026-07-14.md` — Part E1 split between this plan
  (routes + budgets) and plan 2 (density).
- `docs/coordinate-system-2026-07-12.md` — logical vs render space contract.
- Plans 2–5 (same date suffix): `rpg-content-density-scaling`, `playable-world-contract`,
  `unified-gpu-visibility`, `visual-stability-closure`.

## Goal

A player can traverse the full continent coast-to-coast, revisit regions, play for an
hour, teleport, and background the tab — with the acceptance gates holding at
representative content density, zero ownership holes, bounded memory envelopes, no
catastrophic single frames, and no coordinate-precision artifacts. Every claim backed by
a standing scripted gate with a recorded environment, not a one-off run.

Non-goals: streaming-coordination redesign (implemented; only evidence-gated follow-ups
remain in the parent plan); content density itself (plan 2); gameplay readiness semantics
(plan 3 defines them; LM5 consumes them); gate weakening; Bevy port work (contracts stay
port-shaped per `docs/architecture/bevy-world-source-port.md`).

## Current state (historical rebase 2026-07-16, from the implementation handover)

> Superseded for status by **Progress snapshot (2026-07-18)** above. Kept as the
> substrate context the phases were written against.

- **Green trio on the handover commit**: typecheck pass, tests pass (623 files / 3,270
  tests, 1 file / 3 tests skipped), build pass.
- **Landed**: StreamCursor (single center + real-delta velocity), master `terrain
  streaming` freeze/resume switch, global surface-cache revision stream with coalesced
  summary invalidation, resident-vs-fallback parity probe (0 m measured error, 0.001 m
  gate), per-cell seam ownership on the replace-mode clipmap, movement-time coverage
  gates, unified diagnostics (`farSum*Ms` sub-buckets, `root_worker_batches_inflight`,
  `gpu_mesher_lane_busy_bubble`, `live_clod_stream_ready_frontier_m`), and a standing
  headless multi-km gate: `accept:unified-streaming-long-route` (3.06 km, 1,320 frames).
- **Skipped on evidence** (correctly, per the parent plan's own gates): StreamCapacity
  governor (no cross-system contention shown), far-summary persistence (no revisit
  measurement yet — LM4 supplies it), memory-pressure signal (long route bounded: 360
  bubble / 125 root evictions), islands heightfield default (no A/B), annular-shell
  per-cell ownership (awaiting manual visual evidence).
- **Baseline items this plan must close first**:
  - Settled p95 disposition closed 2026-07-16: synchronous diagnostic-panel DOM work was
    removed from streamed cut changes; the gate now reads the controlled 180-frame sample;
    five clean runs measured 9.5-10.7 ms and recalibrated the canonical workload gate to
    11.0 ms. Fresh-server confirmations passed at 9.7 and 9.0 ms. See the execution
    evidence for the full attribution and route-tail table.
  - Manual visual QA steps 1–7 in the handover are unperformed; no shimmer/pop claim
    exists for the new seam ownership. The shell-path decision is gated on it.
  - Movement numbers at 3.06 km: p99 17.40 ms, max 24.90 ms, seam counters zero — the
    worst frame is ~2.2× the 90 fps budget, which is exactly why LM3 gates worst-frame
    metrics, not just percentiles.
- **Floating origin**: `src/precision/floating_origin.ts` — rebase shifts scene children,
  camera, controls, player (+`lastSafePosition`), terrain colliders. Gated by
  `enabled && unboundedWorld`; an `allowBoundedWorld` widening is in flight (uncommitted).
  Whether vegetation rings, hydrology atlases, far shell, prop grids, particles,
  construction, and spell VFX all survive a rebase is unproven.
- **fp32 exposure**: at ±10 km, fp32 ULP ≈ 1–2 mm; view-dependent math (shadow sampling,
  specular, normals) typically degrades before geometry visibly shakes. No evidence
  captured at the rim either way.

## Phases

### LM0 — Baseline closure (blocks everything, including plans 2–5 gates)

1. Confirm the green trio on current `main` HEAD and record commit SHA + environment
   (browser version, GPU, driver, resolution, power profile, relevant URL params,
   cold/warm cache state). This environment record is the template every later gate run
   must include.
2. **Disposition the settled p95 miss** (8.20 vs 8.00 ms): profile the settled window
   (sub-bucket p95s exist), identify the driver, then either fix it or — if the evidence
   shows the 8.00 ms calibration predates features the gate must now cover — recalibrate
   with the reasoning recorded. "It's only 0.2 ms" is not a disposition.
3. **Manual visual QA**: execute handover steps 1–7 (settled seam shots in
   `farClipmapDebug=final` and `ownership`, active-traversal observation, grazing-angle +
   water transitions, master-switch exercise, shell-path decision). Attach PNGs/stats to
   the handover or a new dated visual-QA doc. Plan 5 S0/S1 later *automates* these
   checks; this manual pass is the prerequisite that unblocks LM3 — a 20 km soak that is
   numerically green but shimmers the whole way is a false pass.
4. **Reconcile the in-flight plan-1 work** (soak tool, coast-to-coast profile,
   floating-origin flag, device-loss module, acceptance-runner changes): review against
   this revision, add the missing pieces named in LM2–LM5, land or explicitly park each
   piece. Nothing merges without its failing-test-first coverage.
- [x] green trio + environment record on HEAD (recorded in the execution evidence)
- [x] settled p95 disposition (analysis + fix/recalibration recorded)
- [x] handover visual QA steps 1–7 done, artifacts linked, shell-path decision recorded
      (`shots/manual/unified-streaming-visual-qa-accepted-2026-07-18/`; keep replace-mode
      far clipmap; legacy annular comparison artifact retained)
- [x] in-flight work reconciled (per-file land/park decisions in the execution evidence)

### LM1 — Dependency record (no mirror checkboxes)

The parent plan/handover is the single source of truth; this plan records *versioned
dependencies* instead of duplicating status:

```text
LM2+ requires: StreamCursor + master switch + seam ownership landed (handover, 2026-07-16)
LM3 requires : accept:unified-streaming-long-route green incl. settled gate (LM0.2),
               visual QA closed (LM0.3), counters present: ready-frontier, ownership
               holes, farSum* sub-buckets, occupancy split
LM4 requires : LM3 route + residency counters per cache (bubble/root/summary/tile)
LM5 requires : plan 3 P1 readiness contract (time_to_gameplay_ready_ms) — hard dependency
               **SATISFIED 2026-07-18**: plan 3 P0–P7 complete on `main` `99cbdd94`
               (`playable-world-contract-2026-07-16.md`)
```

- [x] dependency versions pinned (commit/counter names recorded in the execution evidence)

### LM2 — Coordinate-precision decision at continent scale

Decision: **enable floating origin for continent mode, or record measured fp32 adequacy
at the rim.** Evidence over intuition, and pixel diff is one signal, never the sole
criterion.

1. **Deterministic precision mode first**: audit what `freeze=1` actually halts. Any
   animated system that keeps running in frozen captures (water surface time, vegetation
   wind, cloud/froxel noise, particles, spell VFX, LOD hysteresis) must be haltable via
   the diagnostic mode (`precisionDiag=1`): fixed camera matrices, fixed sim time, wind
   off, water time frozen, clouds/particles off, stable LOD cut, fixed exposure. The
   existing frame-stable shot machinery likely covers much of this — the audit lists
   what is missing before any capture is trusted. (No TAA/temporal reprojection exists
   in this renderer; do not cargo-cult mitigations for systems we do not have.)
2. **Pose matrix**: center control; cardinal rim x/z = ±rim; **diagonal rim corners**
   (both axes large simultaneously — worst case for subtraction/matrix error); near-ground
   and high-altitude cameras; low sun; strong water specular; dense vegetation; thin
   construction edges.
3. **Signals per pose**: repeated-frozen-frame pixel diff (in diagnostic mode); projected
   pixel position of fixed landmarks (sub-pixel drift across frames); shadow-edge
   movement; specular crawl on a slow fixed-step dolly (plan 5 S0 sequence metric when
   available); terrain-vs-prop relative offset. Depth/normal-buffer diffs only if a debug
   readback already exists — do not build G-buffer infrastructure for this.
4. **A/B floating origin** behind the in-flight `allowBoundedWorld` flag (URL-gated,
   default off): same pose matrix + the walk perf gate at the rim (rebase cost).
5. **Rebase-correctness registry** (only if enabling): failing tests per system holding
   world-space state outside `scene.children` — vegetation ring centers, hydrology atlas
   centers, far shell ring, prop spatial grid, construction pieces, water tiles, active
   spell VFX, agents (plan 2). Registry-driven test, not a hope-based checklist.
6. Record the decision either way as an addendum to `coordinate-system-2026-07-12.md`
   with all artifact paths. "fp32 is adequate at 10 km" is a valid, recorded outcome.
- [x] freeze-semantics audit + diagnostic mode gaps closed (`precisionDiag=1` asserted on
      every rim-matrix capture; seven freeze counters recorded in the accepted report)
- [x] pose matrix captured (center/cardinal/diagonal × camera/sun/surface variants)
      (`shots/long-map-precision/rim-matrix-accepted-2026-07-18/`, 18 cases)
- [x] signal tables recorded (landmark drift px, shadow-edge, specular-crawl, pixel diff)
      — all zero drift / zero uncaptured WebGPU errors in the accepted matrix
- [x] floating-origin A/B recorded (artifacts + rebase perf) — FO worse p95 and specular
      residual; each FO rim case one expected 1024 m rebase
- [x] decision recorded; floating origin stays **disabled** (fp32 adequate at this
      envelope) — addendum in `docs/coordinate-system-2026-07-12.md`

### LM3 — Coast-to-coast standing routes (two profiles + a short per-change route)

Prerequisites: LM0.2, LM0.3 (visual closure), LM1 pins.

Two content profiles, same gates — an empty world that streams cleanly is necessary but
not sufficient:

```text
infrastructure profile : terrain, hydrology, CLOD, water, background vegetation —
                         runnable now; proves the streaming substrate
representative profile : + dense forest, settlement, dungeon entrance, construction,
                         active spell VFX, placeholder agents — runnable after plan 2
                         D1/D2; this is the eventual release gate
```

1. **Short representative route first** (per-change gate): 5–8 min segment crossing two
   cold streaming boundaries, forest, a water crossing, coast, one dense content cell
   (when available), one terrain edit, one construction area. This is the route that runs
   on every change; the full traversal is nightly/on-demand.
2. **Full coast-to-coast** (~16–20 km, west coast → interior → east coast, ≥ 2 biome
   transitions, ≥ 1 river crossing, through the plan-2 village site): extend the
   in-flight `coast-to-coast` movement-route profile.
3. **Gates** (calibrated from 5-run baselines, then frozen):
   - Percentiles AND tails: frame p50/p95/p99/**p99.9/max**; counts of frames
     > 16.7 ms / > 33.3 ms (strictly bounded) and > 100 ms (zero after warmup);
     long-task count + longest task; longest single synchronous engine operation
     (phase-bucket max) ≤ its calibrated bound. The 3.06 km route's 24.9 ms max is the
     kind of frame percentiles hide — the player feels every one of them.
   - Coverage: `priority_unowned_cells == 0`, `clod_far_gap_holes == 0`, clipmap
     ownership holes 0 across the whole route.
   - `heightfield_tiles_fallback_samples_this_frame` returns to 0 after each region.
   - Memory envelope (not a naive slope): post-GC baseline where exposable, rolling
     min/max, high-water mark per window — bounded across the route; resource lifecycle
     counters (three.js geometries/textures/programs, GPU buffer/bind-group counts where
     visible, IndexedDB size) return to settled bounds; queue depths drain to settled
     state at route end; eviction totals bounded, no runaway rebuild/evict loop.
   - If floating origin enabled: `rebaseCount` matches distance/snapMeters ±1, zero
     post-rebase coverage or collider anomalies.
4. **Repeatability protocol** (replaces "green two consecutive days"): 5 repeated runs on
   the same recorded environment — median/worst/spread reported, zero gate failures —
   plus one fresh-profile run. Nightly runs continue as drift monitoring, not as proof.
- [x] short per-change route landed + gates calibrated (5-run spread recorded) —
      **infrastructure** short + full thresholds frozen in
      `config/long_map_route_thresholds.json`. **Representative** short cal-v2
      (`acceptance-runs/long-map-short-representative-cal-v2-{1..5}-2026-07-18/`, SHA
      `cf1ebf32`): clean 4/5 — p95 med/worst 17.4/18.1, max 68.4/79.2, over100 0;
      run 5 waterMs flake (0.6 vs 0.5). Representative thresholds **not frozen** yet.
- [x] full route landed (infrastructure profile) + gates green under the protocol —
      `repeatability-runs/long-map-infrastructure-final-2026-07-18/` PASS (6 runs on
      `6aaffba7`; median/worst p95 19.5/20.0, max 61.8/70.2, over100 0/0)
- [ ] representative-profile full coast-to-coast 5+1 recorded (release gate) —
      **wiring done 2026-07-18**: `--representative` → `scene=rpg-village` + agents via
      `movement_route_profile.ts` (plan 2 D5 handoff). Short-route calibrate evidence
      above; freeze short thresholds, then run full dense 5+1. Dense budgets already
      differ (frontier lag 768 m, region drain 600, stream acceptance floors).
- [x] environment records attached to infrastructure gate tables (repeatability report
      embeds commit/browser/GPU/driver/display/power/viewport). Representative freeze
      must attach the same template.

### LM4 — Revisit and persistence economics (feeds parent Phase 7 decisions)

1. A→B→A leg on the LM3 route (out ≥ 3 km, return through the same cells). **Before the
   return leg, assert eviction actually happened** for named target resources — otherwise
   the leg measures a cache hit and calls rebuilds cheap:
   ```text
   target CLOD pages: evicted (resident-set counter excludes keys)
   target far-summary tiles: evicted
   target heightfield tiles: retained/persisted per config (IndexedDB expected)
   target vegetation clusters: evicted
   water/hydrology residency at A: recorded either way
   ```
   The 3.06 km route already measured 360 bubble / 125 root evictions, so eviction at
   this scale is real — the assertion pins *which* resources, per target.
2. Return-leg table: page/summary rebuild counts + ms, tile store hits vs rebuilds,
   outbound-vs-return frame distribution (p50/p95/p99/p99.9/max).
3. Cold vs warm vs fresh-profile session comparison (also produces the continent Phase 2
   "cold vs warm tile latency" evidence row still owed in the 2026-07-14 backlog).
4. Hand the numbers to the parent plan's Phase 7 go/no-go (far-summary persistence,
   memory-pressure signal). This plan measures; it does not implement persistence.
- [ ] eviction assertions landed (named counters, failing test first)
- [ ] revisit cost table + outbound/return distributions recorded
- [ ] cold/warm/fresh table recorded; continent Phase 2 evidence row linked
- [ ] parent Phase 7 go/no-go informed (link to its decision entry)

### LM5 — Session-length soak and recovery drills

The in-flight `tools/continent-soak.ts` is the vehicle — reconciled in LM0.4, extended
here.

1. **Wander soak**: scripted 30–60 min loop over LM3 segments (varied speeds, idle
   pauses). Per-minute samples: memory-envelope metrics (as LM3), resident counts per
   cache, queue depths, draw calls. Gates: bounded envelopes (no monotonic post-GC floor
   growth, high-water stable), minute-50 movement gates equal minute-5, queues return to
   settled between legs.
2. **Teleport recovery** (2 km / 8 km / rim-to-rim): gate `time_to_gameplay_ready_ms`
   from **plan 3 P1's readiness contract — hard dependency, no interim definition**. The
   in-flight `streamingReadinessBlockers` helper must be reconciled into (or replaced by)
   plan 3's contract when it lands; it must not survive as a second notion of "ready".
   Also gate: no stuck fallback rings, coverage clean after recovery.
3. **Tab background/foreground**: 60 s hidden mid-route (Playwright visibility), gate
   recovery time, queue drain, no permanently lost rAF work.
4. **GPU device loss — fail-loud baseline** (this phase's scope): the in-flight
   `webgpu_device_loss.ts` handler + unit tests must guarantee: simulation stops in a
   safe paused state, authoritative world state (save runtime) is preserved uncorrupted,
   a clear error surfaces (`failLoud()` / `__drusnielClod.error`), and a controlled
   reload restores the last save (ties into plan 3 P2 round-trip). **Recorded future
   contract, out of scope here**: in-place device/renderer recreation and seamless
   resume — a first-class engine eventually recovers; today it must fail loudly and lose
   nothing. Real device-loss injection stays a documented manual drill (CI-forcing it is
   flaky).
- [ ] soak sampling + gates green under the 5-run protocol (numbers here)
- [ ] teleport gates green at 3 distances using plan 3's contract
      (plan 3 P0–P7 complete; wire LM5 drills to `teleportTargetReady` /
      `time_to_gameplay_ready_ms` and reconcile any interim `streamingReadinessBlockers`)
- [ ] background/foreground drill green
- [ ] device-loss baseline tests green; no-corruption-on-reload verified; future
      recovery contract recorded

## Verification protocol (every phase, per CLAUDE.md)

```powershell
npm --prefix tools/clod-poc run typecheck        # rtk OK
npm --prefix tools/clod-poc test                 # NO rtk
npm --prefix tools/clod-poc run build            # NO rtk
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

- Every gate table ships with its **environment record**: commit SHA, browser version,
  GPU, driver, resolution, power profile, URL params, cache state (the LM0.1 template).
- Perf reports from `summary.json`/acceptance reports: p50/p95/p99/p99.9/max, threshold
  buckets, top phase bucket, named counters — never FPS alone, never percentiles alone.
- Long routes/soaks: real-GPU headed runs, reuse profile where applicable; the in-app
  browser pane is not valid for boot checks.
- Thresholds: calibrate from 5-run spreads, then freeze; changes require a recorded
  re-calibration, never a silent bump. Update this doc per commit-sized chunk
  (`md-progress-logging`).

## Risks and rollbacks

- **This repo moves faster than its plans** — the first draft of this document was stale
  within hours. Standing rule: re-read the relevant handover/session docs and re-pin LM1
  before starting any phase; record the rebase in the phase evidence.
- **Floating-origin enablement** stays the riskiest change: flag-gated, default off,
  registry tests as the safety net, and "fp32 is adequate" is a legitimate outcome.
- **False greens are the plan's failure mode**: empty-world routes (two-profile rule),
  percentile-only gates (tail metrics), animated-noise pixel diffs (diagnostic mode),
  cache-hit revisit legs (eviction assertions), and GC sawtooth misread as leak or
  stability (envelope metrics) are each explicitly countered above — do not trade those
  countermeasures away for runtime convenience.
- **Soak flakiness**: fixed seeds, recorded environments, calibrate-then-freeze; a gate
  that flakes twice gets re-derived from a fresh 5-run spread, not deleted.
- **In-flight-work collision**: LM0.4 reconciliation is closed. Do not silently bump
  frozen infrastructure thresholds; representative freeze and LM4/LM5 evidence still
  need recorded environments and calibrate-then-freeze discipline.
