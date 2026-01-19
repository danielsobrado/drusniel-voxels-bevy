# God Rays (Volumetric Light) Testing Log

This document tracks the ongoing effort to implement visible god rays (volumetric light shafts) in the voxel engine using Bevy's built-in volumetric fog system.

## Goal

Create visible light shafts (god rays) that:
- Stream through gaps in terrain/trees
- React to time of day
- Look similar to Valheim's atmospheric lighting
- Work with the existing fog and atmosphere systems

---

## Bevy Requirements for God Rays

For volumetric lighting (god rays) to work in Bevy, **three components are required**:

1. **`FogVolume`** - A 3D volume entity where fog particles exist
2. **`VolumetricFog`** - Component on the camera that enables volumetric rendering
3. **`VolumetricLight`** - Component on a DirectionalLight (sun) to cast rays

All three must be present simultaneously, and the camera must be **inside** the FogVolume.

---

## Current Implementation Status

### Files Involved

| File | Purpose |
|------|---------|
| `src/atmosphere/fog.rs` | Main fog system with FogVolume spawning |
| `src/atmosphere/config.rs` | FogConfig struct with volumetric settings |
| `assets/config/fog.yaml` | Runtime fog configuration |
| `assets/config/atmosphere.yaml` | Atmosphere settings (currently disabled for testing) |
| `src/environment.rs` | Sun spawning with VolumetricLight |
| `src/camera/controller.rs` | Camera setup with VolumetricFog |

### Current Setup

**Sun (environment.rs:122)**:
```rust
VolumetricLight, // Enable god rays
Sun,
```

**Camera (fog.rs:190-196)**:
```rust
pub fn fog_camera_components(config: &FogConfig) -> impl Bundle {
    (
        FogCamera,
        distance_fog_component(config),
        volumetric_fog_component(config),  // VolumetricFog on camera
    )
}
```

**FogVolume (fog.rs:144-157)**:
```rust
fn spawn_global_fog_volume(commands: &mut Commands, _config: &FogConfig) {
    commands.spawn((
        Name::new("GlobalFogVolume"),
        GlobalFogVolume,
        FogVolume::default(),
        Transform::from_scale(Vec3::splat(35.0)),
    ));
}
```

---

## What We've Tried

### Attempt 1: Custom Density Values
**Config tried:**
```yaml
volume:
  density: 0.005
  absorption: 0.001
  scattering: 0.3
  scattering_asymmetry: 0.25
```

**Result:** No visible god rays. Scene appeared normal but no light shafts.

**Theory:** Density too low, values being modified by complex multipliers in code.

---

### Attempt 2: Higher Density with Adjusted Constants
**Code changes (fog.rs):**
```rust
const VOLUME_DENSITY_SCALE: f32 = 0.2;  // Was trying to balance brightness
const MIN_VOLUME_DENSITY: f32 = 0.001;
const MAX_VOLUME_DENSITY: f32 = 0.02;
```

**Result:** Still no visible rays. Scene started getting darker but no shafts.

**Theory:** Complex multipliers in `update_fog_from_atmosphere` were overriding config values.

---

### Attempt 3: Large Fog Volume Size
**Config tried:**
```yaml
volume:
  size: 512.0  # Large to cover entire render distance
```

**Result:** No improvement. God rays still not visible.

**Theory:** Volume size may not be the issue.

---

### Attempt 4: Match Bevy Example Exactly
**Approach:** Strip down to match Bevy's official `volumetric_fog` example.

**Changes made:**
```rust
// Use pure defaults like the Bevy example
FogVolume::default()
Transform::from_scale(Vec3::splat(35.0))  // Same scale as example
```

**Result:** STILL no visible god rays in our game, even though the Bevy example works.

**Theory:** Something else in our setup is preventing rays from appearing.

---

### Attempt 5: Simplify Density Calculations
**Code changes (fog.rs):**
```rust
// For testing: use config density directly without complex multipliers
volume.density_factor = config.volume.density.clamp(MIN_VOLUME_DENSITY, MAX_VOLUME_DENSITY);
volume.scattering = config.volume.scattering;
```

**Removed:** Complex daylight/mie/preset scaling that was modifying density.

**Result:** Pending testing.

---

### Attempt 6: Disable Atmosphere for Clearer Testing
**Config change (atmosphere.yaml):**
```yaml
atmosphere:
  enabled: false  # Using skybox instead for clearer god ray testing
```

**Rationale:** Bevy's Nishita atmosphere might interfere with volumetric fog rendering. Testing with simpler skybox first.

**Result:** Pending testing.

---

### Attempt 7: Add Debug Logging
**Added system (fog.rs:45-94):**
```rust
fn debug_god_rays_status(...)
```

