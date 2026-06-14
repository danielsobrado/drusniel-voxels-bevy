# LOD Documentation Index

Document status (2026-06-14): updated for the CLOD-only LOD path. The retired
multi-LOD / seam-stitch documents have moved to [`../legacy/`](../legacy/).

## Current (CLOD + decimation)

LOD is now CLOD pages — far terrain decimated from merged LOD0 child meshes with
locked/welded borders — plus a live near-field LOD0 bubble. Design + execution:

- [CLOD execution plan](../plans/clod-execution-plan.md)
- [CLOD phase 5 plan](../plans/clod-phase5-plan.md)

Retained live systems documented here:

- [Terrain horizon proxy band](horizon-proxy-band.md) — cheap far backdrop
- [Wireframe & mesh debug guide](wireframe-debug-guide.md) — runtime terrain diagnostic (Alt+F7/F8/F9/F10)
- [Wireframe & mesh debug plan](wireframe-debug-plan.md) — historical plan for the diagnostic above

## Legacy (retired multi-LOD / seam stitch)

Moved to [`../legacy/`](../legacy/): seam closure/audit/issues/lip/topology,
MC+Transvoxel, GPU geomorph, and the LOD hole/terrace/artifact investigations.
