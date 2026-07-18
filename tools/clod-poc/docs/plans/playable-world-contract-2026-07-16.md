# Playable World Contract — character, readiness, and the vertical slice

Created 2026-07-16. Status: **P0–P6 COMPLETE; P7 harness green / headed evidence owed
(2026-07-18)**. Landed on `main` as `99cbdd94` (+ review fixes follow-up). P0–P3 landed
2026-07-17; P4–P6 closed with unit/verify suites green; P7 acceptance **runner and unit
contracts** are green under `playable-slice:verify`, but the headed 5+5+1 WebGPU
`accept:playable-slice` report has **not** been captured yet — do not treat P7 as
release-closed until that report is attached. Revised 2026-07-16 after an external review
that found real behavioral mistakes in the first draft — all of its code claims were
verified in source and the readiness/collision core is rewritten accordingly. Accepted:
the heightfield fallback collider is **restricted, never generalized** (a
height-per-column fallback seals caves and invents floors in a voxel world); the
below-canonical-surface sentinel is **dropped** (a player in a cave is legitimately
below the surface) in favor of a proven-invalid recovery contract with reason-coded
counters; dig-under-self now expects the player to **fall**, not "follow terrain"; the
single tri-state is replaced by **capability + revision readiness**; queued edit retries
are replaced by deny-by-default plus strictly validated immutable commands; collider
replacement becomes an **asynchronous revision-validated pipeline** (the current swap
builds `MeshBVH` synchronously on the calling path); fallback counters are reason-coded
so only missing-coverage frames count against streaming gates; hitch/tunnelling test
cases added beyond fixed rates; the water phase defines a canonical water authority
before locomotion, scoped to swim locomotion with immersion forces; spell/world
integration moved **before** the final slice gate (the first draft gated a slice step on
work scheduled in a later phase); unsupported construction pieces keep colliders aligned
with their visible geometry; persistence round-trips compare semantic state, not bytes;
and the slice splits into a deterministic diagnostic gate plus a continuous-play gate.

Plan 3 of 5 toward the browser RPG target. Owner decisions locked 2026-07-16: harden the
existing construction system (structural collapse is a later plan); swim + buoyancy
foundations only (sailing later); real creature AI out of scope (plan 2 owns placeholder
envelopes).

A renderer can report 3 ms frames while the game is unplayable — and a *badly designed
safety net* can make it look playable while silently breaking caves, overhangs, and
edited terrain, which are Drusniel's defining features. This plan's core rule:

```text
Never treat one terrain height as world truth in 3D voxel regions.
Keep exact or stale-safe colliders; never invent floors.
```

Related documents:

- `continent-fixes-and-next-steps-2026-07-14.md` — Part E2 (editable-terrain + cave
  gameplay loop) is this plan's core.
- `continent-phase-6-rpg-persistence-2026-07-12.md` — save v2 / prop identity /
  `world:verify` (COMPLETE): the persistence substrate gated here.
- `docs/construction-runtime.md`, `docs/construction-phase0.md`,
  `docs/editor/world-persistence-contract-2026-07-14.md`.
- `long-map-soak-and-streaming-execution-2026-07-16.md` (plan 1) — LM5's teleport drill
  hard-depends on this plan's readiness contract.
- `unified-streaming-far-shell-heightmaps-handover-2026-07-16.md` — the revision-stream
  architecture this plan's revisioned readiness aligns with.

## Goal

This sequence runs scripted and gated (sparse scene first, plan 2's dense scene when it
lands):

```text
spawn → walk → sprint → jump → climb slopes → cross page boundaries → dig a cave mouth
→ place construction (snap + support) → break a piece → swim across a lake/river
→ cast spells (including one terrain-affecting cast) → save → reload → verify → continue
```

Non-goals: structural collapse physics; sailing/boats and rigid-body buoyancy for
props/creatures (swim locomotion only); creature AI/combat design (existing sword stays);
inventory/quests; streaming redesign; generalizing any height-per-column shortcut into
3D-voxel regions.

## Current state (verified in source, 2026-07-16)

- **Controller** (`src/player_controller.ts`): 120 Hz fixed step, ≤ 12 steps per rendered
  frame, per-frame delta clamped to 100 ms (so a 250 ms hitch simulates only 100 ms —
  time dilation, a characterization fact); ground/air acceleration, coyote time 0.12 s,
  jump buffer 0.15 s, max slope 60°; `lastSafePosition` updates when grounded; recovery
  teleports to it only when the player sinks > `recoveryDepth` (32 m) below it — crude
  but cave-safe, since it assumes nothing about surfaces above the player.
