# Playable World Contract — character, readiness, and the vertical slice

Created 2026-07-16. Status: PLANNED (no code landed from this doc yet). Revised same day
after an external review that found real behavioral mistakes in the first draft — all of
its code claims were verified in source and the readiness/collision core is rewritten
accordingly. Accepted: the heightfield fallback collider is **restricted, never
generalized** (a height-per-column fallback seals caves and invents floors in a voxel
world); the below-canonical-surface sentinel is **dropped** (a player in a cave is
legitimately below the surface) in favor of a proven-invalid recovery contract with
reason-coded counters; dig-under-self now expects the player to **fall**, not "follow
terrain"; the single tri-state is replaced by **capability + revision readiness**; queued
edit retries are replaced by deny-by-default plus strictly validated immutable commands;
collider replacement becomes an **asynchronous revision-validated pipeline** (the current
swap builds `MeshBVH` synchronously on the calling path); fallback counters are
reason-coded so only missing-coverage frames count against streaming gates; hitch/
tunnelling test cases added beyond fixed rates; the water phase defines a canonical
water authority before locomotion, scoped to swim locomotion with immersion forces;
spell/world integration moved **before** the final slice gate (the first draft gated a
slice step on work scheduled in a later phase); unsupported construction pieces keep
colliders aligned with their visible geometry; persistence round-trips compare semantic
state, not bytes; and the slice splits into a deterministic diagnostic gate plus a
continuous-play gate.

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
  (queue-until-ready + tests, plus the earth-spell raycast/miss-flash fixes) — P6 verifies
  and builds on it rather than re-landing it.
- **Water**: hydrology graph + body queries exist tool-side (`water:find`,
  `water:hydrology`); rendering is a visual PoC; **no unified runtime water authority, no
  swim/buoyancy code**.
- **Save**: v2 schema + migration + `world:verify` (continent Phase 6 COMPLETE).

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
- [ ] characterization tests landed (semantics table recorded here)
- [ ] hitch matrix characterized (behaviors recorded, incl. time-dilation)
- [ ] reason-coded counters + BVH timing landed
- [ ] honest baseline recorded (events per class per 10 min)

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
- [ ] readiness contract tests → green
- [ ] spawn/teleport gating + `time_to_gameplay_ready_ms` landed (plan 1 LM5 consumes)
- [ ] edit-command validation tests → green; no silent replay anywhere

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
- [ ] async pipeline tests → green (zero sync BVH builds on frame path)
- [ ] stale policy tests + bounds → green
- [ ] frontier barrier tests → green; engagement gate calibrated
- [ ] fallback restriction test (cave case) → green
- [ ] `perf:construction` + collider micro-timings before/after recorded

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
- [ ] dig-under-self test (fall semantics) → green
- [ ] recovery contract tests (incl. cave-traversal zero-recovery) → green
- [ ] hitch matrix gates calibrated → green
- [ ] 5-run zero-coverage-loss gate green

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
- [ ] support/collider-alignment/commit-guard tests → green
- [ ] semantic round-trip test → green (`world:verify`)
- [ ] perf non-regression recorded

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
- [ ] water authority tests (priority/edited/cave/epsilon/unknown) → green
- [ ] swim state machine + immersion tests → green
- [ ] lake/river/cave-pond scripted gates green (shots + stats recorded)

### P6 — Spell↔world convergence (before the slice — order corrected)

1. Verify the **already-landed** readiness-gated casting on current main (queue-until-
   warm + tests, earth-spell raycast fixes) — a verification step, not a landing step.
2. One terrain-affecting cast end-to-end through the same authority path as the dig
   tool: cast → voxel edit → terrain, colliders (async pipeline), vegetation masks, far
   summary all converge; failing test asserts the composed round trip via convergence
   counters. Casts obey edit-command rules (no silent replay) and readiness denial.
- [ ] landed warmup work verified on main (evidence linked)
- [ ] cast→edit→converge composed test → green

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
- [ ] deterministic slice green end-to-end (5 runs)
- [ ] continuous slice green end-to-end (5 runs), public-routes-only verified
- [ ] wired into acceptance; dense-scene switch recorded when available

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
