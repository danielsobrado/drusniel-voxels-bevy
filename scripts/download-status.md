# Asset Download Status

## ✅ Successfully Downloaded (ambientCG)

All terrain textures from ambientCG downloaded successfully:

- **Grass** (Grass001_1K-JPG) - ✅ albedo.png, normal.png, ao.png, roughness.png
- **Dirt** (Ground037_1K-JPG) - ✅ albedo.png, normal.png, ao.png, roughness.png
- **Rock** (Rock030_1K-JPG) - ✅ albedo.png, normal.png, ao.png, roughness.png
- **Sand** (Ground054_1K-JPG) - ✅ albedo.png, normal.png, ao.png, roughness.png
- **Tilled Soil** (Ground048_1K-JPG) - ✅ albedo.png, normal.png

## ❌ Failed Downloads (Require Manual Download)

### 3DTextures.me Assets
These need to be downloaded manually from 3dtextures.me:

1. **Wood Planks** (for buildings/wood_plank)
   - Visit: https://3dtextures.me/2022/02/23/stylized-wood-wall-001/
   - Download and extract to: `assets/pbr/buildings/wood_plank/`
   - Maps needed: albedo.png, normal.png, roughness.png, ao.png

2. **Stone Brick** (for buildings/stone_brick)
   - Visit: https://3dtextures.me/2021/08/20/stylized-stone-wall-001/
   - Download and extract to: `assets/pbr/buildings/stone_brick/`
   - Maps needed: albedo.png, normal.png, roughness.png, ao.png

3. **Metal Plates** (for buildings/metal_plate)
   - Visit: https://3dtextures.me/2022/06/15/stylized-metal-plates-001/
   - Download and extract to: `assets/pbr/buildings/metal_plate/`
   - Maps needed: albedo.png, normal.png, roughness.png, metallic.png, ao.png

4. **Thatch/Straw Roof** (for buildings/thatch)
   - Visit: https://3dtextures.me/2021/11/03/stylized-straw-roof-001/
   - Download and extract to: `assets/pbr/buildings/thatch/`
   - Maps needed: albedo.png, normal.png, roughness.png, ao.png

5. **Wood Shingles** (for buildings/wood_shingles)
   - Visit: https://3dtextures.me/2021/11/10/stylized-wood-shingles-001/
   - Download and extract to: `assets/pbr/buildings/wood_shingles/`
   - Maps needed: albedo.png, normal.png, roughness.png, ao.png

6. **Cliff Rock** (for props/rocks/rock_large)
   - Visit: https://3dtextures.me/2019/09/13/stylized-cliff-rock-001/
   - Download and extract to: `assets/pbr/props/rocks/rock_large/`
   - Maps needed: albedo.png, normal.png, roughness.png, ao.png

7. **Cobblestone** (for props/cobblestone)
   - Visit: https://3dtextures.me/2025/12/23/cobblestone-irregular-floor-001/
   - Download and extract to: `assets/pbr/props/cobblestone/`
   - Maps needed: albedo.png, normal.png, roughness.png, ao.png

8. **Crate** (for props/containers/crate)
   - Visit: https://3dtextures.me/2021/09/29/stylized-crate-001/
   - Download and extract to: `assets/pbr/props/containers/crate/`
   - Maps needed: albedo.png, normal.png

### Water Texture (ambientCG)
- **Water** (Water002 - ID may be different)
  - Search at: https://ambientcg.com/
  - Look for water textures with normal maps
  - Download and extract to: `assets/pbr/water/`
  - Rename the normal map to: `flow_normal.png`

### Crops Models (Quaternius)
- **Ultimate Crops Pack**
  - Option 1: https://poly.pizza/m/Ro6K0Yg7mx
  - Option 2: https://quaternius.com/packs/ultimatecrops.html
  - Download GLB/FBX models
  - Place in: `assets/models/crops/` (organized by crop type)

## Manual Download Instructions

1. Visit each URL listed above
2. Download the free 1K or 2K version (1K is sufficient for most games)
3. Extract the ZIP file
4. Rename texture maps to match the expected names (e.g., `*_basecolor.png` → `albedo.png`)
5. Copy to the appropriate asset folder

## Why Automated Download Failed

3dtextures.me implements download protection to prevent automated scraping:
- May require CAPTCHA verification
- May require Ko-fi tip or Patreon support for bulk downloads
- Direct ZIP URLs are not publicly accessible

The manual download process ensures you're respecting the creator's distribution preferences while still getting free access to these excellent textures.