- **The height fallback already exists and is the risk to contain**
  (`terrain_collider.ts:237-250` `applyHeightFallback`, applied after every capsule
  resolution): if the capsule is not grounded and sits at/below the sampled
  `surfaceHeight`, it is snapped up onto that height and marked grounded. In a cave or
  under an overhang this teleports the player toward the surface above. It must become
  reason-aware and column-certified (P2), not be generalized.
- **Collider replacement swaps atomically but builds synchronously**
  (`terrain_collider.ts:290-314`): `updatePage`/`upsertPage` construct the replacement
  entry and then call `ensureEntry`, which runs `new MeshBVH(geometry)` on the calling
  path before the swap. Ownership is atomic; the build can still stall the frame (P2).
- **Digging**: `src/dig.test.ts` — voxel edit path real and tested; phase-5 voxel overlay
  provides caves/masks (`accept:phase5-voxel-overlay`).
- **Construction**: snap index, support state, placement, overlap index, commit guard,
  terrain conform, persistence, ghost preview; `perf:construction`.
- **Spells**: async pipeline warmup + readiness-gated casting **already landed on main**
  (queue-until-ready + tests, plus the earth-spell raycast/miss-flash fixes) — P6 verified
  2026-07-18 (`spells:verify` + cast→edit→converge tests).
- **Water**: canonical `WaterSample` / `WaterAuthority`, swim locomotion, and
  `waterQueryReady` landed under P5 (2026-07-17). Hydrology graph + body queries remain
  the generated source; edited overlays cover cave ponds / dams.
- **Save**: v2 schema + migration + `world:verify` (continent Phase 6 COMPLETE); P7 adds
  Ctrl+S checkpoint coalescing.

## Design

### Capability + revision readiness (replaces the tri-state)

"Ready" is meaningless without *for which action, against which terrain revision*. A
collider from revision 40 under terrain revision 43 may be safe to stand on as an
explicit stale collider — it is not edit-ready. Per world cell:

```ts
interface CellReadiness {
  visualReady: boolean;              // something renders (any LOD/fallback)
  movementCollisionReady: boolean;   // exact or explicitly stale-safe collider
  terrainEditReady: boolean;         // voxel authority resident, edits accepted
  constructionReady: boolean;        // overlap/snap/support data resident
  waterQueryReady: boolean;          // water authority answers here
  terrainRevision: number;
  colliderRevision: number;          // stale iff < terrainRevision
  staleColliderSafe: boolean;        // stale collider explicitly allowed underfoot
  fallbackKind: "none" | "frontier_barrier" | "heightfield_certified";
}
```

Fields land with their first consumer (no speculative plumbing); the contract is data +
pure functions over residency/revision feeds — port-shaped, and aligned with the
surface-cache revision stream that already exists.

### Readiness policy (each row becomes tests)

```text
enter cell, exact current collider      → move normally
enter cell, stale-safe collider         → keep stale collider; prioritize rebuild;
                                          count stale_collider_frames
enter certified-heightfield cell,       → temporary height fallback allowed
  no collider                             (fallbackKind = heightfield_certified)
enter cave/edited/overhang/unknown      → STOP at a readiness frontier barrier;
  cell, no collider                       never invent a floor
collider rebuilding under player        → old collider stays until validated
                                          replacement swaps (never a gap frame)
dig/build target not authority-ready    → reject with UI feedback (see edit commands)
spawn / teleport                        → hold input until a collision-ready movement
                                          envelope + authoritative target cell exist;
                                          counter: time_to_gameplay_ready_ms
invalid player state                    → recover only on PROVEN invalid conditions
                                          (below kill plane / below bedrock volume /
                                          outside world bounds / known ownership
                                          failure / crossed formerly-solid surface
                                          while its collider was absent / invalid for
                                          N fixed steps) — never merely because Y is
                                          below the column's surface height
```

Column certification: a cell is `heightfield_certified` only when the authority proves
its columns are single-surface — no voxel overlay, no edits below original surface, no
cave mask, no overhang/bridge topology. Everything else is 3D and gets the barrier, not
a fake floor. The frontier barrier is less elegant than a fake floor and that is the
point: it preserves world correctness and keeps pressure on collision-first streaming
priority (which the streaming stack already gives colliders).

