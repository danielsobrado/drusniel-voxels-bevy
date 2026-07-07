# Drusniel CLOD-POC: Performance-First WebGPU Geomorphing and Crossfade Plan

Requirement plan for stable far-mountain streaming without CPU-heavy mesh duplication


## 1. Goal

The current streamed-root CLOD path is fast enough to expose the next visual problem: far mountains blink and jump shape when streamed roots switch between safety parents, refined child pages, and newly streamed pages. The next implementation should make those transitions visually stable without moving heavy work back to the CPU.

Primary goal: remove far-terrain popping and blinking during movement.

Primary constraint: keep the solution performance-first, shader-based, and WebGPU-friendly.

Secondary goal: keep the existing CPU worker fallback, validation path, and safety-page convergence guarantees unchanged.


## 2. Non-goals

Do not rebuild or blend full CPU meshes per frame.

Do not add per-frame readbacks for transition state.

Do not weaken streaming coverage, safety-page validation, or GPU fallback rules.

Do not require full terrain geomorphing across all nodes in the first patch. The first patch should target streamed-root transitions only.


## 3. Current Problem

The streamed-root controller can activate a different root set as soon as new pages are cached. This can replace a coarse L1 parent with L0 children, remove old roots, or activate a new ring while the camera is moving. The current hysteresis patch delays unstable root-set switches, but it is not a visual transition system. A proper solution needs shader-side blending and/or shader-side displacement morphing.


## 4. Requirements


## 5. Proposed Architecture

Use two layers. The first gives immediate visual stability with low risk. The second adds real geomorphing where it is safe and cheap.


### Layer A: Shader crossfade

Keep old and new root meshes live for a short transition window. Each mesh receives transition uniforms/attributes. The shader fades pixels with dithered alpha or coverage-stable alpha clip. This hides root activation/deactivation without changing vertex positions.


### Layer B: Shader geomorph displacement

Where parent and child can share a predictable height source, child vertices receive a morph delta from parent representation to child representation. The shader blends position height from old to new over time. This reduces silhouette jumping, especially on mountains.


### Layer C: Transition scheduler

The controller chooses when to start, hold, complete, or cancel transitions based on safety coverage, camera motion, caps, and validation status.


## 6. Phase 1: WebGPU Shader Crossfade

This is the first implementation target. It is lower risk than full geomorphing and should address blinking immediately.

Represent root replacement as a transition pair: outgoing root IDs and incoming root IDs.

Keep outgoing roots in the render root list for N frames after incoming roots are ready.

Assign each streamed root a transition state: stable, fadingIn, fadingOut, or forcedVisibleForSafety.

Feed transition progress to the terrain material as a uniform buffer or per-object material uniform.

Use blue-noise or screen-space hash dither alpha clip instead of normal translucent blending where possible. This avoids depth sorting and overdraw surprises.

Fallback to hard switch if transition budget is exceeded or safety coverage requires immediate replacement.

Shader behavior

// Conceptual WGSL/TSL material inputs

struct TerrainTransitionParams {

transitionProgress: f32;  // 0..1

transitionMode: u32;      // 0 stable, 1 fadeIn, 2 fadeOut

ditherStrength: f32;

frameSalt: u32;

};

// Fragment stage concept

let dither = stableScreenDither(pixelCoord, frameSalt);

let alpha = select(1.0, transitionProgress, transitionMode == FADE_IN);

let fadeOutAlpha = 1.0 - transitionProgress;

let visible = dither < alpha;

if (!visible) { discard; }


## 7. Phase 2: Shader Geomorphing

Geomorphing should be added after shader crossfade proves stable. It should be limited to height/displacement morphing first, not full arbitrary mesh-to-mesh correspondence.

Prefer height morphing over arbitrary vertex morph targets. The terrain is procedural/heightfield-like enough for far CLOD silhouettes.

For each new streamed page, provide a parent-height sample function in shader space or a compact parent height texture/atlas reference.

Each vertex computes current child height and approximate parent height at the same world X/Z.

Vertex shader blends Y from parentHeight to childHeight using transitionProgress.

Normals can be blended or recomputed approximately from height gradients later; first pass can keep child normals and rely on crossfade.

Geomorph formula

// Vertex stage concept

let worldXZ = vertexWorldXZ;

let childY = vertexWorldY;

let parentY = sampleParentHeight(worldXZ);

let morphT = smoothstep(0.0, 1.0, transitionProgress);

let morphedY = mix(parentY, childY, morphT);

Important limitation: if parent-height sampling is not available for a page, use crossfade only. Do not try to create CPU-side per-vertex morph target buffers for every streamed page as the default path.