Logs every 5 seconds:
- Whether all 3 required components exist
- Current density, scattering, absorption values
- Light intensity and shadow status
- Volume position vs camera position

**Sample log output:**
```
God rays: density=0.0150, scattering=0.30, absorption=0.01000, light_intensity=9.0, scale=35, steps=64, shadows=true
  Volume pos: (100.0, 25.0, 100.0), Camera pos: (100.0, 25.0, 100.0)
```

**If components missing:**
```
God rays MISSING: FogVolume=true, VolumetricFog=false, VolumetricLight=true
```

---

## Current Test Configuration

**fog.yaml:**
```yaml
fog:
  volumetric:
    enabled: true
    step_count: 64
    jitter: 0.5
    ambient_intensity: 0.0

  volume:
    size: 100.0
    density: 0.015
    absorption: 0.01
    scattering: 0.3
    scattering_asymmetry: 0.5
```

**Code constants (fog.rs):**
```rust
const VOLUME_DENSITY_SCALE: f32 = 1.0;   // Direct pass-through
const MIN_VOLUME_DENSITY: f32 = 0.01;    // Ensure minimum for visibility
const MAX_VOLUME_DENSITY: f32 = 2.0;     // High cap for testing
```

---

## Known Issues & Hypotheses

### Issue 1: VolumetricFog Not Being Added to Camera
**Symptom:** Debug logs might show `VolumetricFog=false`

**Possible cause:** `fog_camera_components()` might not be called when spawning camera, or camera spawns before fog config is loaded.

**To verify:** Check camera spawning code in `src/camera/controller.rs`

---

### Issue 2: FogVolume Not Following Camera
**Symptom:** Camera moves outside the fog volume

**Current fix:** `follow_camera_fog_volume` system keeps volume centered on camera.

**To verify:** Check debug logs - Volume pos should match Camera pos.

---

### Issue 3: Shadows Not Enabled on Sun
**Symptom:** `shadows=false` in debug logs

**Required:** DirectionalLight must have `shadows_enabled: true` for god rays.

**Current:** Set in environment.rs when spawning sun.

---

### Issue 4: Atmosphere Interfering
**Hypothesis:** Bevy's Nishita atmosphere might render over/instead of volumetric fog.

**Test:** Disabled atmosphere, using skybox instead.

---

### Issue 5: Step Count Too Low
**Hypothesis:** Not enough raymarching steps to see subtle density.

**Current:** 64 steps (should be sufficient per Bevy docs)

**To try:** Increase to 128 or 256.

---

## Next Steps to Try

1. **Verify all components exist** - Check debug logs on startup
2. **Test with very high density** - Try `density: 0.5` or higher temporarily
3. **Check shadow cascades** - Ensure shadows cover the fog volume area
4. **Test in simple scene** - Create minimal test with just ground plane + sun + fog
5. **Compare with Bevy example** - Run official example, compare render settings
6. **Check camera render layers** - Ensure volumetric pass isn't being skipped

---

## Bevy Example Reference

From Bevy's `volumetric_fog` example:
```rust
// Camera
commands.spawn((
    Camera3d::default(),
    Camera { hdr: true, ..default() },
    VolumetricFog {
        ambient_intensity: 0.0,
        ..default()
    },
));

// Fog volume
commands.spawn((
    FogVolume::default(),
    Transform::from_scale(Vec3::splat(35.0)),
));

// Directional light
commands.spawn((
    DirectionalLight {
        shadows_enabled: true,
        ..default()
    },
    VolumetricLight,
));
```

**Key differences from our setup:**
- Example uses `Camera { hdr: true }` - verify our camera has HDR enabled
- Example uses pure defaults for FogVolume
- Example has no complex density calculations

---

## Related Commits

- `9049eb8` - Update fog and atmosphere for god rays testing
- `acde1bd` - Tune distance fog near fade and tint
- `799f672` - Implement Phase 1 rendering enhancements with Bevy native atmosphere
- `7402f1c` - Add fog color settings UI for aerial perspective tweaking
- `1f874a3` - volumetric fog settings
- `526aca9` - feat: refactor game menu and implement volumetric fog system
- `f45bc80` - Add Valheim-style visual atmosphere

---

## Resources

- [Bevy volumetric_fog example](https://github.com/bevyengine/bevy/blob/main/examples/3d/volumetric_fog.rs)
- [Bevy FogVolume docs](https://docs.rs/bevy/latest/bevy/pbr/struct.FogVolume.html)
- [Bevy VolumetricFog docs](https://docs.rs/bevy/latest/bevy/pbr/struct.VolumetricFog.html)

---

## Session Notes

### 2024-01-19
- Added debug logging system to verify component presence
- Simplified density calculations to use config values directly
- Disabled atmosphere to isolate volumetric fog testing
- Added indoor density boost for caves/interiors
- Committed changes for later continuation