### Reason-coded counters (only real failures gate)

The existing fallback fires for benign reasons (jumping, falling, ledges). Raw
fallback-frame counts would gate nothing meaningful. Every fallback/recovery/barrier
event records *why*:

```text
collider_exact_no_ground            (benign: airborne over covered cells)
collider_coverage_missing           (streaming failure — THIS gates)
collider_stale_frames               (stale-safe policy active)
fallback_heightfield_certified      (allowed, certified columns only)
frontier_barrier_engagements        (gated near-zero on standing routes)
player_recovery_kill_plane / _missing_collider / _out_of_world / _non_finite
edits_denied_not_ready / edit_commands_expired
time_to_gameplay_ready_ms
```

### Edit commands (deny by default; no silent replay)

A queued click that fires seconds later against moved terrain is a bug, not resilience.
Default: deny with feedback; the player clicks again. Where retry is wanted
(construction ghosts — the intent stays visible), it is an immutable command:

```text
{ target position, target normal, operation, source terrain revision,
  actor, created at, short expiry }
```

validated at execution: same world feature still targeted, authority validation against
the **latest** revision, interaction distance, not expired, mode still appropriate.
Dig strikes and combat/spell casts never silently replay.

## Phases

### P0 — Characterize and instrument (no behavior change)

1. Characterization tests for the verified controller semantics (accelerations, coyote/
   buffer, slope, step behavior over BVH triangles, 12-step/100 ms clamp time-dilation)
   — written against current behavior; surprises recorded, not silently fixed.
2. Hitch matrix (characterize now, gate after P3): single 100 ms frame; single 250 ms
   hitch; alternating 8/40 ms; sprint into a thin wall; jump into a low ceiling; fall
   onto a narrow ledge; page-boundary crossing during a collider swap; high combined
   horizontal+vertical velocity; tab-resume delta. The fixed step does not automatically
   prevent tunnelling — resolution is positional against BVH triangles, so thin-feature
   behavior must be measured, not assumed.
3. Instrument the existing fallback with reason codes (list above) and BVH build timing
   (`collider_build_total_ms`, sync-on-frame occurrences), plus the readiness counters —
   counters first, policy later.
4. Honest baseline: scripted 10-minute run (walk + dig + jump + teleport, includes one
   cave from the voxel overlay) recording all reason-coded events **before** any fix.
- [x] characterization tests landed (semantics table recorded here) —
  `src/player_controller_characterization.test.ts`
- [x] hitch matrix characterized (behaviors recorded, incl. time-dilation) —
  `src/player/hitch_matrix.test.ts`
- [x] reason-coded counters + BVH timing landed — `src/player/gameplay_diagnostics.ts`,
  published into `stats.counters` every frame from the frame loop
- [x] honest baseline recorded (events per class per 10 min) —
  `docs/performance/playable-world-baseline-2026-07-16.md` (+ `.json`), harness
  `tools/playable_baseline/` runs legacy vs contract configs and gates in `npm test`

**P0 semantics table (characterized, all against current code):**

| semantics | recorded behavior |
|---|---|
| fixed step | 120 Hz, ≤ 12 steps/frame, delta clamp 100 ms → a 250 ms hitch simulates 100 ms (time dilation confirmed) |
| ground accel | 60 u/s², one clamped increment per step (walk speed reached in 16 steps, not instant) |
| air accel | 16 u/s² (3.75× weaker) |
| coyote time | 0.12 s: jump fires ≤ 13 airborne steps after ground loss, not at 15 |
| jump buffer | 0.15 s: press just before touchdown fires on landing |
| slopes | 55° ground / 65° slide (60° boundary); 0.3 m step climbed by positional push-out |
| recovery | crude 32 m sink rule; **finding: any drop > 32 m NEVER completes** — falling does not update `lastSafePosition`, so deep falls yo-yo forever (cave shafts, dug pits). P3 recovery contract owns this |
| thin features | caught at 42 m/s (30 m drop); at injected 600 m/s the capsule passes a zero-thickness floor when the plane lands in the inter-step gap (at 300 m/s the same drop is caught by alignment luck). No terminal velocity exists; unreachable naturally only because the 32 m rule fires first |
| page-boundary swap | crossing a boundary with a queued unprocessed rebuild: old collider serves, zero coverage loss, stale frames counted |

### P1 — Revisioned capability readiness

