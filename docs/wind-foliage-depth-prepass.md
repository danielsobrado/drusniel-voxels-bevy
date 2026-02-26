# Wind and Foliage

My first wind implementation used simple horizontal offset by tree height: the trunk base stayed fixed while the canopy moved side to side. It looked fine in mild wind, but in stronger gusts trees became visibly skewed rather than bent.

I replaced that with segmented bending. Each tree is split into 10 vertical sections, and each section gets a larger rotation than the one below it. The result is smooth curvature from trunk to crown, with the base still anchored. This is done entirely in the vertex shader and had no measurable frame-time cost.

To avoid trees moving like rigid objects, I added leaf-level motion. Leaf UVs are consistent across meshes, with the branch attachment at `(0, 0)` and the tip near `(1, 1)`. By scaling displacement with UV length, the base remains stable while the rest of the leaf shakes naturally.

# Rendering Cost and Fix

Foliage is expensive because leaves and grass use alpha-cutout textures. That creates heavy overdraw: many fragments run the lighting shader even when they end up hidden by closer foliage.

The optimization is a depth pre-pass:

1. Render foliage depth-only (using the same cutout logic and vertex animation).
2. Render foliage color pass with full shading, but only where depth matches the pre-pass (`DepthFunc = Equal`).

This removes most hidden layers before expensive shading, so fragment work is focused on visible pixels.
