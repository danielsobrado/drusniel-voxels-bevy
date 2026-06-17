# Plan: Debug Launch / Bookmark Params (steal LAAS URL params, adapt to Drusniel)

Status: proposed. Owner: TBD. Created 2026-06-17.

This plan mirrors LAAS's "every run is fully described by its URL" idea
([`Params.ts`](../reference/fable5-world-demo/src/core/Params.ts),
[`Bookmarks.ts`](../reference/fable5-world-demo/src/debug/Bookmarks.ts),
[`launch.ts`](../reference/fable5-world-demo/tools/launch.ts)) and adapts it to
Drusniel, where the equivalent surfaces are **CLI flags + bench scene/checkpoint
TOML**, not URL query params.

Goal: a single, reproducible param vocabulary —
**seed, player/camera pose, time of day, quality preset, freeze LOD, freeze
wind, freeze water, freeze time, debug view, named checkpoints (bookmarks)** —
that works in two modes:

1. **Interactive** — launch the live game at a named bookmark/pose to look at a
   bug (today impossible; there is no such CLI).
2. **Deterministic capture** — bench scenes (today strong, but missing wind/water
   freeze and a shared bookmark registry).

This is the sibling of the QA harness plan
([`qa-regression-harness-plan.md`](qa-regression-harness-plan.md)): the freeze
flags below are exactly what that plan's `capture` block
(`freeze_time/weather/lod_after_ready`) needs to be real, and a "bookmark" *is* a
"named camera path."

---

## 0. The LAAS surface we are mirroring

| LAAS URL param | Meaning | Drusniel today | Gap |
|---|---|---|---|
| `?seed=N` | world seed, reproduces world | `BenchScene.seed` (scene TOML) | no interactive `--seed` for the live game |
| `?T=hours` | time of day 0..24 | `BenchCheckpoint.time_of_day` | per-checkpoint only; no interactive `--tod`; no "stop ToD advancing" |
| `?cam=px,py,pz,yaw,pitch[,fov]` | exact pose | `BenchCheckpoint.position` + `look_at` (+ `motion`) | no compact pose string; no interactive `--cam`; no "print current pose" |
| `?preset=low\|high\|ultra` | quality preset | `render_toggles.quality_preset` = `Low\|Medium\|High\|Performance100` | works in bench; not exposed interactively |
| `?freeze=1` | freeze world time/motion | `freeze_terrain_lod_after_ready` (LOD only) | **no wind freeze, no water freeze, no global time freeze** |
| `?hud=1` | debug HUD | terrain-debug on-screen indicators | no unified `--hud` |
| `?shot=N` / keys 1–9 / `?fly=1` | boot into / jump to a bookmark | `BenchCheckpoint` (capture only) | **no interactive bookmark jump, no shared bookmark registry, no `--shot`/`--at`** |
| (debug views: Alt+F7/F8/F9/F10) | wireframe/normals/iso/flat | `BenchCheckpoint.terrain_debug` + hotkeys | bench can set them; no `--debug-view` launch flag |
| `P` prints `?cam=` string | capture framing to share | — | **missing: no way to dump current pose as a pasteable param** |

**Two facts that shape the design:**

- Drusniel already has the *capture* half well-covered by bench TOML. The real
  gap is the *interactive* half — "boot the live game right here, frozen, in this
  debug view" — and the **freeze primitives** (wind/water/time) that both halves
  need.
- A LAAS bookmark and a bench checkpoint are the **same data** (name + pose +
  ToD + framing). Drusniel should store them once and let both the interactive
  launcher and the bench runner read them, instead of duplicating poses.

---

## 1. Repository audit (done — findings)

