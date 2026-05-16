# Sun Size Setting

## Status

Implemented.

## Problem

The settings menu stored `SunSizeOption`, but the selected value was not applied to the renderer. The handler only contained comments about future directional light or sun disk support.

## Change

- Added Bevy's `SunDisk::EARTH` component to the spawned sun entity.
- Updated the atmosphere settings handler to map `Small`, `Earth`, and `Large` to `SunDisk.angular_size`.
- Preserved the default Earth disk intensity while changing apparent disk diameter.

## Verification

Passed:

```powershell
rtk cargo check --release --lib --quiet
```

Result: release library target compiled successfully.

## Profiling

No performance claim is made for this change. The visual-regression bench baseline attempted during this work exited after a render-ready timeout, so no before/after `summary.json` comparison is available.
