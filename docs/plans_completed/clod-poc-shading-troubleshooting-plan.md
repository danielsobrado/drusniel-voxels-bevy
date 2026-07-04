# CLOD PoC — Shading Band & Diagonal Lines: Troubleshooting Plan (Tickets + Prompts)

Status: historical troubleshooting record. Current CLOD/clod-poc orientation is in
`docs/README.md`, `tools/clod-poc/README.md`, and the active parity/status docs under
`docs/plans/`.

Scope: the Three.js PoC (`tools/clod-poc`) shows (1) a shading/normal-colour band along
what is suspected to be the L0|L1 page border, and (2) faint diagonal shading lines on
L0 terrain. Goal: classify the root cause with instrumentation FIRST, fix only the
confirmed branch, and port durable findings to the engine plans.

This is a diagnosis program, not a fix program. Fix tickets (DBG-5/6/7) are gated on
the classification ticket (DBG-4). Do not reorder.

---

## 0. Verified code facts (do not re-litigate; verify only if contradicted)

```text
V1. material.ts fragment shader normalizes vWorldNormal for BOTH lighting and the
    normal-colour debug view. "Unnormalized debug colour" is eliminated.
V2. weld.ts: first-seen canonical vertex + hard-fail when a position match has
    normal dot < tol or material delta > tol. No averaging. Matches the engine.
V3. simplify.ts uses MeshoptSimplifier.simplifyWithAttributes; returned indices
    reference the ORIGINAL vertex buffer — survivors keep exact attributes. Locked
    vertices survive verbatim. There is nothing to "restore" after simplify.
V4. terrain.ts normals are analytic central-difference gradients of the density
    field (e = 0.5), deterministic and identical across chunk/page borders.
    "recomputed normals" is a GUI toggle (computeVertexNormals) and was OFF in the
    repro screenshots.
V5. The material is THREE.DoubleSide — winding flips are invisible.
V6. "same-LOD seam points" marks ONLY same-level adjacency; cross-LOD page borders
    are currently NOT visualized.
V7. Repro state: 4x4 world, cut = 8 L0 + 2 L1 (= 16 page-equivalents, a valid cut),
    threshold 1.00 px, near-field bubble DISABLED in both screenshots. Any theory
    involving the bubble is therefore wrong for this repro.
V8. Selection: error_world is monotonic (accumulated child error); px projection
    lives in selection.ts.
```

## 1. Global rules for the implementing AI

```text
G1. Diagnose before fixing. DBG-1..4 land before any behavior-changing edit.
    A fix committed before DBG-4's classification is a process failure.
G2. One variable per experiment. Every observation goes in the findings doc
    (tools/clod-poc/findings/shading-band.md) with the exact GUI state and a
    screenshot path (save under tools/clod-poc/findings/img/).
G3. Never change weld semantics to averaging. Never use simplify_sloppy. Never
    weaken a hard-fail to a warning. (Plan invariants.)
G4. Debug instrumentation is additive and toggleable; default state of every new
    toggle = OFF; zero effect on existing acceptance behavior when off.
G5. Keep diffs small; one ticket = one commit "DBG-n: <title>".
G6. npm ci && npm run dev inside tools/clod-poc; verify each ticket in the browser
    at the repro camera position (record it in the findings doc once, reuse).
G7. If code contradicts a Verified fact (V1..V8), stop, report, and update §0
    before proceeding.
```

## 2. Decision tree (DBG-4 fills this in)

```text
Experiment E1: force all-L0 (threshold -> 0.01 or force-level control).
  Band gone        -> BRANCH A: cross-LOD normal-field undersampling (DBG-5).
  Band persists    -> BRANCH B: L0 source/weld/winding bug (DBG-6).

Experiment E2: cross-LOD border markers (DBG-1).
  Band edge ON the L0|L1 border  -> consistent with A or B at the border.
  Band edge NOT on any border    -> BRANCH C: terrain/lighting feature — document,
                                    close as not-a-bug, skip DBG-5/6 for the band.

Experiment E3: divergence view (DBG-2).
  L1 first-ring glows along border -> confirms BRANCH A mechanism.
  L0 glows anywhere                -> BRANCH B evidence (carried normals vs geometry
                                      disagree on UNSIMPLIFIED mesh = data bug).

Experiment E4: FrontSide toggle (DBG-2).
  Holes appear -> BRANCH B sub-case: winding flip in weld/compact remap.

Experiment E5: wireframe over diagonal lines.
  Creases follow SN quad diagonals      -> BRANCH D1: triangulation anisotropy (DBG-7).
  Creases cross triangle edges freely   -> BRANCH D2: fbm terrain ridges under
                                           pow(sun,1.35) lighting — not a bug; document.
```

