# Building Material Textures

This folder contains PBR textures for building pieces. Each material type has its own subfolder.

## Folder Structure

```
building/
├── wood/           # Wood plank material
│   ├── albedo.png
│   ├── normal.png
│   ├── roughness.png
│   └── ao.png
├── stone/          # Stone brick material
│   ├── albedo.png
│   ├── normal.png
│   ├── roughness.png
│   └── ao.png
├── metal/          # Metal plate material
│   ├── albedo.png
│   ├── normal.png
│   ├── roughness.png
│   ├── ao.png
│   └── metallic.png
└── thatch/         # Thatch/straw material
    ├── albedo.png
    ├── normal.png
    ├── roughness.png
    └── ao.png
```

## Texture Maps

| Map | Description | Format |
|-----|-------------|--------|
| `albedo.png` | Base color/diffuse | RGB, sRGB color space |
| `normal.png` | Normal map | RGB, **OpenGL format** (green = up) |
| `roughness.png` | Roughness | Grayscale (white = rough, black = smooth) |
| `ao.png` | Ambient occlusion | Grayscale (white = no occlusion) |
| `metallic.png` | Metallic (metal only) | Grayscale (white = metal) |

## Requirements

- **Resolution**: 1024x1024 recommended (512x512 minimum)
- **Format**: PNG (lossless) preferred, JPG acceptable for albedo only
- **Tiling**: All textures must be seamlessly tileable
- **Normal maps**: Must be OpenGL format (green channel = up), NOT DirectX

## Converting DirectX Normals to OpenGL

If your normal maps appear inverted (lighting looks wrong), the green channel needs to be flipped. Most image editors can invert a single channel:
- Photoshop: Select green channel, Image > Adjustments > Invert
- GIMP: Colors > Components > Decompose, invert G, recompose

## Recommended Sources (Free, CC0)

- [ambientCG](https://ambientcg.com/) - High quality PBR textures
- [Poly Haven](https://polyhaven.com/textures) - Photorealistic textures
- [FreePBR](https://freepbr.com/) - Game-ready textures

**Search terms:**
- Wood: "wood planks", "wooden boards", "timber"
- Stone: "stone brick", "cobblestone", "castle wall"
- Metal: "metal plate", "iron sheet", "steel panel"
- Thatch: "thatch roof", "straw", "hay"

## Material Properties

The shader uses these per-material settings:

| Material | Parallax Scale | Metallic |
|----------|---------------|----------|
| Wood | 0.03 (subtle) | No |
| Stone | 0.05 (pronounced) | No |
| Metal | 0.02 (minimal) | Yes |
| Thatch | 0.04 (moderate) | No |