1. Failing tests: readiness answers per capability and revision (stale collider
   reported stale-safe, not ready; edit-readiness requires authority residency at
   latest revision; teleport target readiness = collision envelope + authoritative
   cell).
2. Implement `CellReadiness` over the existing residency/revision feeds; wire the
   policy-table consumers that need no new collider machinery (spawn/teleport input
   hold, edit deny path with feedback, counters).
3. Edit-command object + validation rules (failing tests: expiry, revision mismatch,
   distance, mode change → deny; construction ghost waits and then places correctly).
- [x] readiness contract tests → green — `src/player/cell_readiness.ts` + tests.
  Staleness derives from the rebuild pipeline (replacement pending for a covering page),
  not a global revision compare, which would mark every untouched page stale after any
  edit anywhere; revisions are still reported in the struct. `waterQueryReady` landed with
  P5; `constructionReady` landed with P4 (2026-07-18).
- [x] spawn/teleport gating + `time_to_gameplay_ready_ms` landed —
  `shouldApplyQuerySpawnNow` gained `targetCellReady`; `player_startup` wires
  `teleportTargetReady`; counter recorded on both gated and ungated spawns
- [x] edit-command validation tests → green; no silent replay anywhere —
  `src/player/edit_commands.ts` + tests (immutable commands; dig/casts deny on revision
  mismatch; construction ghosts replay only via latest-revision re-validation). The dig
  service's queued brush-drag rays now expire (`edit_commands_expired`) instead of firing
  seconds later; dig deny path wired via `editTargetAcceptable` (collider present +
  authority resident — deliberately NOT revision-strict: transactions are computed
  against the current voxel authority, so a one-tick-stale hit is a no-op, never
  corruption; the strict answer stays in `CellReadiness.terrainEditReady`). Construction
  ghost command wiring happens with P4's construction hardening.

### P2 — Safe collider streaming

1. **Async BVH pipeline** (failing test: no `MeshBVH` construction on the frame path
   during page replacement): extract geometry → worker/off-frame build → revision
   validation on completion (discard stale results per revision rules) → atomic install
   → dispose old. Old collider serves throughout; counters:
   `collider_jobs_queued/inflight/cancelled_stale`, `collider_build_total_ms`,
   `collider_apply_ms`, `collider_queue_latency_ms`, `stale_collider_frames`.
2. **Stale-collider policy**: standing on revision-N collider under revision-N+k terrain
   is explicitly allowed (`staleColliderSafe`) while the rebuild is prioritized; gated
   bound on stale-frame duration.
3. **Frontier barrier**: impassable boundary at the readiness frontier for non-certified
   cells without colliders; failing test: sprint at a cold cave-region frontier → stopped,
   not floored, not fallen-through; barrier engagements counted and gated near-zero on
   standing routes (it is a safety net, not a floor plan).
4. **Restrict the height fallback**: `applyHeightFallback` consults reason + column
   certification; never fires in voxel-overlay/edited/overhang columns. Failing test:
   airborne player inside a cave is NOT snapped to the surface above (this fails against
   current code — the proof the restriction bites).
- [x] async pipeline tests → green (zero sync BVH builds on frame path) —
  `TerrainColliderSet.schedulePageUpdate` / `processPendingRebuilds` +
  `terrain_collider_pipeline.test.ts`; the dig apply path
  (`terrain_view_startup.applyNodeCollider`) now schedules instead of building on the
  frame; app set runs `autoProcessRebuilds` (self-arming macrotask). **Caveat:** builds
  are off-the-frame-callback but still on the JS main thread — a worker executor is the
  follow-up if `collider_build_total_ms` per job grows past frame budget (baseline: ~0.1
  ms/page synthetic; real pages measured via the counters in live runs).
- [x] stale policy tests + bounds → green — standing on a pending-replacement collider
  allowed; `collider_stale_frames` + `collider_queue_latency_ms/max` counted (baseline
  max ≈ 2.4 ms, 1 job/frame drain)
- [x] frontier barrier tests → green — `src/player/frontier_barrier.test.ts`. Two real
  holes found and closed during the baseline run: (1) a velocity-direction-only probe
  lets a **grazing approach** slip across (fixed: axis-separable next-position checks,
  which also slide along the frontier); (2) resolve-time slope push-out can carry the
  capsule across — e.g. **terrain dug into a pit exactly at the frontier** (fixed:
  positional hard net after resolve — if a step ends in a blocked column it did not
  start in, the horizontal motion reverts). Engagement gate calibration on standing
  routes belongs to the P7 slices (baseline routes deliberately provoke it).