---

## DBG-1 — Cross-LOD border markers + cut HUD

**Requirements**
- New GUI toggle `cross-LOD borders`: draws the shared border segments between rendered nodes of DIFFERENT levels in a distinct colour (e.g. cyan), reusing the same point/line mechanism as `same-LOD seam points`.
- HUD line extended: per-level node counts already exist; add the count of cross-LOD adjacencies in the current cut.
- Default OFF; zero cost when off.

Depends: none. Est: 0.5d.
Acceptance: with the repro camera, toggling the new marker instantly shows whether the circled band sits on an L0|L1 border; screenshot saved to findings.

**Prompt**
```text
Context: V6 — only same-LOD seams are visualized today, and the one boundary type
under investigation (cross-LOD page borders) has no marker. main.ts already builds
seam-point visuals from node border data; mirror that path.

Steps:
1. Read how "same-LOD seam points" is built in main.ts (search for the GUI label) and
   where node borders/footprints are available per rendered node.
2. For the current cut, find adjacent rendered-node pairs with differing level
   (share an edge of their footprints). For each pair, emit the shared border as a
   THREE.Points or Line2 set in cyan, grouped under one toggleable Object3D.
3. Rebuild the marker set whenever the cut changes (hook the same place the cut is
   applied / crossfade starts).
4. HUD: append "xLOD borders: N" to the existing stats text.
5. lil-gui: add the toggle next to "same-LOD seam points", default false.
Must not: alter selection, geometry, or existing markers; allocate per-frame when off.
Verify: npm run dev; repro camera; toggle on -> cyan lines appear exactly between
white(L0) and blue(L1) regions in color-by-LOD mode; screenshot to
findings/img/dbg1-xlod-borders.png; note in findings doc whether the circled band
coincides with a cyan border (E2 answer).
Done when: E2 is answered with a screenshot and one sentence in the findings doc.
```

---

## DBG-2 — Shader diagnostics: normal-divergence view + FrontSide toggle

**Requirements**
- `material.ts`: new uniform `uNormalDivergence` (bool) and `uDivergenceGain` (float, default 8.0). When on, fragment outputs `vec3(div * gain)` where `div = 1.0 - abs(dot(normalize(vWorldNormal), gN))` and `gN = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)))`.
- GUI toggles: `normal divergence` (+ gain slider 1–32) and `front side only` (switches material `side` between DoubleSide and FrontSide live).
- Both default OFF.

Depends: none. Est: 0.5d.
Acceptance: divergence view renders (mostly black on L0, structured glow on L1); FrontSide toggle works; E3 and E4 answered in findings with screenshots.

**Prompt**
```text
Context: with watertight geometry and verbatim locked attributes (V2/V3), the live
question is WHERE carried vertex normals disagree with actual triangle geometry.
dFdx/dFdy of the world-position varying gives the geometric normal per fragment.

Steps:
1. material.ts FRAG: add uniforms uNormalDivergence (bool), uDivergenceGain (float).
   Before the existing uNormalColor branch insert:
     if (uNormalDivergence) {
       vec3 gN = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
       float div = 1.0 - abs(dot(normalize(vWorldNormal), gN));
       gl_FragColor = vec4(vec3(div * uDivergenceGain), 1.0);
       return;
     }
   (abs() because DoubleSide makes gN sign view-dependent.)
2. createTerrainMaterial: register the two uniforms with defaults false / 8.0.
3. main.ts GUI: "normal divergence" toggle + "divergence gain" slider (1..32) wired to
   every terrain material instance (find how uNormalColor is fanned out and mirror it);
   "front side only" toggle flips material.side = FrontSide/DoubleSide and sets
   material.needsUpdate = true.
4. Run E3: divergence view at repro camera, all defaults; screenshot. Expected: L1
   region shows structured glow, strongest in the first triangle ring inside the
   border if BRANCH A; ANY glow on pure-L0 pages above noise = BRANCH B evidence.
5. Run E4: FrontSide only, orbit the band area; black holes = flipped winding ->
   record as BRANCH B sub-case.
Must not: change lighting math when toggles are off; touch weld/simplify.
Verify: visual check both toggles; screenshots dbg2-divergence.png, dbg2-frontside.png;
findings doc gets E3/E4 one-liners.
Done when: E3 and E4 have evidence-backed answers.
```

---