- **Bench CLI**: `BenchCli` (clap) in
  [`src/diagnostics/bench/mod.rs:80`](../../src/diagnostics/bench/mod.rs#L80) —
  `--bench`, `--bench-out`, `--bench-headless`, `--editor-runtime`,
  `--editor-native-viewport`. Parsed in
  [`src/app/mod.rs:64`](../../src/app/mod.rs#L64). **This is the only structured
  CLI** — there is no interactive `--seed`/`--cam`/`--at`.
- **Scene TOML**: `BenchScene` (`mod.rs:522`) — `seed`, `chunk_load_radius`,
  `world_size_chunks`, `world_cache_path`, `freeze_terrain_lod_after_ready`,
  `render_toggles`, `[[checkpoint]]`.
- **Checkpoint TOML**: `BenchCheckpoint` (`mod.rs:551`) — `name`, `position`,
  `look_at`, `time_of_day`, `hold_frames`, `fog_tier`, `motion`,
  `screenshot_points`, `terrain_debug` (`wireframe/normals/iso_band/flat_unlit`),
  `render_features`. **These named, posed checkpoints are de-facto bookmarks.**
- **Quality preset**: `RenderQualityPreset` in
  [`src/rendering/device/quality.rs:13`](../../src/rendering/device/quality.rs#L13)
  = `Low | Medium | High(default) | Performance100` (serde aliases
  `performance_100`). Exposed via `render_toggles.quality_preset`.
- **Freeze today**: only `freeze_terrain_lod_after_ready`.
  **No wind freeze, no water freeze, no global animation-time freeze.** Wind lives
  in [`src/world/environment/vegetation/wind.rs`](../../src/world/environment/vegetation/wind.rs);
  water visual time in
  [`src/rendering/diagnostics/water_visual_probe.rs`](../../src/rendering/diagnostics/water_visual_probe.rs)
  and the water material; fog/ToD in
  [`src/world/environment/atmosphere/fog.rs`](../../src/world/environment/atmosphere/fog.rs).
- **Debug views**: per-checkpoint `terrain_debug`; interactive hotkeys Alt+F7/F8/
  F9/F10 (see [CLAUDE.md] table); `render_toggles.experimental_render_mode` /
  `voxel_ray_backend`.
- **No pose-dump**: nothing prints the current camera/player pose in a pasteable
  form (LAAS key `P`).

---

## 2. Design: one param vocabulary, three carriers

Define the canonical set once (a `DebugParams` struct), carried by three
interchangeable surfaces that all deserialize into it:

```
DebugParams {
  seed: u64,
  spawn: PoseOrBookmark,     // bookmark name, OR explicit player+camera pose
  time_of_day: f32,          // 0..1 (Drusniel convention) — note unit vs LAAS hours
  preset: RenderQualityPreset,
  freeze: FreezeFlags { lod, wind, water, time },
  debug_view: DebugView,     // none | wireframe | normals | iso_band | flat_unlit | experimental(<mode>)
  hud: bool,
}
```

Carriers:

1. **Interactive CLI** (new): `--seed`, `--at <bookmark>` / `--cam "x,y,z,yaw,pitch[,fov]"`,
   `--tod`, `--preset`, `--freeze lod,wind,water,time` (or `--freeze all`),
   `--debug-view <name>`, `--hud`. Added to the top-level clap parser **next to**
   `BenchCli` (a sibling `DebugLaunchCli`), so the live game can boot into a
   frozen, posed, debug-viewed state. Absent any flag → normal game, **zero
   cost** (mirrors QA opt-in).
2. **Bookmark registry** (new): `assets/config/bookmarks.toml` — a list of named
   `{ name, position, look_at, time_of_day, preset?, tags? }`. Read by both the
   interactive launcher (`--at <name>`) and, optionally, referenced by bench
   checkpoints so a pose lives in exactly one place.
3. **Bench scene/checkpoint TOML** (existing): extend with the new freeze fields
   and an optional `bookmark = "<name>"` that expands to position/look_at/tod from
   the registry (keeping inline poses working for back-compat).

`time_of_day` unit caveat: LAAS uses **hours 0..24**; Drusniel checkpoints use a
**0..1 fraction** (e.g. `0.42`). Keep Drusniel's 0..1 convention everywhere and
document it in the CLI help; do not silently mix units.

---

## 3. The freeze primitives (the real new work)

These are the load-bearing additions; everything else is plumbing. Each must be a
single source of truth toggled by `FreezeFlags`, usable from both interactive and
bench paths, and **off by default** so gameplay is unaffected.

- **`freeze.lod`** — reuse `freeze_terrain_lod_after_ready`. Already exists; wire
  it to the unified flag.
- **`freeze.wind`** — freeze the wind animation clock so foliage sway is static.
  Implement by holding the wind time uniform/accumulator constant after ready in
  [`wind.rs`](../../src/world/environment/vegetation/wind.rs). If the wind time is
  driven directly off `Time`, introduce a small wind-local accumulator that can be
  paused (minimal, surgical). **TODO if the uniform is shared**: leave a clear
  comment at the freeze point.
- **`freeze.water`** — hold the water surface animation time constant (wave/flow
  phase) so reflections/refractions are deterministic. Same accumulator-pause
  pattern in the water material/update path.
- **`freeze.time`** — stop time-of-day advancing **and** pause any global
  animation clock the renderer reads (so atmosphere/sun stop). Distinct from
  setting a ToD value: `--tod 0.42` sets it, `freeze.time` stops it moving.

These four are exactly the QA plan's `capture.freeze_*` flags — implement them
here, consume them there. Add a `--freeze all` shorthand = `lod,wind,water,time`,
which is the deterministic-capture default.

**Determinism note (steal LAAS's lesson):** even with these, TAA/temporal jitter
makes frames differ by phase; freezing world motion is necessary but the capture
path still relies on settle frames. Don't claim bit-identical frames from freeze
alone.

---

## 4. Bookmarks = named camera paths (shared registry)

`assets/config/bookmarks.toml`:

```toml
[[bookmark]]
name = "spawn_morning"
position = [256.0, 82.0, 220.0]
look_at  = [282.0, 64.0, 250.0]
time_of_day = 0.42
tags = ["smoke", "terrain", "sky"]

[[bookmark]]
name = "water_sunset"
position = [256.0, 86.0, 220.0]
look_at  = [284.0, 64.0, 250.0]
time_of_day = 0.72
preset = "High"
tags = ["water"]
```

- **Interactive**: `--at spawn_morning` boots the live game there, frozen if
  `--freeze` is also given.
- **Bench**: a checkpoint may say `bookmark = "spawn_morning"` instead of inline
  `position`/`look_at`/`time_of_day`; the loader expands it. Inline values still
  work and override the bookmark when both are present (document precedence).
- **QA cross-use**: the QA harness's scene `checkpoint` ids can resolve to the
  same bookmark names, so "the framing that caught the bug" is one canonical
  entry reused across interactive debugging, bench capture, and QA probes.
- Validate on load: duplicate names, unknown preset, malformed pose → typed
  errors (`BookmarkError::{DuplicateName, UnknownPreset, InvalidPose}`).

Optional later (not v1): in-game keys 1–9 / a `goto <bookmark>` debug console
command, and `?fly`-style flythrough through a bookmark subset. Call these out as
follow-ups; v1 is launch-time `--at` only to keep scope tight.

---

## 5. Pose capture (the `P` key, in reverse)

LAAS key `P` prints the current pose as a `?cam=` string so a human can paste a
framing back into a tool. Drusniel needs the same so you can stand somewhere
interesting and turn it into a bookmark or bench checkpoint:

- Add a debug hotkey (interactive only) that prints the current player+camera
  pose as a one-line, pasteable form:
  `--cam "x,y,z,yaw,pitch"` **and** a TOML `[[bookmark]]`/`[[checkpoint]]` block.
- Reuse the existing terrain-debug overlay/indicator plumbing for the on-screen
  confirmation; write the block to stdout and (optionally) to
  `debug/pose-<ts>.toml` next to the existing `debug/` dumps.
- This closes the loop: explore → capture pose → paste into `bookmarks.toml` →
  reuse in bench/QA.

---

## 6. Module layout & wiring

Keep files small, place under the existing diagnostics tree (sibling to `bench/`):

```
src/diagnostics/debug_launch/
  mod.rs        # DebugLaunchCli (clap) + plugin glue, opt-in
  params.rs     # DebugParams, FreezeFlags, DebugView, PoseOrBookmark + parsing
  bookmarks.rs  # registry load + validation (BookmarkError)
  apply.rs      # apply DebugParams to a running app (pose, tod, preset, freeze, view)
  pose_dump.rs  # capture current pose → pasteable string/TOML
```

Freeze flag plumbing lives next to each system it touches (wind.rs, water update,
ToD/atmosphere), driven by a shared `FreezeState` resource set from either CLI or
bench scene. Bench TOML gains `freeze_wind`, `freeze_water`, `freeze_time`
(`#[serde(default)]`) on `BenchScene`, plus optional `bookmark` on
`BenchCheckpoint`.

Wiring: parse `DebugLaunchCli` alongside `BenchCli` in
[`src/app/mod.rs`](../../src/app/mod.rs); if any debug-launch flag is set and
`--bench` is not, install `DebugLaunchPlugin`. `--bench` + debug-launch flags are
mutually exclusive (bench scenes carry their own params) — error like the
existing `--editor-runtime` + `--bench` guard.

---

## 7. Typed errors & logging

- `DebugLaunchError::{ UnknownBookmark{name}, BadCamString{value},
  ConflictingBenchFlags, InvalidPreset{value}, InvalidDebugView{value},
  TimeOfDayOutOfRange{value} }`; `BookmarkError` as above. No `unwrap`/`expect`
  outside tests.
- Log a single `[debug-launch]` line echoing the resolved `DebugParams` at boot
  so a run is self-describing in the log (LAAS prints its full URL). The
  authoritative record is still the resolved struct, not the log.

---

## 8. Tests & validation

- Unit: bookmark registry load + validation (dupes, unknown preset, bad pose);
  `--cam` string round-trip (parse → pose → format); `--freeze all` expansion;
  bench `bookmark =` expansion + inline-override precedence; ToD range clamp.
- Behavioural: freeze flags hold their clocks constant across N frames (assert
  wind/water/time accumulators don't advance once frozen) — small headless test
  if feasible, otherwise a focused unit on the accumulator.
- **Per CLAUDE.md**, any freeze touching render time must be benched on a
  deterministic visual scene (`--bench`) and compared via `summary.json` +
  `bench_guard`; the freeze paths are gated off by default so default frame time
  must be unchanged — verify and state it.
- `cargo fmt`, `cargo clippy --all-targets -- -D warnings`, `cargo test` for the
  new module.

---

## 9. clod-poc parity

clod-poc (TS/three.js, [`tools/clod-poc/`](../../tools/clod-poc/)) is the natural
home for the **literal** LAAS URL-param port, since it is a browser app:

- Add `?seed`, `?cam`, `?tod`, `?preset`, `?freeze=lod,wind,water,time`,
  `?view`, `?at=<bookmark>`, `?hud` parsing (mirror
  [`Params.ts`](../reference/fable5-world-demo/src/core/Params.ts)).
- Share the **same `bookmarks.toml`/`.yaml` schema** (clod-poc already depends on
  `js-yaml`) so a bookmark name means the same framing in both engines.
- Add the pose-dump (`?` → console `?cam=` string) like LAAS key `P`.
- This dovetails with the QA harness clod-poc port: the QA `shoot`/`qa` tools
  build their URLs exactly from this param set.

The cross-engine contract is just the **param vocabulary + bookmark schema**; pin
them in a short `docs/debug/params.md`.

---

## 10. Scope / order

1. `FreezeFlags` + the four freeze primitives (lod reuse, wind, water, time) →
   tests. *(Highest value; unblocks QA determinism.)*
2. `bookmarks.toml` registry + loader/validation → tests.
3. Bench TOML: add `freeze_wind/water/time` + optional `bookmark =` expansion.
4. Interactive `DebugLaunchCli` + `apply.rs` (`--seed/--at/--cam/--tod/--preset/
   --freeze/--debug-view/--hud`).
5. Pose-dump hotkey.
6. Docs (`docs/debug/params.md`) + clod-poc URL parity.

Follow-ups (not v1): in-game bookmark hotkeys/console `goto`, flythrough paths.

Every step lands behind opt-in flags; default gameplay, bench, and `bench_guard`
must stay unchanged throughout.
