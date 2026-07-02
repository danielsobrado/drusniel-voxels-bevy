# Vegetation terrain rejection status

This note tracks the conservative pre-generation rejection work for CLOD-POC vegetation.

## Default safety posture

Probe-only static terrain rejection is disabled by default. It is an opt-in tuning/debug path because center/corner probes cannot prove that a whole page has no valid interior vegetation. This prevents false vegetation holes until summary/coverage data can prove full-footprint rejection.

View-dependent tree terrain-hidden rejection remains available through the existing tree terrain-visibility settings. Missing, unknown, mixed, or uncertain pages are kept.

## CPU trees

CPU tree patches can be rejected before `generateTreeInstances()` by terrain-hidden visibility. The opt-in static rule path is kept behind the shared static rejection toggle.

## CPU grass

CPU grass has a static footprint rejection gate before the candidate loop in `generateGrassInstances()`, but that path is opt-in through `DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.staticRulesEnabled`. With defaults, grass keeps all pages and relies on existing per-candidate validation.

## CPU understory

CPU understory pages have a static footprint rejection gate before `createPatch()`, but that path is opt-in through `DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG.staticRulesEnabled`. Fully rejected opt-in pages do not allocate patch groups or meshes. The generator no longer owns a separate duplicate rejection path.

## Stones

Stones are GPU-scattered. Their terrain rejection stays inside the stone GPU scatter path because stone placement uses different rules from trees/grass: repose slope, stream/cliff probes, water margin, stone terrain weights, and per-class radius/sink config. A CPU-side grass/tree rejection gate is intentionally not shared with stones.

TODO: If stone scatter dispatch cost becomes measurable, add a stone-specific GPU cluster mask or dispatch skip. Do not reuse grass/tree slope or biome rules for stones.
