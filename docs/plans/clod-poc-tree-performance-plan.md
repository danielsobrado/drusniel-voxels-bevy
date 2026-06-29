# clod-poc Tree Performance Plan (JIRAs)

> Scope: **clod-poc, WebGPU path only.** Reduce the tree render cost beyond the
> interim config win already landed. Billboard *visual* quality is tracked in
> [clod-poc-tree-billboard-quality-plan.md](clod-poc-tree-billboard-quality-plan.md).
> Bevy port is out of scope.

## Baseline (measured, real GPU RTX 4080, 2026-06-29)

Full-forest "hero" camera (the user's heavy view), after the `config/trees.yaml`
LOD/foliage tuning (see
[clod-poc-performance-investigation-2026-06-29.md](../performance/clod-poc-performance-investigation-2026-06-29.md)):

| | before tuning | after tuning (current) | target |
| --- | ---: | ---: | ---: |
| avg FPS | 31 | **44–47** | ≥ 90 (144 Hz headroom) |
| impostors drawn | 0 | 1,651 | maximise |

Established root cause: **near/mid trees are full grammar mesh + an opaque
`DoubleSide` node material with a screen-door `maskNode` discard**, so the
near-canopy is fill/overdraw-bound. The dolly showed cost is *flat vs tree count*
and dominated by near-tree screen coverage. Impostors (far band) are now engaged
but do not help the near canopy.

## Measurement harness (read first — past attempts misled here)

- `perf:main --freeze 1` + headless = **SwiftShader software GPU and renders zero
  trees** (`tree visible 0`); its CPU-only `frameMs` is not the bottleneck. Do not
  draw perf conclusions from it for trees.
- Use a **headed real-GPU** run (`chromium.launch({headless:false, args:["--enable-unsafe-webgpu"]})`),
  confirm the adapter is `nvidia`, drive the orbit camera to the hero pose, and read
  the HUD `avg FPS` + `n/m/f/i`. This is the only path that reproduced the 30 FPS.
- The `renderer.info.render.timestamp` GPU timer **under-reports** (~0.02 ms even at
  50 FPS) — do not trust it. TP-1 fixes real GPU timing.

---

# EPIC TP-A — Trustworthy GPU timing (unblocks everything)

## TP-1 — Per-pass GPU timestamps that actually work
**Type:** Story · **Depends on:** —

**Description:** Replace the unreliable `info.render.timestamp` read with explicit
WebGPU **timestamp-query** brackets around the tree passes (the RTX adapter exposes
`timestamp-query` and `chromium-experimental-timestamp-query-inside-passes`). Surface
real per-phase GPU ms (main tree pass, shadow caster pass, compute dispatch) into a
headed real-GPU perf report. No production behaviour change when disabled.

**Acceptance criteria:**
- [ ] Headed real-GPU report shows non-degenerate GPU ms per tree phase that sum
      sensibly toward the frame budget (not ~0.02 ms).
- [ ] Off by default / gated; zero cost in normal play.
- [ ] Documented method so future tree perf work A/Bs against real GPU ms.

**AI execution prompt:**
```
Obey CLAUDE.md. Add gated WebGPU timestamp-query brackets around the tree main/shadow/compute passes (adapter has timestamp-query + chromium-experimental-timestamp-query-inside-passes), and surface real per-phase GPU ms in a headed real-GPU perf capture (Playwright headed --enable-unsafe-webgpu; verify nvidia adapter). Do not rely on renderer.info.render.timestamp. Keep it off by default. Document the A/B method.
```

---

# EPIC TP-B — Near-canopy fill cost (the dominant term)

## TP-2 — FrontSide trunk/branch tubes
**Type:** Story · **Depends on:** TP-1

**Description:** The tree material is `side: DoubleSide`
([tree_node_material.ts:264](../../tools/clod-poc/src/trees/tree_node_material.ts#L264)),
which doubles fragment work. Opaque solid geometry (trunks, branch tubes from
`veg_tube_mesh`) does not need two-sided shading — render those `FrontSide` and keep
`DoubleSide` only for the thin leaf cards. Split the material/draw so tubes and cards
use the right culling.

**Acceptance criteria:**
- [ ] Trunk/branch geometry renders single-sided; no visible backface holes on near
      trees.
- [ ] Measured hero-camera GPU ms drop for the tree main pass (TP-1), FPS up, no
      visual regression.

## TP-3 — Restore early-z: alpha cutout instead of shaded discard
**Type:** Story · **Depends on:** TP-1

**Description:** Leaf cards keep a fragment via a `maskNode` screen-door **discard**
after full shading ([tree_node_material.ts:260](../../tools/clod-poc/src/trees/tree_node_material.ts#L260)),
which weakens early-z and pays shading for discarded fragments. Evaluate moving the
LOD-fade + coverage to an **alpha-test/cutout** path (or a cheap pre-pass) so hidden
fragments are rejected before the heavy relight/transmission/forest terms run.

**Acceptance criteria:**
- [ ] Overdraw cost of the near canopy drops at the hero camera (TP-1 GPU ms).
- [ ] Dithered LOD crossfade still looks identical (no banding/regression).

## TP-4 — Foliage card overlap / size budget
**Type:** Task · **Depends on:** TP-1

**Description:** Continue from the interim `card_count_*` cut. Tune card width/height/
`cluster_spread_m` and counts per species to minimise overlapping coverage (the
overdraw driver) while keeping a full silhouette. Document a near-tree card budget
tied to a fill-cost target.

**Acceptance criteria:**
- [ ] Documented per-species near/mid card budget with hero-camera GPU ms + a
      silhouette shot proving canopy is not sparse.
- [ ] No regression in the BQ plan's near-vs-impostor match.

---

# EPIC TP-C — Mesh LOD decimation

## TP-5 — Near/mid mesh vertex-budget decimation
**Type:** Story · **Depends on:** TP-1

**Description:** Lower `lod.budgets.near/mid/farMaxVertices` (currently
260k/90k/40k in `config/trees.yaml`) and/or the grammar `leaf_card_count` /
branch detail for mid/far so distant-but-pre-impostor trees carry far less geometry.
Verify silhouettes hold at the seam.

**Acceptance criteria:**
- [ ] Mid/far tree vertex counts reduced; hero-camera frame time improves (TP-1).
- [ ] Silhouette at the mid→far→impostor seams unchanged to the eye.

---

# EPIC TP-D — LOD distance & crossfade budget

## TP-6 — Formalize LOD ring distances per world size
**Type:** Task · **Depends on:** TP-1

**Description:** The interim `mid_fraction 0.18` / `far_fraction 0.35` was hand-tuned
on world 8. Validate/auto-scale the near/mid/far/impostor fractions across world
sizes so the visible forest always converts to impostors at the right distance
(maximise impostor share without visible billboards encroaching the hero ring).

**Acceptance criteria:**
- [ ] Documented fractions (or a scaling rule) for world 8/16; impostor share high,
      no billboards visible inside the near ring on a hero shot.

## TP-7 — Crossfade band overdraw budget
**Type:** Task · **Depends on:** TP-1 · **Pairs with:** BQ-7 (quality)

**Description:** Enabling the far→impostor crossfade (BQ-7) draws both LODs in the
band → overdraw. Own the **performance** side: pick the smallest `crossfade_band_m`
that BQ-7 needs and measure the added GPU ms; gate it so it never blows the budget.

**Acceptance criteria:**
- [ ] Crossfade band added cost measured (TP-1) and within a documented budget at
      the hero camera; BQ-7's no-pop result still holds.

---

# EPIC TP-E — Shadow caster cost

## TP-8 — Measure & cap per-cascade tree shadow casters
**Type:** Story · **Depends on:** TP-1

**Description:** Earlier ablation put realtime sun shadows at ~15–20% of frame cost.
With TP-1, measure the tree shadow-caster pass directly; ensure far/impostor casters
use the cheap **crown proxies** (not card geometry) and cap per-cascade caster counts
so shadows scale with the budget.

**Acceptance criteria:**
- [ ] Shadow caster GPU ms measured per cascade; far casters use crown proxies.
- [ ] A documented caster cap keeps shadow cost within budget at the hero camera with
      no visible shadow loss.

---

# EPIC TP-F — Perf gate

## TP-9 — Hero-camera frame budget gate + regression guard
**Type:** Task · **Depends on:** TP-2..TP-8

**Description:** Define a deterministic hero-camera (forest fill) real-GPU A/B and a
frame-time budget; wire a regression check (extend the existing perf process /
`bench_guard` philosophy) so tree changes can't silently reintroduce the fill-bound
regression.

**Acceptance criteria:**
- [ ] Hero-camera real-GPU A/B documented (before/after FPS + TP-1 GPU ms); budget
      recorded.
- [ ] A regression check fails if hero-camera frame time exceeds budget.
- [ ] Results summarised per CLAUDE.md "Reporting".

---

## Suggested order

1. **TP-1** (reliable GPU timing) — without it the rest is guesswork (we already got
   burned by a fake 0.02 ms timer).
2. **TP-2 / TP-3** (FrontSide tubes, early-z) — biggest near-canopy fill wins.
3. **TP-5** (mesh decimation), **TP-4** (card budget).
4. **TP-6 / TP-7** (LOD + crossfade budget), **TP-8** (shadows).
5. **TP-9** gate.

The architectural endgame (relit, view-blended billboards — parity-plan EPIC A/B) is
**already largely landed**; this plan plus the billboard-quality plan are the
follow-through. Target: hero-camera ≥ 90 FPS with the forest visually intact.
