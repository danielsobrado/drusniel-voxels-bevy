# Entity Spawn Placeholder

Document status (2026-05-17): current technical note; verify file paths against code when editing.

## Status

Cleaned up.

## Problem

`EntitySpawnState` was an empty resource whose only content was a placeholder comment noting that NPCs had been removed. It was initialized by `EntityPlugin` but had no fields and no callers.

## Change

- Removed the empty `EntitySpawnState` resource.
- Removed the corresponding `app.init_resource::<EntitySpawnState>()` registration.
- Left the active entity systems intact: inventory/equipment resources, health, death marking, item drops, and dead-entity despawn.

## Verification

Passed:

```powershell
rtk cargo check --release --lib --quiet
```

Result: release library target compiled successfully.

## Profiling

Not applicable. This removes an unused resource and does not affect rendering, terrain, water, props, shadows, or frame timing.
