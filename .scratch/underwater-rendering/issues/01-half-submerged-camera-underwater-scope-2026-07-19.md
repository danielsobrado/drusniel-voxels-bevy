# Half-submerged camera needs an explicit underwater-rendering decision

Status: needs-triage
Owner: Rendering
Decision slot: 2026 Q3 visual backlog review

## Problem

When the camera intersects the water surface, the frame can combine above-water and underwater assumptions without a defined transition policy. The result is visually unstable and cannot be accepted permanently as a shoreline exception.

## Scope decision required

- Decide whether the camera may remain half-submerged or must transition through a bounded blend/state change.
- Define fog, refraction, surface clipping, exposure, post-processing, and audio ownership on both sides of the surface.
- Add deterministic enter/exit/hold-at-surface poses to the visual sequence harness.
- Keep this issue separate from frozen-wave shoreline coverage and water-ownership gates.

## Acceptance

- A documented rendering policy owns the half-submerged interval.
- Enter, exit, and stationary surface-crossing sequences have calibrated coverage/depth/pop gates.
- No one-frame full-screen exposure, clipping, or ownership flash occurs.

## Comments

- 2026-07-19: Filed from visual-stability Plan 5 S5. Implementation intentionally waits for the shoreline evidence and prioritization review.
