# Prop Reflection Layers

Document status (2026-05-17): current technical note; verify file paths against code when editing.

## Status

Implemented at instanced prop group granularity.

## Problem

Instanced prop render groups were kept on the default render layer only, so the water reflection camera, which renders `REFLECTION_RENDER_LAYER`, could not see them.

## Change

- Added `RenderLayers::default().with(REFLECTION_RENDER_LAYER)` to spawned instanced prop group entities.
- Kept default layer membership so props still render normally in the main camera.

## Design Note

Instanced props are grouped by mesh/material. Layer membership is therefore applied to the whole render group, not per prop instance. This makes props participate in water reflections with the current renderer architecture, but it does not yet support excluding individual below-water prop instances from a mixed group.

## Verification

Passed:

```powershell
rtk cargo check --release --lib --quiet
```

Result: release library target compiled successfully.

## Profiling

No performance claim is made for this change. It can increase water reflection draw work because props are now eligible for the reflection camera. The visual-regression bench baseline attempted during this work exited after a render-ready timeout, so no before/after `summary.json` comparison is available.
