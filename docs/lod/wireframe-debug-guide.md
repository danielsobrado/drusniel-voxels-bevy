# Terrain Wireframe & Mesh Debug Guide

Runtime diagnostic for classifying terrain artifacts as **geometry**, **shading**, **LOD boundary**, or **skirt/section** issues.

## Key bindings

| Key | Mode |
|---|---|
| **Alt+F7** | Toggle terrain wireframe overlay |
| **Alt+F8** | Toggle normal-as-colour visualisation |
| **Alt+F7 + Alt+F8** | Wireframe edges over normal-fill (combined) |
| **Alt+F9** | Toggle mesher SDF iso-band overlay (composable with other modes) |
| **Alt+Shift+F7** | Capture PNG + JSON sidecar to `debug/wireframe-<timestamp>.*` |

> **Note:** Plain F7/F8 are already used for grass visibility and terrain AO style. Terrain mesh debug uses **Alt** modifiers. **Alt+Shift+F7** captures only — it does not toggle wireframe.

While a mode is active, a one-line hint appears top-right (`TERRAIN DEBUG: WIRE ON`, etc.).

## What each mode tells you

### Wireframe (Alt+F7)

Renders triangle edges in-shader using barycentric UV1 data.

- **Edge colour by mesh section**
  - White: main Surface Nets surface
  - Cyan: horizontal transition apron / seal
  - Magenta: vertical drop curtain
  - Yellow: reserved for future MC+Transvoxel aprons
- **Edge tint by chunk LOD** (multiplied with section colour)
  - LOD0: neutral white
  - LOD1: light blue
  - LOD2: green
  - LOD3: orange (also used for **Culled** chunks that still have mesh entities)

LOD index is baked into per-chunk debug material handles (`weather_flags` bits 24–31).

If you see stepped **triangle edges** on a slope, the artifact is geometric.

### Normals (Alt+F8)

Outputs world normals as RGB (`normal * 0.5 + 0.5`), bypassing the lit triplanar pipeline.

- Smooth geometry + smooth colour gradient → normals match the surface
- Smooth geometry + patchy RGB steps → normals are quantised / face-derived

### Combined (Alt+F7 + Alt+F8)

Normals-as-colour fill with wireframe edges on top. Skips triplanar lighting entirely so both signals stay readable.

### Iso-band (Alt+F9)

Overlays the **mesher SDF** (same field Surface Nets uses) on top of whatever mode is active:

- **Magenta band** where `|sdf| < ε` at the fragment — the true iso-0 surface near the mesh point
- **Orange tint** where `|sdf|` exceeds the mismatch threshold — mesh surface sits off the mesher zero crossing
- **Cyan hint** where the SDF sign flips along the surface normal within ε — local iso crossing near the mesh

The overlay samples a 64×48×64 world-space brick centered on the camera (rebuilt ~every 0.35 s or 12 m of movement). Disabled when off: `epsilon = 0` in the shader skips all sampling.

Use this when wireframe shows continuous tris but you suspect the extracted surface is offset from the occupancy field (common at LOD seams).

### Capture (Alt+Shift+F7)

Writes:

- `debug/wireframe-<timestamp>.png` — primary window screenshot (async save)
- `debug/wireframe-<timestamp>.json` — camera pose, FOV, active mode flags, `terrain_settings_hash`

The JSON sidecar is written synchronously before the screenshot entity is spawned; the PNG may land a fraction of a frame later. Both files share the same timestamp stem.

Use the sidecar to correlate captures with hole-probe dumps from the same viewpoint in the **same session**.

#### `terrain_settings_hash` scope

The hash covers mesh mode, water air-exposure mode, and LOD distance bands — **not** world seed, terrain generator version, or SDF parameters. Two different worlds with identical LOD settings will produce the same hash. Treat it as a session-local mesh-settings fingerprint, not a world identity.

## Diagnostic recipe

| Visible artifact | Try mode | If you see… | Conclusion |
|---|---|---|---|
| Stair-step bands on slopes | Alt+F7 wireframe | Triangles themselves are stepped | **Geometry** — binary SDF / coarse extractor. Inspect SDF generation. |
| Stair-step bands on slopes | Alt+F8 normals | Triangles smooth, normal-colour patchy | **Shading** — face-derived normals. Switch to SDF-gradient normals. |
| Horizontal seam at altitude band | Alt+F7 + LOD tint | Different LOD colours meet, edges do not align | **LOD boundary mismatch** — MC+Transvoxel or seam-closure work. |
| Horizontal seam at altitude band | Alt+F7 + section colour | Cyan/magenta skirt edges at the seam | **Skirt insufficient** — real gap exists behind the seal geometry. |
| Holes in the surface | Alt+F7 | No triangles where some should exist | **Missing mesh** — failed chunk, dirty flag, or neighbor gap. Check hole-probe `missing_boundary_neighbors`. |
| Holes with tris nearby | Alt+F9 iso-band | Magenta band drifts away from mesh edge | **Mesh/SDF disagreement** — extractor placed surface off the mesher zero crossing. |
| Dark patches on flats | Alt+F8 normals | Normal gradient looks smooth | **Lighting / AO**, not geometry or normals. |

## Quick workflow

1. Fly to the artifact. Press **Alt+F7** — are the triangle edges stepped?
2. Press **Alt+F8** (keep wireframe on if helpful) — is the normal colour smooth or patchy?
3. Note section edge colours (cyan/magenta = skirt geometry at the seam).
4. Note LOD tints where chunks of different detail meet.
5. **Alt+F9** if you need to see whether mesh vertices sit on the mesher SDF zero crossing.
6. **Alt+Shift+F7** to capture evidence; run hole-probe from the same camera if needed.

## Bench / editor activation

- **Bench:** set `terrain_material_quality = "wireframe_debug"` in the scene TOML (uses the same shader path with LOD tinting once chunks load).
- **Editor:** viewport Wireframe overlay toggles `RuntimeViewportDebugState.wireframe` and shares the same per-LOD debug materials.

## Related docs

- Plan: [`wireframe-debug-plan.md`](wireframe-debug-plan.md)
- LOD seam context: [`lod-seam-closure-plan.md`](lod-seam-closure-plan.md)
- Hole probe: [`lod-terrain-hole-investigation.md`](lod-terrain-hole-investigation.md)
