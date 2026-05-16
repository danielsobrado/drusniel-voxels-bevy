# Particle Effects

## Status

Implemented for dig events.

## Problem

`src/particles/mod.rs` registered `SpawnParticleEvent` but did not render anything. The setup used `EffectAsset::default()`, event handling drained messages, and cleanup despawned effect entities immediately.

## Change

- Added a real one-shot Hanabi `dig_burst` effect.
- Spawned `ParticleEffect` entities when `SpawnParticleEvent { particle_type: Dig }` is received.
- Added timed cleanup that waits for the burst and particle lifetime instead of despawning immediately.
- Reused the same Hanabi APIs already used by torch and weather particles.

## Verification

Passed:

```powershell
rtk cargo check --release --lib --quiet
```

Result: release library target compiled successfully.

## Profiling

No performance claim is made for this change. The required visual-regression baseline bench was attempted during this work, but the run exited after a render-ready timeout at `ridge-run-noon`, so no usable before/after `summary.json` comparison is available.
