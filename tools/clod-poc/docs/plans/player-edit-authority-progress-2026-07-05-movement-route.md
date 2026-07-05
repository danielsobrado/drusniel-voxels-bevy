# Infinite islands movement route review — 2026-07-05

Scope: tools/clod-poc only.

## Context

The 2026-07-05T03-22-45 acceptance run no longer had convergence timeout failures and no longer had zero collider pages across all scenes. Freeze scenes passed. The remaining failures were isolated to the walk scene: the movement route barely moved, so the movement probe did not exercise live-bubble builds during motion.

## Review finding

The acceptance harness was updated to drive `window.__drusnielClod.setPose()` instead of depending on headless keyboard input. That fixed camera movement, but in player mode the frame loop uses `player.position` as the live-bubble center, not `camera.position`. The existing diagnostics `setPose()` hook only moved the camera and OrbitControls. This meant the route could report camera distance while the actual player/live-bubble center stayed still.

## Fix landed

`src/app/bootstrap/ui/player_startup.ts` now wraps the automation pose hooks when player mode is active:

- `setPose()` moves `player.position` to the requested X/Z.
- Player Y is resolved from `surfaceHeight()` plus a small surface offset.
- Player velocity and input are reset so automation movement is deterministic.
- Camera pose is then synchronized from the player eye height.
- `getPose()` returns the player-mode camera pose and player yaw/pitch while playing.

This keeps the acceptance movement route deterministic while still exercising the real player/live-bubble critical path.

## Validation target

```bash
npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc run accept:infinite-islands
```

Expected improvement: walk movement distance should exceed the route threshold and `liveBubbleBuiltDelta` should become positive during motion.
