# Rendering Enhancement Roadmap

This document outlines the rendering enhancement plan for Drusniel Voxels, organized into phases.

## Phase 1: Core Visual Quality (COMPLETE)

### Ambient Occlusion - XeGTAO
- [x] Implement horizon-based AO algorithm
- [x] Add spatial-temporal denoising
- [x] Quality presets (Low/Medium/High/Ultra)
- [x] Config-driven parameters
- [x] GPU feature detection

### Soft Shadows - PCSS
- [x] Percentage-closer soft shadows
- [x] Variable penumbra based on light size
- [x] Per-light configuration
- [x] Directional light integration

### Vegetation SSS
- [x] Subsurface scattering shader
- [x] Light transmission through leaves
- [x] Backlit foliage effect

### Atmosphere
- [x] Bevy native atmosphere integration
- [x] Rayleigh/Mie scattering
- [x] Ozone layer simulation
- [x] Config-driven parameters

### Supporting Systems
- [x] Weather particles (rain/snow/dust)
- [x] Enhanced water (Gerstner waves, foam, caustics)
- [x] Vegetation wind animation
- [x] Volumetric clouds
- [x] Radiance cascades GI foundation

---

## Phase 2: Advanced Effects (PLANNED)

### Screen-Space Reflections (SSR)
- [ ] Hierarchical ray marching
- [ ] Temporal reprojection
- [ ] Roughness-based blur
- [ ] Fallback to environment probes

### Enhanced Bloom
- [ ] Multi-pass bloom with better thresholds
- [ ] Lens flare system
- [ ] Anamorphic bloom option
- [ ] Chromatic aberration option

### Motion Blur
- [ ] Per-object motion vectors
- [ ] Camera motion blur
- [ ] Configurable intensity

### Depth of Field
- [ ] Bokeh-style DoF
- [ ] Circular/hexagonal aperture shapes
- [ ] Photo mode integration

---

## Phase 3: Performance & Polish (PLANNED)

### Temporal Anti-Aliasing (TAA)
- [ ] Improved TAA implementation
- [ ] Motion vector integration
- [ ] Ghosting reduction
- [ ] Sharpening pass

### Level of Detail (LOD)
- [ ] Shader LOD for effects
- [ ] Distance-based quality scaling
- [ ] GPU load balancing

### Optimization
- [ ] Async compute for AO/shadows
- [ ] Culling improvements
- [ ] Memory pooling for render targets

---

## Phase 4: Next-Gen Features (FUTURE)

### Ray Tracing (RTX)
- [ ] RTAO (ray-traced ambient occlusion)
- [ ] RT reflections
- [ ] RT global illumination
- [ ] Fallback to rasterized alternatives

### Advanced GI
- [ ] DDGI (Dynamic Diffuse Global Illumination)
- [ ] Light probe volumes
- [ ] Irradiance caching

### Volumetric Lighting
- [ ] Volumetric fog with shadows
- [ ] God rays
- [ ] Light shafts through geometry

---

## Configuration System

All rendering features use YAML configuration files in `assets/config/`:

```
assets/config/
├── gtao.yaml           # Ambient occlusion
├── pcss.yaml           # Soft shadows
├── atmosphere.yaml     # Sky rendering
├── weather.yaml        # Particle weather
├── water.yaml          # Water rendering
├── wind.yaml           # Vegetation wind
├── volumetric_clouds.yaml  # Cloud system
└── radiance_cascades.yaml  # Global illumination
```

## Quality Presets

The rendering system supports quality presets that adjust multiple settings:

| Preset | GTAO | Shadows | Clouds | GI |
|--------|------|---------|--------|-----|
| Low | Off | PCF 4 | Off | Off |
| Medium | Low | PCF 16 | Low | Basic |
| High | High | PCSS | Medium | Full |
| Ultra | Ultra | PCSS+ | High | Full+ |

## Integration Points

### Camera Setup
Cameras automatically receive rendering components:
- `DepthPrepass` - Required for GTAO
- `NormalPrepass` - Required for GTAO
- `GtaoSettings` - AO configuration
- `Atmosphere` + `AtmosphereSettings` - Sky rendering

### Light Setup
Directional lights receive:
- `PcssShadows` - Soft shadow configuration

### Material Integration
PBR materials enhanced with:
- AO texture sampling from GTAO output
- SSS parameters for vegetation
- Wind animation for foliage

## Performance Targets

| Feature | Budget (1080p) | Budget (4K) |
|---------|----------------|-------------|
| GTAO | 1.5ms | 3.0ms |
| PCSS | 1.0ms | 2.0ms |
| Clouds | 2.0ms | 4.0ms |
| GI | 2.0ms | 4.0ms |
| **Total** | **6.5ms** | **13.0ms** |

Target: Maintain 60fps with all features at High quality on modern GPUs.