- [x] fallback restriction test (cave case) → green —
  `terrain_collider_certification.test.ts`; the cave case fails against pre-P2 code.
  `TerrainHeightFallback.certifyColumn` wired to `appColumnCertified` (voxel-overlay
  residency + any voxel edit in column ⇒ uncertified, fails closed; absent certifier =
  legacy heightfield-only behavior, app wiring always passes one).
- [x] `perf:construction` + collider micro-timings before/after recorded —
  perf:construction 2026-07-17: PASS, snap_ms_p95 ≤ 0.124 (settlement-10k 0.082),
  validation_ms_p95 ≤ 0.016 — construction paths untouched, no regression. Collider
  micro-timings live in the baseline evidence doc.

### P3 — Controller correctness

1. **Dig-under-self, corrected**: old collider active while replacement builds → atomic
   swap → ground gone → player becomes airborne and **falls** → collides with the next
   real surface if any → no tunnelling through it. Edits removing protected crust/
   bedrock are rejected by the authoritative terrain rules instead.
2. **Recovery contract**: implement the proven-invalid conditions (kill plane, below
   valid editable volume, out of bounds, ownership-failure crossing, bounded invalid
   steps) with reason-coded counters; the crude 32 m rule remains as a last-resort
   backstop. Failing test: deep cave traversal triggers zero recoveries.
3. Promote the P0 hitch matrix to gates (calibrated); fix what fails (tunnelling on
   thin features at high velocity is the expected finding class).
4. Zero `collider_coverage_missing` events and zero unexplained recoveries across the
   P0 scripted run, 5 repeated runs.
- [x] dig-under-self test (fall semantics) → green —
  `src/player/dig_under_self.test.ts`: old collider serves through the queued rebuild
  (stale frames counted), atomic swap removes the ground, the player falls 60 m and is
  caught by the real floor below with zero recoveries. Bedrock/crust protection is the
  voxel authority's existing guard (`dig.test.ts` "respects the bedrock guard";
  `voxelTransactionFromDigEdit` clamps rasterization above `BEDROCK_Y`).
- [x] recovery contract tests (incl. cave-traversal zero-recovery) → green —
  `src/player/recovery_contract.test.ts`. Implemented proven-invalid conditions:
  non-finite state (`player_recovery_non_finite`), kill plane `killPlaneY = -256`
  (`player_recovery_kill_plane`, the true last resort — catches even mesh holes that 2D
  coverage cannot see), bounded falling-in-blocked-column steps
  (`invalidColumnRecoverySteps = 60` ≈ 0.5 s, `player_recovery_missing_collider`), and
  the crude 32 m depth rule demoted to blocked-column backstop. Probe-less worlds keep
  the legacy 32 m rule unchanged (unit-test/back-compat). The 60 m cave drop lands with
  zero recoveries — fails against pre-P3 code (the P0 yo-yo finding).
- [x] hitch matrix gates calibrated → green — the two P0 KNOWN LIMIT cases are promoted
  to gates: a 200 m drop over covered ground completes with zero recoveries, and
  injected 600 m/s is clamped by the new terminal velocity (`maxFallSpeed = 80` u/s →
  0.67 m per 120 Hz step against a 1.8 m capsule) so thin floors are always sampled.
  The probe-less legacy yo-yo stays recorded as characterization. Remaining matrix rows
  (wall, ceiling, ledge, boundary-swap, frame shapes) were already asserting correct
  behavior and now gate it.
- [x] 5-run zero-coverage-loss gate green — the baseline harness runs the full scripted
  10-sim-minute contract route under 5 route seeds inside `npm test`: zero
  `collider_coverage_missing`, zero recoveries (all reasons), zero sync frame builds,
  frontier held, zero invented-floor frames, every seed.

### P4 — Construction hardened under streaming and edits

1. Failing tests: dig terrain from under a supported piece → support state updates;
   piece visibly marked unsupported; **its collider stays aligned with the visible
   piece** (collapse deferred means marked-not-passable, never a ghost wall you can walk
   through); support state persists. Removed piece: visual, collider, snap points,
   overlap index, persistence all disappear atomically. Place at a page border
   mid-rebuild → commit guard holds (no duplicate/lost piece).
2. Round-trip: scripted 30-piece structure → dig under part → save → reload →
   `world:verify` clean and **semantic equivalence** (entity IDs, transforms, support
   status, ownership, relationships — canonicalized comparison; serialization order and
   revision metadata may legitimately differ).