## 8. Runtime Data Model

interface StreamedRootTransition {

id: string;

fromRootIds: string[];

toRootIds: string[];

startedFrame: number;

durationFrames: number;

mode: "crossfade" | "geomorph" | "forcedHardSwitch";

safetyCritical: boolean;

}

interface StreamedRootRenderState {

transitionMode: "stable" | "fadeIn" | "fadeOut" | "morphIn";

transitionProgress: number;

transitionGroupId: number;

}

The controller owns transition lifetime and root-set decisions.

The render/material layer owns shader parameters and draw behavior.

The selection controller should receive stable node IDs plus transition state, not decide transition policy.


## 9. Controller Behavior

Build and validate incoming root pages as today.

Resolve the next desired root set as today.

If the root set changed and the current root set still covers all safety pages, start a transition instead of hard-switching immediately.

Keep outgoing roots active but mark them fadeOut.

Mark incoming roots fadeIn or morphIn.

Commit the new root set when progress reaches 1.0 or when transition budget is exceeded.

Cancel transition and hard-switch only when safety coverage would otherwise be lost.


## 10. Performance Caps


## 11. WebGPU Shader Implementation Notes

Use a small transition uniform buffer for global settings and per-material/per-node state where current material plumbing supports it.

Prefer stable dithered alpha discard over transparent blending. Transparent blending can create sorting issues across terrain pages.

Use world-space or screen-space stable noise, not random per-frame noise, unless temporal shimmer is intentionally hidden by TAA-like accumulation. Current target should be stable dither.

Do not allocate one new material per frame. Reuse material instances or update lightweight uniforms only.

Keep crossfade compatible with existing procedural debug modes and biome material source.


## 12. Likely Files to Touch


## 13. Required Counters

live_clod_stream_transition_active_roots

live_clod_stream_transition_fade_in_roots

live_clod_stream_transition_fade_out_roots

live_clod_stream_transition_geomorph_roots

live_clod_stream_transition_hard_switches_total

live_clod_stream_transition_cancelled_total

live_clod_stream_transition_capped_total

live_clod_stream_transition_ms_p95

live_clod_stream_transition_draw_overhead_roots

live_clod_stream_root_switch_suppressed_frames

live_clod_stream_root_switches_total


## 14. Tests

Root replacement starts a transition when current and next root sets both cover safety pages.

Root replacement hard-switches when current roots no longer cover safety pages.

Outgoing roots are removed after durationFrames or maxTransitionAgeFrames.

Transition caps force hard switch or crossfade-only mode without unbounded root growth.

Selection invalidation does not happen every transition progress frame.

WebGPU unavailable path still runs with hard switch or no-op transition state.

Existing convergence and acceptance tests still pass without weaker thresholds.


## 15. Acceptance Profile

# Visual stability pass

node tools/run-infinite-islands-acceptance.mjs --reuse --gate perf --scene walk

# Manual URL additions for visual A/B

&liveClodRootSwitchStableFrames=8

&liveClodRootTransition=1

&liveClodRootTransitionMode=crossfade

&liveClodRootTransitionFrames=12

# Disable for comparison

&liveClodRootSwitchStableFrames=0&liveClodRootTransition=0

Far mountain silhouettes should no longer blink during normal movement.

No visible holes while moving across the streamed-root boundary.

No increase in failed GPU batches or worker fallback pages.

Frame p95 should not regress more than the agreed transition draw overhead budget.


## 16. Staged Implementation Plan

Step 1: Crossfade state only

Add transition state/counters in the streamed-root controller. Keep old and new roots live for a bounded window. No shader work yet; use this to verify lifetime and caps.

Step 2: Dithered shader fade

Add WebGPU material params for fadeIn/fadeOut and stable dither discard. Avoid transparent blending first.

Step 3: Selection invalidation cleanup

Ensure transition progress does not invalidate the selection cut every frame. Only root-set commit should invalidate structural selection.

Step 4: Geomorph prototype

Add height-based vertex morph for child pages where parent height can be sampled cheaply. Keep crossfade as fallback.

Step 5: Caps and tuning

Tune duration, root caps, and distance rules using perf walk and manual visual tests.


## 17. Risks and Mitigations


## 18. Definition of Done

Manual infinite-islands walk shows no far-mountain blinking or large shape jumps under normal movement.

Transition counters show bounded active transitions and completed switches.

Safety counters still converge: pending and inflight safety pages return to zero.

No GPU failure marks a page ready.

Perf walk and biome-near remain within accepted overhead or expose the next real bottleneck.

The implementation can be disabled with URL params for A/B comparisons.

Prepared for Drusniel CLOD-POC streamed-root WebGPU path