## DBG-3 — Forced-cut controls

**Requirements**
- GUI dropdown `force max level`: `auto | 0 | 1 | 2 | 3`. Non-auto clamps selection so no rendered node exceeds that level (force-split above it), independent of the px threshold. `0` = the all-L0 experiment.
- HUD shows the forced state; works with freeze + crossfade unchanged.

Depends: none. Est: 0.5d.
Acceptance: `force max level = 0` renders L0-only (HUD confirms L0:16); E1 answered with before/after screenshots at the repro camera.

**Prompt**
```text
Context: E1 is the primary discriminator (band on cross-LOD cut vs band on pure L0).
Doing it by sliding the px threshold is imprecise; add an explicit clamp.

Steps:
1. selection.ts: thread an optional forcedMaxLevel: number | null into the cut
   traversal — when set, a node with level > forcedMaxLevel must recurse to children
   regardless of error_px (treat like the 2:1 forced split path; reuse it if shaped
   right). Leaf availability: if children are missing (shouldn't happen — full
   hierarchy is built), fall back to the node and log a warning.
2. main.ts: GUI dropdown "force max level" [auto,0,1,2,3]; HUD appends
   "forced<=N" when active.
3. Run E1: repro camera, color-by-LOD + normal colours each: auto vs forced 0.
   Save dbg3-auto.png / dbg3-forced0.png pairs for both view modes.
Must not: bypass the 2:1 pass; change hysteresis; leave the control on by default.
Verify: HUD shows L0:16 when forced 0 on the 4x4 world; tris rendered rises
accordingly; findings doc E1 row filled: "band gone: yes/no".
Done when: E1 answered with paired screenshots.
```

---

## DBG-4 — Run the discrimination matrix, classify, write findings

**Requirements**
- Execute E1–E5 (DBG-1..3 instrumentation + existing wireframe toggle) at the recorded repro camera; fill `tools/clod-poc/findings/shading-band.md` using the template below; end with a single classification per artifact: band → A/B/C, diagonals → D1/D2.
- No code changes in this ticket beyond the findings doc.

Depends: DBG-1, DBG-2, DBG-3. Est: 0.5d.
Acceptance: findings doc complete, every E-row has a screenshot reference, classification stated, and the matching fix ticket (DBG-5/6/7) is named as next — or explicitly "no fix needed" for branch C/D2.

**Prompt**
```text
Context: §2 decision tree. You are producing evidence, not opinions. Every row needs
the GUI state, the observation, and an image path.

Steps:
1. Create tools/clod-poc/findings/shading-band.md from this template:
   ## Repro
   camera: <pos/target>, world 4x4, threshold 1.00, bubble OFF
   ## Matrix
   | Exp | GUI state | Observation | Image | Branch evidence |
   | E1 | force0 vs auto, normal colours | ... | ... | A or B |
   | E2 | xLOD borders on | band edge on border? | ... | A/B vs C |
   | E3 | divergence, gain 8 | where glows? | ... | A vs B |
   | E4 | FrontSide | holes? | ... | B-winding |
   | E5 | wireframe over diagonals | aligned with quad diagonals? | ... | D1 vs D2 |
   ## Classification
   band: <A|B|C> because <one sentence per supporting row>
   diagonals: <D1|D2> because <...>
   ## Next
   <DBG-5|DBG-6|DBG-7|close>
2. Execute, fill, commit doc + images.
3. If evidence is mixed (e.g., E1 says gone but E3 glows on L0), record BOTH, classify
   the band by E1 (the stronger discriminator), and open a one-paragraph "anomaly"
   note for the L0 glow — do not silently pick.
Must not: fix anything; tweak config values; cherry-pick camera angles (use the
recorded repro pose for every row).
Verify: a reviewer can reproduce every row from the doc alone.
Done when: classification + next ticket named.
```

---

## DBG-5 — BRANCH A fix: cross-LOD normal-field undersampling