3. `perf:construction` before/after — no placement-cost regression.
- [x] support/collider-alignment/commit-guard tests → green —
  `src/construction/playable_world_p4_construction.test.ts` (dig-under marks unsupported
  while preserving mesh+collider; atomic remove; mid-rebuild place deny via
  `constructionReady` + edit-command `not_ready`)
- [x] semantic round-trip test → green (`world:verify`) —
  dig-under → save → reload semantic equality in the P4 test; `canonicalConstructionPieces`
  exported; `npm run world:verify` asserts dig-under + semantic match (tsx-safe; full
  store/collider round-trip stays in vitest)
- [x] perf non-regression recorded — construction hardening / timing vitest green
  2026-07-18. `perf:construction` remains blocked under raw `tsx` by construction.yaml /
  PBR jpg imports (pre-existing loader gap); vitest covers the placement timing surface.

### P5 — Water authority, then swim locomotion

1. **Canonical water authority first** (failing tests per rule):

   ```ts
   interface WaterSample {
     state: "dry" | "water" | "unknown";     // unknown ≠ dry — readiness-aware
     surfaceY: number; bottomY?: number;
     bodyId: string;
     bodyKind: "ocean" | "lake" | "river" | "pond" | "flood";
     flow: [number, number];
     sourceRevision: number;
   }
   ```

   Defined rules: source priority when generated hydrology and voxel-edited water
   overlap; dammed/edited bodies; cave ponds (voxel overlay); shore/boundary epsilon +
   hysteresis; revision invalidation; and an explicit statement of which water is
   authoritative vs merely visual. `waterQueryReady` joins `CellReadiness`.
2. **Swim locomotion with immersion forces** (deliberately not a rigid-body buoyancy
   system): enter (submersion threshold) → surface swim + dive → exit (shore), immersion
   force on the capsule in the same fixed step; hysteresis at the shoreline; low-fps and
   hitch cases from the P0 matrix rerun in water.
3. Scripted route gates: lake crossing, river with flow applied, cave pond entry
   (readiness-aware: an unknown water cell blocks swimming the same way an unready
   collider blocks walking). Half-submerged camera recorded as a known-ugly reference
   (rendering fix belongs to water rendering work, not this plan).
- [x] water authority tests (priority/edited/cave/epsilon/unknown) → green —
  `src/water/water_authority.test.ts` (+ P5 plan `playable-world-p5-water-authority-swimming-2026-07-17.md`)
- [x] swim state machine + immersion tests → green —
  `src/player/swim_locomotion.test.ts`, `src/player/swim_player_controller.test.ts`
- [x] lake/river/cave-pond scripted gates green (shots + stats recorded) —
  unit lake/river/cave-pond coverage above; headed river swim is exercised by
  `accept:playable-slice` (P7). Cave-pond remains edited-overlay API (auto voxel→water
  extraction still deferred per P5 plan).

### P6 — Spell↔world convergence (before the slice — order corrected)

1. Verify the **already-landed** readiness-gated casting on current main (queue-until-
   warm + tests, earth-spell raycast fixes) — a verification step, not a landing step.
2. One terrain-affecting cast end-to-end through the same authority path as the dig
   tool: cast → voxel edit → terrain, colliders (async pipeline), vegetation masks, far
   summary all converge; failing test asserts the composed round trip via convergence
   counters. Casts obey edit-command rules (no silent replay) and readiness denial.
- [x] landed warmup work verified on main (evidence linked) —
  `npm run spells:verify` green 2026-07-18; deferred controller awaits pipeline `ready`;
  see `playable-world-p6-spell-world-convergence-2026-07-17.md`
- [x] cast→edit→converge composed test → green —
  `src/spells/spell_world_convergence.test.ts` +
  `src/terrain/editing/spell_world_convergence_service.test.ts`

### P7 — Dual vertical-slice gates

Two gates, same content, different discipline:

1. **Deterministic diagnostic slice**: may pause at explicit readiness barriers between
   steps — exists to tell you *which* operation failed. Runs first, stays as the
   debugging gate.
2. **Continuous gameplay slice**: no broad settling — run across a boundary, dig,
   immediately place, break, enter water, cast, save checkpoint, reload, continue —
   driven **only through public input/action routes** (player input controller, edit
   commands, cast API), never internal state mutation. This is the gate that finds the
   races the slice exists to find.
