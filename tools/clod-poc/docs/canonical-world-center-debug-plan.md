# Canonical World-Space Center Debug Plan

## Goal

Make every infinite-islands runtime system report which world-space center it is using, then hard-check that the centers match.

The recent visual failure showed a clear split:

```text
terrain / mountains in one area
vegetation ring in another area
ocean / far shell in another area
```

That class of bug happens when systems use different center sources: camera position, player position, orbit controls target, startup world origin, finite-world center, streamed-root center, or stale cached center.

This plan adds a small canonical center service plus debug counters so these bugs become visible immediately.

## Non-goals

- Do not rewrite streaming.
- Do not change CLOD page selection semantics.
- Do not move any work to WebGPU yet.
- Do not change vegetation placement rules.
- Do not change water/far-shell rendering.
- Do not hide center mismatches by snapping everything silently.

This is diagnostic and safety infrastructure. It should make the next GPU/far-summary work safer.

## Required behavior

For `scene=infinite-islands`:

```text
player mode:
  canonical center = player world position

orbit/free-camera mode:
  canonical center = camera world position
```

For finite/non-infinite scenes:

```text
preserve existing behavior unless explicitly opted into canonical-center debug mode
```

The key rule is simple:

```text
all streaming/far/vegetation/water debug centers must be compared against the same canonical center
```

## Definitions

### Canonical center

The single world-space center that systems should use for camera-relative work in the current frame.

```ts
interface CanonicalWorldCenter {
  x: number;
  y: number;
  z: number;
  source: "player" | "camera" | "controls_target" | "startup_world" | "unknown";
  scene: string;
  frame: number;
}
```

### Reported system center

A center emitted by a subsystem.

```ts
interface ReportedWorldCenter {
  system: WorldCenterSystemName;
  x: number;
  y: number;
  z: number;
  source: string;
  frame: number;
}
```

Systems to report initially:

```text
terrainPhase
streamedRoots
selection
liveBubble
vegetationRing
vegetationGrass
vegetationTrees
farShell
farSummary
farClipmap
waterOcean
canopy
longViewDiagnostics
```

## New module layout

Create a pure module:

```text
tools/clod-poc/src/runtime/world_center_debug.ts
tools/clod-poc/src/runtime/world_center_debug.test.ts
```

This module should not import Three.js. It accepts plain numeric positions.

## Proposed API

```ts
export type CanonicalCenterSource = "player" | "camera" | "controls_target" | "startup_world" | "unknown";

export type WorldCenterSystemName =
  | "terrainPhase"
  | "streamedRoots"
  | "selection"
  | "liveBubble"
  | "vegetationRing"
  | "vegetationGrass"
  | "vegetationTrees"
  | "farShell"
  | "farSummary"
  | "farClipmap"
  | "waterOcean"
  | "canopy"
  | "longViewDiagnostics";

export interface WorldCenterPoint {
  x: number;
  y: number;
  z: number;
}

export interface CanonicalWorldCenter extends WorldCenterPoint {
  source: CanonicalCenterSource;
}

export interface WorldCenterDebugConfig {
  enabled: boolean;
  warnDistanceMeters: number;
  failDistanceMeters: number;
  hardFailInAcceptance: boolean;
}

export interface WorldCenterDebugReport {
  system: WorldCenterSystemName;
  distanceXZ: number;
  distanceY: number;
  ok: boolean;
  warn: boolean;
  fail: boolean;
}

export function chooseCanonicalWorldCenter(input: {
  scene: string;
  playerMode: boolean;
  player?: WorldCenterPoint;
  camera?: WorldCenterPoint;
  controlsTarget?: WorldCenterPoint;
  startupWorldCenter?: WorldCenterPoint;
}): CanonicalWorldCenter;

export function compareReportedCenter(
  canonical: CanonicalWorldCenter,
  system: WorldCenterSystemName,
  reported: WorldCenterPoint,
  config: WorldCenterDebugConfig,
): WorldCenterDebugReport;
```

## Center-source rules

### Infinite islands

```text
if player mode and player position exists:
  source = player
else if camera exists:
  source = camera
else if controls target exists:
  source = controls_target, but mark warning
else:
  source = unknown
```

### Finite scenes

```text
keep current system behavior
only report distances when debug flag is enabled
```

This avoids changing unrelated scenes while still allowing diagnosis.

## Config and URL flags

Add config flags:

```text
worldCenterDebug=0|1
worldCenterDebugHardFail=0|1
worldCenterDebugWarnDistance=8
worldCenterDebugFailDistance=64
```

Defaults:

```text
manual dev: enabled for infinite-islands populatedPerf URLs
acceptance: enabled
hard fail: enabled in acceptance, disabled in manual dev unless requested
```

Initial thresholds:

```text
warnDistanceMeters = 8
failDistanceMeters = 64
```

Why these values:

- 8m catches subtle cell/ring drift without being noisy for small smoothing offsets.
- 64m catches page/chunk/ring-size disagreement.
- Current visible bugs are hundreds or thousands of meters, so they will fail clearly.

## Counters

Publish numeric counters with stable names.

### Canonical center

```text
world_center_debug_enabled
world_center_canonical_x
world_center_canonical_y
world_center_canonical_z
world_center_canonical_source_code
world_center_mismatch_count
world_center_warn_count
world_center_fail_count
world_center_max_distance_xz
```

Source codes:

```text
0 unknown
1 player
2 camera
3 controls_target
4 startup_world
```

### Per-system centers

For each system:

```text
world_center_<system>_x
world_center_<system>_y
world_center_<system>_z
world_center_<system>_distance_xz
world_center_<system>_distance_y
world_center_<system>_source_code
world_center_<system>_fail
```

Examples:

```text
world_center_terrainPhase_x
world_center_streamedRoots_distance_xz
world_center_vegetationRing_distance_xz
world_center_farShell_distance_xz
world_center_waterOcean_distance_xz
```

Use exact camel-case or snake-case consistently with existing counter conventions. Prefer snake-case if the current counter system mostly uses snake-case.

## Debug overlay

Add one compact debug line under the existing HUD/debug stats:

```text
center: canonical=camera (2048,96,2048) maxΔ=0.0m fail=0
```

When failing:

```text
center mismatch: vegetationRing Δ=1536m source=controls_target expected=camera
```

Keep it short. Full details live in counters.

## Logging

Log mismatches only when they cross `failDistanceMeters`, and rate-limit by system:

```text
[world-center] mismatch system=vegetationRing distance=1536.0m reported=(512,0,512) canonical=(2048,96,2048) source=controls_target expected=camera
```

Do not log every frame.

## Implementation steps

### Step 1 — Pure module and tests

Create `world_center_debug.ts` and tests.

Test cases:

```text
infinite player mode uses player
infinite orbit mode uses camera
infinite without camera falls back to controls target with warning
finite scene does not force camera over existing target unless debug opt-in says so
reported identical center passes
reported 8m drift warns at threshold
reported 64m drift fails at threshold
non-finite reported center fails
source code mapping is stable
```

### Step 2 — Runtime integration point

Compute canonical center once per frame, as early as possible in the frame loop, after camera/player transforms are known.

Suggested location:

```text
tools/clod-poc/src/runtime/clod_frame_loop.ts
```

Pass the canonical center into terrain frame phase and any downstream deps object that already carries camera/player/controls.

Do not let every system compute its own canonical center.

### Step 3 — Report terrain/stream centers

Add center reports for:

```text
terrainPhase
streamedRoots
selection
liveBubble
```

These are the most correctness-critical.

Acceptance for Step 3:

```text
world_center_terrainPhase_distance_xz = 0 or near 0
world_center_streamedRoots_distance_xz = 0 or near 0
world_center_liveBubble_distance_xz = 0 or near 0
```

### Step 4 — Report vegetation centers

Add center reports for:

```text
vegetationRing
vegetationGrass
vegetationTrees
canopy
```

This catches the observed grass ring offset.

Acceptance for Step 4:

```text
world_center_vegetationRing_distance_xz = 0
world_center_vegetationGrass_distance_xz = 0
world_center_vegetationTrees_distance_xz = 0
```

### Step 5 — Report far/water centers

Add center reports for:

```text
farShell
farSummary
farClipmap
waterOcean
```

This catches ocean/far shell offset from terrain.

Acceptance for Step 5:

```text
world_center_farShell_distance_xz <= 8
world_center_farSummary_distance_xz <= 8
world_center_farClipmap_distance_xz <= 8
world_center_waterOcean_distance_xz <= 8
```

Use `<= 8` instead of exact zero for systems that intentionally snap to tile origins. Also report the snapped tile origin separately when useful.

### Step 6 — Hard acceptance checks

Add threshold checks to the infinite-islands acceptance validation:

```text
world_center_debug_enabled = 1
world_center_fail_count = 0
world_center_max_distance_xz <= 64
world_center_terrainPhase_distance_xz <= 8
world_center_streamedRoots_distance_xz <= 8
world_center_vegetationRing_distance_xz <= 8
world_center_farShell_distance_xz <= 8
world_center_waterOcean_distance_xz <= 8
```

For snapped systems, compare both:

```text
center distance to canonical <= snap size + epsilon
reported snap origin is in the expected tile/ring around canonical
```

Do not require exact equality for snapped clipmaps.

## Handling snapped systems

Some systems should not use the raw canonical center directly. Far clipmaps and summary rings may snap to tile/chunk boundaries.

For these systems, report two centers:

```text
raw requested center
snapped origin/center
```

Counters:

```text
world_center_farClipmap_requested_distance_xz
world_center_farClipmap_snapped_distance_xz
world_center_farClipmap_snap_error_x
world_center_farClipmap_snap_error_z
```

Rule:

```text
requested center should match canonical
snapped center may differ by at most snap interval
```

This prevents false failures while still diagnosing stale finite-world origins.

## Common bug signatures

### Vegetation follows controls target in orbit mode

```text
world_center_canonical_source_code = 2 camera
world_center_vegetationRing_source_code = 3 controls_target
world_center_vegetationRing_distance_xz > 64
```

Fix: vegetation ring should use canonical center, not controls target, for infinite-islands orbit mode.

### Far shell stuck at startup world center

```text
world_center_farShell_distance_xz > 64
world_center_farShell_source_code = 4 startup_world
```

Fix: far shell should use canonical center or snapped center derived from canonical center.

### Streamed roots use page key origin but terrain uses camera

```text
world_center_streamedRoots_distance_xz > 64
world_center_terrainPhase_distance_xz <= 8
```

Fix: streamed-root scheduler origin derivation or camera center injection.

### Water ocean plane centered on finite world

```text
world_center_waterOcean_distance_xz > 64
```

Fix: infinite ocean should be camera-relative or large enough/anchored correctly; finite water body should not be used as infinite ocean proxy.

## Source files likely to change

Read latest main before patching. Likely targets:

```text
tools/clod-poc/src/runtime/world_center_debug.ts
tools/clod-poc/src/runtime/world_center_debug.test.ts
tools/clod-poc/src/runtime/clod_frame_loop.ts
tools/clod-poc/src/runtime/terrain_frame_phase.ts
tools/clod-poc/src/terrain/streaming/clod_streaming_roots.ts
tools/clod-poc/src/terrain/far_summary/*
tools/clod-poc/src/vegetation/*
tools/clod-poc/src/water/*
tools/clod-poc/src/runtime/long_view_frame_diagnostics.ts
tools/clod-poc/tools/infinite_acceptance/thresholds.ts
tools/clod-poc/tools/infinite_acceptance/thresholds_validation.ts
```

Do not assume these exact paths exist. Search latest main first.

## Tests

Run:

```bash
cd tools/clod-poc

npm run typecheck
npm test -- src/runtime/world_center_debug.test.ts
npm test -- tools/infinite_acceptance/thresholds.test.ts
npm test -- tools/infinite_acceptance/thresholds_validation.test.ts
npm test
npm run build
```

Manual acceptance:

```bash
node tools/run-infinite-islands-acceptance.mjs --reuse --gate perf --scene biome-near
node tools/run-infinite-islands-acceptance.mjs --reuse --gate perf --scene walk
```

Manual populated URL should include:

```text
populatedPerf=1&worldCenterDebug=1
```

## Expected result

After implementation:

```text
terrain, stream, vegetation, far shell, water, and diagnostics report one shared center
orbit mode no longer leaves grass around controls.target while terrain follows camera
far shell/ocean no longer use stale startup-world center without being reported
acceptance catches center drift before visual screenshots are needed
```

## Rollout order

1. Land pure module/tests.
2. Compute and publish canonical center only.
3. Add terrain/stream/live-bubble reports.
4. Add vegetation reports.
5. Add far shell/far summary/water reports.
6. Add acceptance hard checks.
7. Only after this, continue GPU far-summary migration.

## Implementation prompts for follow-up agents

### Prompt 1 — pure center module

```text
Read latest main. Add a pure world_center_debug.ts module and tests. It should choose the canonical center for infinite-islands and compare reported centers against it. Do not change runtime behavior yet.
```

### Prompt 2 — frame integration

```text
Read latest main. Compute canonical world center once per frame in the CLOD frame loop and publish canonical center counters. Preserve finite-scene behavior.
```

### Prompt 3 — terrain and stream reports

```text
Read latest main. Add world-center reports for terrainPhase, streamedRoots, selection, and liveBubble. Add counters and fail/warn logging. No visual behavior changes except using the already computed canonical center where current infinite-islands code is clearly using the wrong center.
```

### Prompt 4 — vegetation reports

```text
Read latest main. Add world-center reports for vegetationRing, vegetationGrass, vegetationTrees, and canopy. Infinite-islands orbit mode must use camera-derived canonical center, not controls.target.
```

### Prompt 5 — far and water reports

```text
Read latest main. Add world-center reports for farShell, farSummary, farClipmap, and waterOcean. Handle snapped systems with requested-center and snapped-center counters.
```

### Prompt 6 — acceptance hard checks

```text
Read latest main. Add infinite-islands acceptance checks for world_center_debug_enabled, fail_count=0, max_distance_xz thresholds, and per-system center-distance thresholds. Do not weaken existing thresholds.
```

## Done criteria

```text
world_center_debug_enabled = 1 in infinite-islands acceptance
world_center_fail_count = 0
world_center_max_distance_xz <= configured threshold
terrain/stream/vegetation/far/water centers match or are correctly snapped
manual orbit screenshots show terrain, vegetation, far shell, and water in the same world region
perf runs do not regress from center diagnostics
```