**Requirements**
- Attribute-weight sweep: `attribute_weights.normal` ∈ {0.5, 1.0, 1.5, 2.0} (config), recording for each: band visibility (screenshot), tris per level, lowBenefit count, errorWorld per level — a small table in the findings doc.
- Verify the px projection in `selection.ts` against first principles: `error_px = error_world * viewportHeight / (2 * dist * tan(fovY/2))`; fix if it deviates; document the check either way.
- Confirm crossfade fires on cut changes at the band (it exists; verify, don't rebuild).
- Pick the weight that materially reduces the band with <10% triangle-count regression at L2/L3; update `clod_pages.yaml` with a comment naming this ticket.
- Explicit close-out statement: residual interpolation difference at cross-LOD borders is inherent to LOD and accepted; A2 covers border vertices only.

Depends: DBG-4 = branch A. Est: 1d.
Acceptance: chosen weight committed with the sweep table; band judged acceptable at realistic distances (force the L1 pages to their natural selection distance by raising world size or moving camera — record which).

**Prompt**
```text
Context: branch A means geometry and data are correct; the band is the visual cost of
sparse normal sampling on big L1 triangles next to dense L0. The levers are: how much
the simplifier protects the normal field (attribute weight), whether selection
distances are computed right (a too-eager L1 selection exaggerates everything), and
the crossfade masking cut changes.

Steps:
1. Sweep: for w in 0.5/1.0/1.5/2.0: edit clod_pages.yaml attribute_weights.normal,
   reload (world rebuild), capture at the repro pose: divergence view screenshot,
   normal-colours screenshot, HUD tris + per-level counts, lowBenefit count (log it
   if not surfaced — add a console.info in build.ts per node: level, tris, lowBenefit).
   Table into findings doc.
2. Audit selection.ts px math against the formula above; check dist is to the node's
   bounding sphere surface (not center) — center-distance overstates error for big
   far nodes. Fix only on deviation; record the audit either way.
3. Confirm dither crossfade triggers when toggling force-level (visual check).
4. Choose the weight: smallest w where the band stops being objectionable in lit mode
   at the distance L1 would naturally be selected; reject w if L2/L3 triangle counts
   regress >10% vs w=0.5 or lowBenefit count rises at level 1.
5. Commit yaml change + findings table + the close-out paragraph.
Must not: touch weld/lock/simplify code; raise target_error to hide the band; chase
the band to zero (that is chasing LOD itself).
Verify: rebuild at chosen w; repro screenshots before/after in findings; engine note:
the same weight applies to crates/clod-core config when ported (write that in the
findings Next section).
Done when: weight chosen on data, yaml updated, close-out written.
```

---

## DBG-6 — BRANCH B fix: L0 source/weld/winding bug

**Requirements**
- Localize: with all-L0 forced, use divergence view + FrontSide to bound the defect to (a) flipped winding, (b) weld remap corruption, or (c) source mesher emission.
- Add a builder-time assertion for the confirmed sub-case (e.g., winding: signed-area/orientation consistency check per page after weld+compact, hard-fail).
- Fix in the smallest module (weld.ts remap order / compact in simplify.ts / terrain.ts emission), with a regression unit test in the same file’s test path (spike or vitest, match existing test style).

Depends: DBG-4 = branch B. Est: 1–2d.
Acceptance: all-L0 view clean at repro pose; new assertion passes on full world build and FAILS when the fix is reverted (prove it: revert locally, observe failure, restore); engine impact note in findings (does `crates/clod-core` share the bug? check the Rust twin of the guilty function and say yes/no with the line).

**Prompt**
```text
Context: branch B means the defect exists on unsimplified welded L0 pages — a data
bug, highest severity, and possibly shared by the Rust port in crates/clod-core
(weld/compact are twins). Find it, pin it with an assertion, fix it, check the twin.

Steps:
1. Localize with instrumentation only (no fixes yet): force level 0; FrontSide on:
   holes => winding sub-case; else divergence glow on L0: note whether glow follows
   internal chunk-seam lines (weld) or is distributed (source emission).
2. For the winding sub-case: dump one offending triangle (add a temporary picker:
   raycast on click, log node/triangle indices + the three source vertices pre/post
   weld remap) and trace its index path through weld.ts remap and simplify.ts compact.
   The likely defect class: remap applied to an already-remapped index, or triangle
   emitted with swapped order during concat of chunk meshes.
3. For the weld sub-case: at a glowing seam, log the canonical-vs-duplicate pick and
   confirm first-seen ordering is deterministic across the two source chunks
   (iteration order of chunk concat). If neighbor pages pick different canonicals
   with attribute deltas inside tolerance, the bug is tolerance-masked input drift:
   tighten the offending source value in terrain.ts rather than loosening tolerance.
4. Write the assertion FIRST (failing), then the minimal fix, then the unit test
   reproducing the pre-fix state on a tiny synthetic input.
5. Open crates/clod-core/src/{weld.rs,simplify.rs} and check whether the same defect
   exists; record file:line + yes/no in findings. If yes, file a one-line follow-up
   note (engine fix is a separate commit on the Rust side, same test shape).
Must not: widen tolerances; convert the hard-fail to a warning; fix Rust and TS in
one commit (separate per G5).
Verify: full-world rebuild clean; assertion proven live (revert test); repro pose
screenshots before/after into findings.
Done when: clean all-L0, assertion + test committed, Rust-twin verdict recorded.
```

---

## DBG-7 — BRANCH D1 fix: triangulation anisotropy (diagonal lines)

**Requirements**
- Confirmed by E5 (creases align with SN quad diagonals). Change `terrain.ts` quad emission to alternate the diagonal split by **world-cell parity** (so neighboring chunks/pages agree deterministically), preserving CCW winding.
- Before/after screenshots at the repro pose; weld + validate must stay green (split direction must not change border vertex sets).
- If E5 said D2 (terrain ridges): this ticket closes with a findings note only.

Depends: DBG-4 = branch D1. Est: 0.5d.
Acceptance: diagonals gone or visibly randomized at repro pose; full world builds with zero new weld/validate failures; engine note recorded (engine SN shares the consistent-diagonal pattern but masks it with triplanar texturing — fix there only if it ever shows through).

**Prompt**
```text
Context: a consistent quad-split diagonal makes lighting interpolation anisotropic —
long faint creases at 45°. The fix is parity-alternated splits, keyed on WORLD cell
coordinates (not chunk-local), so the choice is identical from both sides of any
border.

Steps:
1. In terrain.ts, find where each surface-nets quad becomes two triangles (the
   QUAD_CELLS consumption / index emission). Identify the four corner vertex indices
   a,b,c,d and current fixed split (a,c,b / b,c,d or similar).
2. Compute parity from the quad's owning WORLD cell: ((cx ^ cy ^ cz) & 1) using the
   global cell coords already available at emission. parity 0 -> current split;
   parity 1 -> the other diagonal, with corner order arranged to keep CCW facing the
   same direction (verify by normal-vs-gradient sign check on a few quads in a quick
   console assert during one dev run, then remove the assert).
3. Rebuild; run E5 again: creases gone/decorrelated? Screenshot pair into findings.
4. Confirm weld report counts and validate assertions unchanged (split direction
   never adds/removes vertices — if weld counts change, you altered emission order
   in a way that changed first-seen canonicals; that is fine ONLY if assertions stay
   green, note it).
Must not: change vertex positions/normals; introduce chunk-LOCAL parity (border
disagreement); leave the temporary winding assert in.
Verify: visual pair; npm build clean; findings updated; one-line engine note.
Done when: D1 resolved or D2 documented as not-a-bug.
```

---

## DBG-8 — Port findings to the engine plans

**Requirements**
- `docs/plans_completed/clod-phase5-plan.md`: add the selector rule **"any page node adjacent to the near-field bubble must be LOD0"** (a page↔chunk constraint, distinct from the page↔page 2:1 rule) into the selection step, marked as originating from this investigation.
- `docs/plans_completed/clod-execution-plan.md` §4.3 debug overlays: add the normal-divergence view and cross-LOD border markers as required engine debug overlays.
- If DBG-5 chose a new normal attribute weight: note it for `crates/clod-core/clod_pages.yaml` (or apply, if the CORE-3 move already landed). If DBG-6 found a Rust twin bug: confirm the follow-up exists.
- One-paragraph summary of the classification appended to the findings doc header.

Depends: whichever of DBG-5/6/7 ran. Est: 0.25d.
Acceptance: both plan docs updated; nothing learned only lives in the PoC.

**Prompt**
```text
Context: the PoC exists to teach the engine. Every confirmed finding becomes either
an engine plan edit, a config value, or a recorded non-issue — never tribal knowledge.

Steps:
1. Edit the two plan docs exactly as the Requirements state; keep edits surgical and
   reference "PoC findings: tools/clod-poc/findings/shading-band.md".
2. Apply/record the config + Rust-twin items per the DBG-5/6 outcomes.
3. Append the summary paragraph to the findings doc.
Must not: rewrite plan sections beyond the listed insertions.
Verify: git diff shows only the intended hunks; links resolve.
Done when: engine plans carry the bubble-adjacency rule, the two debug overlays, and
the investigation's outcome.
```

---

## 3. Expected outcome (so the implementer calibrates, not assumes)

```text
Most likely: band = BRANCH A (inherent cross-LOD interpolation, over-visible because
a 4x4 world selects L1 unrealistically close), diagonals = D1 or D2.
The protocol exists precisely because "most likely" has been wrong twice in this
project's seam history. Run the matrix; believe the matrix.
```