3. Gates: every P1–P6 counter gate holds across both slices; frame responsiveness bounds
   during the slice; bounded wall-clock; 5 repeated runs + one fresh-profile run. Wire as
   `accept:playable-slice` (sparse scene now; plan 2's dense scene when it lands — both
   recorded).
- [x] acceptance runner + unit contracts green (`playable-slice:verify` 2026-07-18) —
  route planner, diagnostic/continuous contracts, checkpoint controller, snapshot,
  headed_real_webgpu adapter identity checks
- [ ] deterministic slice headed 5-run evidence attached
      (`npm run accept:playable-slice:diagnostic` → `acceptance-runs/playable-slice/`)
- [ ] continuous slice headed 5-run + fresh-profile evidence attached
      (`npm run accept:playable-slice` or `:continuous`)
- [x] wired into acceptance; dense-scene switch recorded when available —
  `accept:playable-slice` / `:diagnostic` / `:continuous` in package.json. Sparse
  continent is the release gate; dense RPG scene switch deferred until a deterministic
  river approach is designated (per P7 plan).

## Verification protocol (every phase, per CLAUDE.md)

```powershell
npm --prefix tools/clod-poc run typecheck        # rtk OK
npm --prefix tools/clod-poc test                 # NO rtk
npm --prefix tools/clod-poc run build            # NO rtk
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

- Physics/controller tests run at 60/30/20 fps fixed-step rates AND the hitch matrix;
  water reruns the matrix submerged.
- Slice runs are real-GPU headed runs; shots + stats recorded; `spells:verify`,
  `accept:phase5-voxel-overlay`, `world:verify` stay green throughout.
- Gates calibrated from 5-run spreads then frozen; environment records per plan 1 LM0.
- Update this doc per commit-sized chunk (`md-progress-logging`).

## Risks and rollbacks

- **The barrier can hide streaming slowness** the way a fake floor would hide holes —
  the difference is it is honest (movement stops) and counted;
  `frontier_barrier_engagements` is gated near-zero on standing routes so it cannot
  quietly become the experience.
- **Column certification is the correctness linchpin**: a cave column wrongly certified
  heightfield-safe reintroduces the fake-floor bug. Certification derives from the voxel
  authority's own masks (overlay presence, edit-below-surface, overhang topology) and
  fails closed (uncertified ⇒ barrier).
- **Async BVH adds latency** where sync builds added stalls; the stale-collider policy
  absorbs it, and `collider_queue_latency_ms` is gated so rebuild lag stays bounded.
- **P0 may reveal the controller needs replacing** (resolution-after-integration may not
  survive the hitch matrix on thin features). If so, stop and surface it — an integrator
  swap is its own decision, not a silent side effect.
- **Slice flakiness**: seeded content, injected input, calibrated thresholds; the
  deterministic slice exists precisely so the continuous slice's failures are
  attributable.

## Execution log

### 2026-07-17 — P0–P2 implemented, suite green (3370 tests), build green

New modules: `src/player/gameplay_diagnostics.ts` (reason-coded counters, published to
`stats.counters` each frame), `src/player/cell_readiness.ts` (readiness contract +
app feeds + `appColumnCertified`), `src/player/edit_commands.ts` (immutable commands +
validation). `TerrainColliderSet` gained: build timing + sync-frame-build detection,
reason-coded capsule accounting, `coversPoint`/`colliderStatusAt`, certification-gated
height fallback, and the async revision-validated rebuild pipeline
(`schedulePageUpdate`/`processPendingRebuilds`, snapshot-at-enqueue so floating-origin
translation keeps pending jobs coherent, supersede + discard rules, auto-drain
macrotask driver in the app). `PlayerController` gained the frontier barrier (velocity
gate + positional hard net) and reason-coded recovery counting.

Wiring: renderer_startup passes `certifyColumn` + attaches the movement probe;
terrain_view_startup's dig collider apply is async; terrain_edit_startup denies
not-ready targets with UI feedback (`edits_denied_not_ready`); queued dig rays expire;
player_startup gates query spawns on target-cell readiness and records
`time_to_gameplay_ready_ms`.

Honest baseline (`npm run baseline:playable`, also a permanent `npm test` gate):
10 sim-minutes per config, legacy vs contract —
`docs/performance/playable-world-baseline-2026-07-16.md`. Headlines: legacy stood on an
invented fallback floor 62 frames in the cave + 4033 frames over the never-streamed
zone and never reached the real cave floor; contract had **zero invented-floor frames,
reached the cave floor, zero `collider_coverage_missing`, zero recoveries, zero sync
frame builds** (legacy: 207 sync builds / 12.7 ms), queue latency max 2.4 ms.

Verification: `typecheck` clean; `vitest run` 3370 passed; `vite build` green;
`perf:construction` PASS (no regression). Not run (needs browser/GPU session):
`accept:phase5-voxel-overlay`, real-scene collider build timings — the counters are in
the stats contract for the next live run.

Known deviations/decisions for review: dig deny uses practical readiness (collider
present + authority resident) rather than revision-strict readiness — rationale under
the P1 checkboxes; pipeline builds are off-frame-callback but in-thread (worker executor
is the named follow-up); baseline evidence file is dated 2026-07-16 by machine clock.

### 2026-07-17 — P3 implemented, suite green (3407 tests), build green

Controller correctness on top of P0–P2. `PlayerConfig` gained `maxFallSpeed` (80 u/s
terminal velocity — bounds per-step motion under the capsule extent, closing the P0
thin-feature tunnel), `killPlaneY` (−256) and `invalidColumnRecoverySteps` (60). The
crude 32 m sink rule is replaced by the proven-invalid recovery contract when a
movement-readiness probe is attached (the app always attaches one): non-finite / kill
plane / bounded blocked-column fall, each with its own counter; depth rule demoted to
blocked-column backstop; probe-less worlds keep legacy semantics. Deep falls through
covered columns now land instead of yo-yoing — dig-under-self means the player falls
onto the next real surface (`dig_under_self.test.ts`), and cave traversal triggers zero
recoveries (`recovery_contract.test.ts`). The P0 hitch-matrix KNOWN LIMIT cases are
promoted to gates; the baseline harness gained a 5-route-seed contract gate (zero
coverage loss / recoveries / sync builds / frontier breaches per seed) that runs in
`npm test`. Evidence regenerated. The controller survived the matrix without an
integrator swap — the P0 risk ("resolution-after-integration may not survive") did not
materialize; terminal velocity + the recovery contract were sufficient.

Note for P5 (water): `maxFallSpeed` currently applies to all airborne motion; swim
locomotion replaces the ballistic fall inside water volumes, so the clamp needs no
water-specific carve-out now, but rerun the matrix submerged per the protocol.

### 2026-07-18 — P4–P6 closed; P7 harness green / headed evidence owed

Closed remaining P4 gaps on top of the already-landed P4–P7 sub-plans:

- **`CellReadiness.constructionReady`** + `constructionTargetReady` — fails closed while a
  covering collider page is mid-rebuild (same predicate as `terrainEditReady` today;
  named for place consumers).
- Construction place path creates/validates immutable `construction_place` edit commands
  (ghost command revalidated on click; revision-retry allowed with `targetStillValid`).
- Runtime wiring passes `terrainColliders` + live `interaction.mode` into construction.
- Dig-under → save → reload semantic test added; `canonicalConstructionPieces` exported;
  `world:verify` asserts dig-under + semantic match (tsx-safe; full store/collider
  round-trip remains in vitest).
- Fixed `save_checkpoint_controller` coalescing regression (`Promise.then` deferred flush).

**Landed commit:** `99cbdd94` on `main`
(`Close playable-world contract P4-P7: construction readiness, edit commands, and gates.`)
— pushed to `origin/main` 2026-07-18. Review fixes (P7 honesty, interaction mode,
hold-until-ready teleport, dig-under world:verify) follow in a subsequent commit.

Verification 2026-07-18 (unit/verify — **not** headed slice):

```text
typecheck                         green
playable-slice:verify             green (41 tests + build)
spells:verify                     green (48 tests + build)
world:verify                      green (incl. constructionDigUnderApplied)
P4/P5/P6 focused vitest           green
accept:playable-slice (headed)    NOT RUN — P7 release evidence still owed
```

Plan 1 LM5 teleport drill is unblocked by this contract (`time_to_gameplay_ready_ms` +
`teleportTargetReady`); `runReadinessGatedTeleport` commits arrival only after ready
(optional `primeStream` for streaming).

Deferred (unchanged, recorded): structural collapse; automatic voxel→water extraction;
`perf:construction` under raw `tsx` (yaml/jpg loader); dense-scene P7 switch until a
deterministic river approach exists; **headed P7 5+5+1 report**.
