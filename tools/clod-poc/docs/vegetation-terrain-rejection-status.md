# Vegetation terrain rejection status

This note tracks the conservative pre-generation rejection work for CLOD-POC vegetation.

## CPU trees

CPU tree patches are rejected before `generateTreeInstances()` only when all footprint probes are rejected by static terrain rules or terrain-hidden visibility. Mixed and unknown pages are kept.

## CPU grass

CPU grass patches now run a static footprint rejection gate before the candidate loop in `generateGrassInstances()`. Fully invalid grass pages return no instances without incrementing candidate-loop counters.

## CPU understory

CPU understory pages now run a static footprint rejection gate before `createPatch()`. Fully invalid pages do not allocate patch groups or meshes. The generator still keeps its own conservative gate as a fallback.

## Stones

Stones are GPU-scattered. Their terrain rejection stays inside the stone GPU scatter path because stone placement uses different rules from trees/grass: repose slope, stream/cliff probes, water margin, stone terrain weights, and per-class radius/sink config. A CPU-side grass/tree rejection gate is intentionally not shared with stones.

TODO: If stone scatter dispatch cost becomes measurable, add a stone-specific GPU cluster mask or dispatch skip. Do not reuse grass/tree slope or biome rules for stones.
