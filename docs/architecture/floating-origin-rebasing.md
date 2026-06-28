# Floating-origin rebasing

ISLE-16 adds a gated floating-origin path for unbounded procedural worlds in `tools/clod-poc`.

## Scope

Floating origin is **off by default** and only becomes effective when both are true:

1. URL query enables it: `floatingOrigin=1` or `floating_origin=1`.
2. The active `WorldSource` is unbounded: `worldSource.metadata.bounds === "infinite"`.

Bounded ocean-rim worlds are intentionally unaffected. For `infinite-islands`, the current default is an ocean-rim bounded world, so rebasing remains inert unless the scene is also run with an unbounded terrain shape, for example:

```text
?scene=infinite-islands&oceanRim=0&floatingOrigin=1
```

Optional snap size:

```text
?floatingOriginSnap=4096
```

## Runtime model

The controller tracks two coordinate spaces:

| Space | Meaning |
| --- | --- |
| Render space | Small coordinates used by Three.js objects/camera after rebasing. |
| World space | Stable f64-like logical coordinates used for `WorldSource`, far-summary, biome texture streaming, and far-shell sampling. |

When the render camera crosses the snap threshold, the controller:

1. Shifts all scene children by `-delta`.
2. Shifts camera, orbit target, player position, and player safe position by `-delta`.
3. Accumulates `originX/originZ`.
4. Provides a world-space camera proxy for systems that must sample world coordinates.

## Far shell handling

`InfiniteFarShell` now separates its world sampling center from its render transform:

- height/material sampling uses the snapped **world** center,
- mesh position uses `snappedWorldCenter - floatingOriginOffset`.

This prevents the far shell from jumping back to large render coordinates after a rebase.

## Diagnostics

When hooks are available, the following counters are published:

- `floatingOriginEnabled`
- `floatingOriginRebaseCount`
- `floatingOriginLastRebaseFrame`
- `floatingOriginOffsetX`
- `floatingOriginOffsetZ`

## Limits

This is a gated unbounded-mode path. The finite CLOD-page builder and editable near terrain are still finite-world systems. Rebasing protects render precision for long unbounded fly/walk tests, but it does not make finite editable terrain infinite by itself.
