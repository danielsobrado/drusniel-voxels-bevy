# LAAS CDLOD as Far-Field / CLOD-Page Reference — Scope & Adoption Plan

**One-line decision:** the LAAS CDLOD terrain
([`docs/reference/fable5-world-demo/src/world/TerrainTiles.ts`](../reference/fable5-world-demo/src/world/TerrainTiles.ts))
is a **technique donor for the far field and the CLOD-page layer only**. It must
**never** be adopted as the representation for the near editable terrain. The near-field
bubble stays live volumetric Surface Nets (invariant I5).

This document fixes that boundary so the borrow does not creep, and enumerates exactly
which CDLOD ideas are in scope, which are out, and how to prove a borrow did not regress
the editable path.

---

## 0. Why this boundary exists (read first)

LAAS CDLOD is a **2.5D heightfield renderer**. The smoking gun is one line in
[`TerrainTiles.ts:182`](../reference/fable5-world-demo/src/world/TerrainTiles.ts#L182):

```ts
mat.positionNode = vec3(wpos.x, hSample.add(disp), wpos.y);  // y = f(x, z)
```

Every vertex height is a single-valued function of world `(x, z)`. That representation
**structurally cannot express** anything our voxel SDF routinely produces:

- overhangs, arches, sea-stacks, mushroom rocks
- caves, tunnels, cave mouths crossing a page border (a Phase-2 stress case in
  [`clod-execution-plan.md` §4.4](clod-execution-plan.md))
- floating geometry, vertical cliffs with undercuts
- any post-edit voxel change that opens a void below a surface

Our terrain is authoritative voxel data (invariant **I1**); the live bubble is editable
Surface Nets (invariant **I5**); CLOD pages are *derived decimations of the real chunk
meshes* (invariants **I2–I3**), so they already inherit full volumetric topology. A
heightfield CDLOD patch grid throws all of that away. Therefore:

> **Guardrail G0 — Representation firewall.** A heightfield (`y = f(x,z)`) representation
> may only own a terrain footprint that is (a) **never editable at interactive rates** and
> (b) **acceptably single-valued** at the viewing distance. That is the *outer* far field,
> beyond the voxel CLOD-page region. It may **never** own any footprint inside the
> near-field bubble, and it may **never** replace a voxel-derived CLOD page.

Everything below is consistent with G0.

---

## 1. The three terrain zones (where each technique may apply)

| Zone | Owner today | Representation | CDLOD borrow allowed? |
|---|---|---|---|
| **Near-field bubble** (`near_field.radius_chunks`, follows player+camera) | Live Surface Nets LOD0 chunks (skirts/morph/seam/boundary-strips) | Volumetric voxel | **NO.** G0. Selection/crack tricks here stay voxel-native. |
| **Mid-field CLOD pages** (outside bubble, within voxel world) | Voxel-derived decimated pages ([`src/voxel/pages/`](../../src/voxel/pages/)) | Volumetric voxel (decimated) | **Techniques only** — selection, morph-band transition, skirt-drop, error-biased refinement. Representation stays voxel. |
| **Outer far field** (beyond the outermost page ring / outside voxel data) | *Nothing today* (world just ends) | — | **YES, full CDLOD-style heightfield shell** is the intended home, mirroring LAAS's far shell ([`TerrainTiles.ts:330-382`](../reference/fable5-world-demo/src/world/TerrainTiles.ts#L330-L382)). |

The boundary between mid-field and outer far field is the place where a heightfield
representation legitimately begins, exactly as LAAS blends its baked field into the
analytic far macro at the world edge
([`TerrainTiles.ts:338-347`](../reference/fable5-world-demo/src/world/TerrainTiles.ts#L338-L347)).

---

## 2. In-scope borrows — CDLOD ideas we want

Ranked by value. Each is a *technique*, transplanted into the existing voxel-page or
far-shell layer — not a wholesale adoption of the patch-grid mesh.

### B1. Morph-band LOD transition (replace/augment dither crossfade) — mid-field pages
LAAS hides LOD pops by sliding odd vertices toward the even grid across the outer band of
each LOD ring ([`TerrainTiles.ts:117-136`](../reference/fable5-world-demo/src/world/TerrainTiles.ts#L117-L136)),
giving **crack-free, pop-free** transitions with no second draw.
- Our page runtime currently plans a **dithered screen-door crossfade**
  ([`clod-execution-plan.md` §4.2 / §7](clod-execution-plan.md), the deferred geomorph note).
- A geomorph between a page LOD and its parent is the same idea as CDLOD vertex morph,
  but on decimated meshes the collapse correspondence is non-trivial (deferred item §9 of
  the execution plan). **Borrow the *concept* and the morph-band math**; do not assume
  the patch-grid implementation transfers, because our pages are not regular grids.
- **Decision needed (D-B1):** geomorph-on-pages vs keep dither crossfade. Resolve only
  after the dither path is benched; this borrow is an *optimization*, not a blocker.

### B2. Error-biased quadtree refinement — mid-field selection
LAAS splits steep/rough tiles earlier *and* deeper using a CPU height-range pyramid and an
`errBoost`, with a coarser floor for flat meadows
([`TerrainTiles.ts:388-485`](../reference/fable5-world-demo/src/world/TerrainTiles.ts#L388-L485)).
- Our page selection ([`src/voxel/pages/selection.rs`](../../src/voxel/pages/selection.rs))
  uses **accumulated world-space simplification error → screen-space px** with hysteresis +
  a 2:1 constraint ([`clod-execution-plan.md` §4.1](clod-execution-plan.md)). That is already
  *more* principled than LAAS's relief heuristic (our error is measured, not estimated).
- **Borrow only the framing**, not the mechanism: LAAS confirms that 3D camera distance
  (de-prioritising the ground straight below from altitude,
  [`TerrainTiles.ts:461-469`](../reference/fable5-world-demo/src/world/TerrainTiles.ts#L461-L469))
  and a relief-aware split bias are worth having. If our measured-error selection ever
  over-refines flat far pages, this is the cheap fix to reach for. **Do not replace
  measured error with a relief estimate** — that would be a regression.

### B3. Skirt-drop crack insurance — mid-field pages & far shell
LAAS adds a one-quad skirt ring that clamps to the patch edge then drops down to hide any
residual crack from non-uniform splits
([`TerrainTiles.ts:103-139`](../reference/fable5-world-demo/src/world/TerrainTiles.ts#L103-L139)).
- Our pages are watertight **by construction** (locked outer borders, gate A1/A2 in
  [`clod-execution-plan.md` §5](clod-execution-plan.md)) — so skirts are *not* needed for
  page↔page seams.
- Skirts **are** the right insurance for the **mid-field-page ↔ outer-far-shell seam**
  (B4), where a voxel decimation meets an analytic heightfield and exact welding is
  impossible. Apply the LAAS skirt-drop *only* at that seam.

### B4. Analytic far shell with far-detail synthesis — outer far field
The clearest, fully-in-scope adoption. LAAS renders a radial ring (≈2–14 km) from an
**analytic macro-height function** with per-vertex finite-difference normals and in-shader
far-detail re-amplification, blended into the baked field at the edge
([`TerrainTiles.ts:330-382`](../reference/fable5-world-demo/src/world/TerrainTiles.ts#L330-L382)).
- This is the intended owner of **Zone 3** (§1): geometry beyond where we keep voxel data.
- It is editable-safe by definition — there is no voxel data out there to edit, so G0 is
  satisfied trivially.
- **Borrow:** ring geometry + analytic height/normal + edge blend + skirt seam (B3) into
  the bubble's outer page ring. Match LAAS's `castShadow=false` choice — far shell uses a
  coarse shadow proxy, never re-rasterizes for cascades
  ([`TerrainTiles.ts:325-328`](../reference/fable5-world-demo/src/world/TerrainTiles.ts#L325-L328);
  our analog: the page mesh already plans `castShadow=false`).

### B5. Instanced-patch, CPU-buffer-only updates — far shell rebuild discipline
LAAS draws all tiles as one `InstancedMesh` and only rewrites the per-tile buffer when the
camera moves > 20 m ([`TerrainTiles.ts:443-492`](../reference/fable5-world-demo/src/world/TerrainTiles.ts#L443-L492)).
This is just **"no per-frame per-instance CPU work"** — already an invariant we hold for the
page path (I4: page builds never on the frame path). Cite it as confirmation, not new work.

---

## 3. Out-of-scope — CDLOD ideas we explicitly reject

| Rejected | Why |
|---|---|
| **Heightfield patch grid as the near/mid terrain mesh** | G0. Destroys volumetric topology, edits, caves, overhangs. The entire point of this document. |
| **Replacing voxel CLOD pages with a CDLOD heightfield** | Pages are derived from the real mesher (I2/I3) so the bubble edge matches by construction ([`clod-phase5-plan.md` §7](clod-phase5-plan.md)). A heightfield page would reintroduce a seam and lose undercuts. |
| **Baking displacement/relief into terrain *height* near the camera** | LAAS's micro-displacement ([`TerrainTiles.ts:142-182`](../reference/fable5-world-demo/src/world/TerrainTiles.ts#L142-L182)) is heightfield relief; our near-field relief is real voxel geometry. Keep it that way. |
| **CDLOD morph applied to live LOD0 chunks** | The bubble already has GPU geomorph (`ATTRIBUTE_MORPH_TARGET`); don't fork a second morph scheme into the editable path. |
| **Using the far shell to *hide draw distance with fog*** | Banned by the reference's own §9 and by our distance-fidelity goals. The far shell must render serrated geometry, not a fog cutout. |

---

## 4. Guardrails to keep the borrow from creeping

- **G0 (Representation firewall)** — restated §0. The single non-negotiable rule.
- **G1** — Any new heightfield far-shell code lives in its **own module** (proposed:
  `src/voxel/pages/far_shell.rs` or `src/voxel/terrain/far_shell.rs`), never inside
  `meshing/`, `lod/`, or the page *builder* modules. Physical separation prevents reuse
  into the editable path.
- **G2** — The far shell owns **only** footprints with **no voxel chunk residency**. A
  runtime assertion (debug builds) must fail if the far shell and any live chunk / CLOD page
  claim the same footprint — same "exactly one owner per footprint" rule as the bubble edge
  (§11.8 of [`clod-execution-plan.md`](clod-execution-plan.md)). **Measure it, don't just
  assert it:** emit two `summary.json` counters that must read **zero** every bench frame —
  **`Clod Page Ownership Conflicts`** (any footprint where a live chunk and a page/shell both
  render) and **`Clod Page Near Field Violations`** (any page/shell rendered inside the
  bubble). A non-zero value is a hard bench failure, gated by `bench_guard`. This turns the
  firewall from a code assertion into a *regression-guarded invariant* — the only way the
  G0 firewall stays credible release over release.
- **G3** — No fade band between voxel pages and the heightfield shell where geometry could be
  coplanar; use the B3 skirt-drop + a hard ownership ring instead (coplanar fade → z-fight,
  the §11.9 trap).
- **G4** — Every borrow is benched against the named scenes before landing (§6). A CDLOD
  technique that helps the far field but costs the editable path frame time is rejected.

---

## 5. Phased adoption (small, benched, reversible)

Ordered so the safest, most clearly-in-scope borrow (B4 far shell) can land independently of
the speculative one (B1 geomorph).

```
P0  Firewall hardening (no perf risk, do first):                              [existing system]
    P0a  G2 guard counters in the page render/ownership path
         (`src/voxel/pages/ownership.rs` + a metrics counter), surfaced in
         summary.json: Ownership Conflicts + Near Field Violations, both must
         read 0. bench_guard fails the run if either is non-zero.
    P0b  Freeze-selection debug mode for the *existing* page selection cut.
         Already shipped in the PoC (`tools/clod-poc` `state.freeze`); this is
         a straight PoC→Bevy port into `src/voxel/pages/selection.rs`: config +
         hotkey toggle; camera moves, the selected page set stays frozen.
    P0c  Explicit Invalid page state + rate-limited missing/invalid logging
         (so a missing far page can't spam the frame log).
P1  B4 far-shell: analytic ring beyond the outer page ring, edge-blended,
    castShadow=false, B3 skirt seam. Default-off flag, A/B bench.              [Zone 3 only]
P2  Gate: far shell vs "world just ends" — distance fidelity + frame time.
P3  B2 (only IF selection over-refines flat far pages in benches): add the
    3D-distance / relief bias as a tunable, measured-error stays primary.      [selection]
P4  B1 (optional, deferred): evaluate geomorph-on-pages vs the shipped dither
    crossfade. Resolve D-B1 with numbers, not preference.                      [pages]
```

- **P0** improves the **already-shipped** voxel page system (`src/voxel/pages/`) — pure
  hardening + debug, no frame-path representation change. Do it first; it makes P1 safe to
  judge. **P0 does NOT create a new module tree.** Everything lands in the existing
  `src/voxel/pages/` and `config/clod_pages.yaml`; do **not** introduce `src/terrain/clod_pages/`
  or a second `assets/config/clod_pages.yaml` — both would fork the shipped system and split
  the single source of truth (decision D2, [`clod-phase5-plan.md`](clod-phase5-plan.md)).
- **P1** is the real new feature and is editable-safe by construction (Zone 3 has no voxels).
- **P3/P4** are conditional optimizations — do them only if a bench shows the need.

Hard rule: nothing in P1+ touches the bubble or the page *builder*. If a step seems to
require editing `meshing/` or `lod/`, stop — it has violated G0/G1.

### 5.1 Two-target port (clod-poc + Bevy) — parity matrix

P0 lands on **both** targets, but each feature starts from a different place. Per the
validation order in [`clod-execution-plan.md` §10](clod-execution-plan.md), behaviour that
does **not** yet exist is prototyped in the cheap Three.js sandbox **first**, then ported to
Bevy; behaviour already proven in the PoC ports straight across.

| Target | What it is | Role |
|---|---|---|
| **clod-poc** | TypeScript sandbox, [`tools/clod-poc/src/`](../../tools/clod-poc/src/) (`selection.ts`, `quadtree.ts`, `main.ts`) | Reference implementation + cheapest place to validate selection behaviour |
| **Bevy main crate** | [`src/voxel/pages/`](../../src/voxel/pages/) (`selection.rs`, `ownership.rs`, `build_queue.rs`) | The shipping engine — where ownership conflicts are even possible |

| P0 item | clod-poc today | Bevy today | Port direction |
|---|---|---|---|
| **P0b Freeze-selection** | ✅ shipped — `state.freeze`, lil-gui "freeze selection", `[FROZEN]` HUD, `cutFrozen` skips `updateSelection` | ❌ absent | **PoC → Bevy** (straight port; already validated) |
| **P0a Near-field-violation counter** | ⚠ partial — near-field only *forces splits* (`nearFieldForcedSplits`); no zero-invariant violation count | ❌ none (bubble exclusion enforced structurally, unmeasured) | **Both** — prototype the rendered-page-∩-bubble count in PoC `SelectionResult` + the bubble-mask stress test (§4.4), mirror as `Clod Page Near Field Violations` in Bevy `summary.json` |
| **P0a Ownership-conflict counter** | N/A — PoC is a cut-only sandbox, no live-chunk vs page owner | ❌ none | **Bevy-only** (`ownership.rs` → `summary.json`); the PoC bubble-mask test is the closest analog |
| **P0c Invalid state + rate-limited log** | ❌ | ❌ | **Both** — prototype the state machine in the PoC page cache, port to Bevy `build_queue.rs` |

**Parity discipline:** keep the PoC the canonical reference — same param names, same
`error_px` formula, same hysteresis band — exactly as the original CLOD port did
(`selection.ts` → `selection.rs`). Where a behaviour exists on both sides, add a parity/golden
check (the existing `src/voxel/pages/tests.rs` golden gate is the model) so the two
implementations cannot silently diverge.

### 5.2 Web PoC as the human parity surface

Golden tests prove the *math* matches; they do not prove a human cannot see a difference.
The deployed web PoC is the **interactive parity surface** — the place a human plays both
behaviours and confirms the Bevy port feels identical. This is not new infrastructure: the
PoC is already a deployable Vite app with a player controller, a `lil-gui` debug panel, and a
GitHub Pages workflow.

| Already exists | The parity work |
|---|---|
| Vite build, `base: "/drusniel-voxels-bevy/"`, [`deploy-clod-poc-pages.yml`](../../.github/workflows/deploy-clod-poc-pages.yml) (test + typecheck + build + publish on `main`) | Keep it green — every P0 PoC change must pass `vitest` + `tsc --noEmit` so the deploy never breaks. |
| Player controller, `lil-gui` panel, `freeze selection` toggle + `[FROZEN]` HUD | Surface every P0 feature as a **visible, toggleable control** so it can be exercised in-browser, not just in tests. |

Each P0 behaviour gets a web control + on-screen readout so a human can A/B it against the
Bevy build:

- **Freeze-selection** — already wired (`state.freeze`); the Bevy port must reproduce the
  same frozen-cut feel (this is the canonical "does the port match?" check).
- **Near-field-violation counter** — show the live count in the HUD; with the bubble-mask
  stress test (§4.4) on, it must stay **0**, matching the Bevy `summary.json` invariant.
- **Invalid/stale page state** — a panel toggle to force a page invalid/stale and watch the
  fallback, mirroring the Bevy fallback path.
- **Far shell (P1)** — once it exists, a toggle to show/hide it and walk the page↔shell seam.

**Verification:** parity is confirmed when (a) the golden/parity test passes (math) **and**
(b) a human running the published web PoC and the Bevy build side-by-side cannot tell the
selection/ownership behaviour apart (feel). The web PoC stays the cheap, shareable surface for
that human check — link the Pages URL in the PR.

---

## 6. Verification (per [`CLAUDE.md`](../../CLAUDE.md))

Every step that could move frame time runs `cargo run --release -- --bench …` on the
deterministic scenes and compares `summary.json` before/after, gated by `bench_guard`:

- **`visual-regression`** and **`visual-regression-high`** — baseline + far detail.
- **`visual-regression-live-lod`** — the critical one: proves the **editable bubble and
  the page selection path are unchanged** by a far-field borrow. The G0 firewall is only
  credible if this scene's mesher/commit/selection rows stay flat within noise.
- **`visual-regression-performance100`** — far-field throughput where the shell pays off.

Report, per CLAUDE.md: scene used, before/after numbers, the specific counters/timing rows
that moved (kept separate, never summed), and any visual/ready-state tradeoff. Use the fixed
screenshot checkpoints and the terrain debug overlays (Alt+F7 wire / Alt+F8 normals /
Alt+F10 hole probe) to confirm no new seams at the page↔shell boundary.

**Success criteria**
1. **Firewall holds:** `visual-regression-live-lod` mesher/commit/selection rows unchanged
   within bench noise after every far-field borrow.
2. **No coplanar z-fight / no fog cutout** at the page↔shell ring (visual sweep at grazing
   angles + hole-probe).
3. **Distance fidelity up, editable path frame time flat** — far shell adds serrated
   geometry past the page ring without regressing in-bubble frame time.
4. **G2 guard counters read zero** — `Clod Page Ownership Conflicts == 0` and
   `Clod Page Near Field Violations == 0` in every `summary.json`, enforced by `bench_guard`.
   (Supersedes a bare debug assertion: the invariant is now bench-gated, not hope-based.)
5. **Freeze-selection works on both targets** — toggling P0b freezes the page cut while the
   camera flies (PoC already; Bevy after the port), so selection pops are reproducible.
6. **PoC↔Bevy parity** — shared selection behaviour (P0a/P0c) matches param-for-param across
   `tools/clod-poc` and `src/voxel/pages/`, guarded by a parity/golden test (§5.1).
7. **Web PoC playable + green** — each P0 feature is a visible toggle in the deployed web PoC,
   the Pages deploy stays green (`vitest` + `tsc --noEmit`), and a human can A/B it against the
   Bevy build to confirm parity by feel, not just by test (§5.2).

---

## 7. Open decisions

- **D-B1** — geomorph-on-pages (B1) vs keep dither crossfade. *Defer to P4; decide on bench
  numbers.*
- **D-FS-MODULE** — far-shell module home: `src/voxel/pages/far_shell.rs` vs
  `src/voxel/terrain/far_shell.rs`. Lean toward `pages/` since the shell is the outermost LOD
  ring of the same selection cut. *Resolve at P1 start.*
- **D-FS-HEIGHT** — far-shell height source: reuse the existing terrain density/noise field
  sampled as a heightfield, or a dedicated cheap macro function à la LAAS `macroTerrain('far')`.
  Reusing the real field keeps the edge blend honest; a separate macro is cheaper but risks a
  visible seam. *Resolve at P1, prefer real-field sampling unless it benches too hot.*
```
