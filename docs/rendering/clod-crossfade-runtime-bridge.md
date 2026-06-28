# CLOD crossfade runtime bridge

`voxel::pages::crossfade_runtime` connects the renderer-agnostic crossfade
sequencer to Bevy page entities.

It is intentionally **default-off**:

```bash
VOXEL_CLOD_CROSSFADE_BRIDGE=1 cargo run --release
```

Optional duration override:

```bash
VOXEL_CLOD_CROSSFADE_BRIDGE_FRAMES=12 cargo run --release
```

## What it does

The bridge runs after CLOD page selection. It:

1. reads the selected rendered cut from `ClodPageSelectionState`;
2. creates a `ClodCutSnapshot` using stable node ids `level:x:z`;
3. starts a transition when the selected cut changes;
4. writes `ClodPageFade` to page mesh entities;
5. keeps fade-out pages visible while a transition is active;
6. removes stale fade components once a page is no longer part of the transition.

The component is deliberately small:

```rust
pub struct ClodPageFade {
    pub alpha: f32,
    pub role: ClodDitherRole,
}
```

## Why this exists

The PoC separates cut selection, cut freezing, crossfade state, and dither
material logic. This PR mirrors that boundary on the Rust side. It does not yet
change WGSL/material code; it gives the renderer and debug/bench code a stable
ECS component to consume in a follow-up PR.

The existing selection material fade path can continue to run. This bridge is a
parity/debug layer and is opt-in until the shader integration is reviewed.
