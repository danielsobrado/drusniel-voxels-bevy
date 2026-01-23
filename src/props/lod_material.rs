//! Simplified LOD material for distant props.
//!
//! Provides a cheap unlit material for mid/far distance props that skips
//! normal maps, PBR calculations, and expensive shader branches.
//! Also handles shadow distance culling to reduce shadow map rendering cost.

use bevy::light::NotShadowCaster;
use bevy::pbr::OpaqueRendererMethod;
use bevy::prelude::*;
use bevy::render::render_resource::{AsBindGroup, ShaderType};
use bevy_shader::ShaderRef;

use crate::camera::controller::PlayerCamera;
use crate::constants::{
    PROP_LOD_MATERIAL_HYSTERESIS, PROP_SHADOW_CULL_DISTANCE, PROP_SIMPLE_MATERIAL_DISTANCE,
};

use super::Prop;

// =============================================================================
// Configuration
// =============================================================================

/// Configuration for prop LOD material and shadow settings.
#[derive(Resource)]
pub struct PropLodConfig {
    /// Distance beyond which props stop casting shadows.
    pub shadow_cull_distance: f32,
    /// Distance beyond which props use simplified material.
    pub simple_material_distance: f32,
    /// Hysteresis to prevent rapid LOD switching.
    pub hysteresis: f32,
    /// Update interval in seconds.
    pub update_interval: f32,
    /// Enable shadow distance culling.
    pub shadow_culling_enabled: bool,
    /// Enable material LOD switching.
    pub material_lod_enabled: bool,
}

impl Default for PropLodConfig {
    fn default() -> Self {
        Self {
            shadow_cull_distance: PROP_SHADOW_CULL_DISTANCE,
            simple_material_distance: PROP_SIMPLE_MATERIAL_DISTANCE,
            hysteresis: PROP_LOD_MATERIAL_HYSTERESIS,
            update_interval: 0.2,
            shadow_culling_enabled: true,
            material_lod_enabled: false, // Disabled by default until shader is tested
        }
    }
}

/// Statistics for prop LOD system.
#[derive(Resource, Default)]
pub struct PropLodStats {
    pub props_with_shadows: usize,
    pub props_without_shadows: usize,
    pub props_simple_material: usize,
    pub props_full_material: usize,
    pub shadow_switches_this_frame: usize,
}

// =============================================================================
// Simple LOD Material
// =============================================================================

/// Uniform data for the simple LOD material.
#[derive(Clone, Copy, ShaderType, Debug)]
pub struct SimpleLodUniforms {
    /// Base color tint.
    pub base_color: LinearRgba,
    /// Fog start distance.
    pub fog_start: f32,
    /// Fog end distance.
    pub fog_end: f32,
    /// Ambient light contribution (0-1).
    pub ambient: f32,
    /// Padding for alignment.
    pub _padding: f32,
    /// Fog color.
    pub fog_color: LinearRgba,
}

impl Default for SimpleLodUniforms {
    fn default() -> Self {
        Self {
            base_color: LinearRgba::WHITE,
            fog_start: 80.0,
            fog_end: 300.0,
            ambient: 0.6, // Higher ambient since no proper lighting
            _padding: 0.0,
            fog_color: LinearRgba::new(0.7, 0.78, 0.88, 1.0),
        }
    }
}

/// Simple unlit material for distant props.
/// Only samples albedo texture, applies fog, no normal maps or PBR.
#[derive(Asset, TypePath, AsBindGroup, Clone, Debug)]
pub struct SimpleLodMaterial {
    #[uniform(0)]
    pub uniforms: SimpleLodUniforms,

    #[texture(1)]
    #[sampler(2)]
    pub albedo: Option<Handle<Image>>,
}

impl Default for SimpleLodMaterial {
    fn default() -> Self {
        Self {
            uniforms: SimpleLodUniforms::default(),
            albedo: None,
        }
    }
}

impl Material for SimpleLodMaterial {
    fn fragment_shader() -> ShaderRef {
        "shaders/simple_lod.wgsl".into()
    }

    fn alpha_mode(&self) -> AlphaMode {
        AlphaMode::Opaque
    }

    fn opaque_render_method(&self) -> OpaqueRendererMethod {
        OpaqueRendererMethod::Forward
    }
}

/// Resource holding the simple LOD material handle.
#[derive(Resource)]
pub struct SimpleLodMaterialHandle {
    pub handle: Handle<SimpleLodMaterial>,
}

// =============================================================================
// Components
// =============================================================================

/// Component tracking prop's current LOD state for shadows and materials.
#[derive(Component)]
pub struct PropLodState {
    /// Whether this prop currently has shadows disabled.
    pub shadows_disabled: bool,
    /// Whether this prop is using simplified material.
    pub using_simple_material: bool,
    /// Original material handle (for switching back).
    pub original_material: Option<Handle<StandardMaterial>>,
}

impl Default for PropLodState {
    fn default() -> Self {
        Self {
            shadows_disabled: false,
            using_simple_material: false,
            original_material: None,
        }
    }
}

// =============================================================================
// Systems
// =============================================================================

/// System to update prop shadow casting based on distance.
/// Adds NotShadowCaster to props beyond shadow_cull_distance.
pub fn update_prop_shadow_lod(
    time: Res<Time>,
    config: Res<PropLodConfig>,
    camera_query: Query<&GlobalTransform, With<PlayerCamera>>,
    mut commands: Commands,
    mut prop_query: Query<
        (Entity, &GlobalTransform, Option<&mut PropLodState>, Option<&NotShadowCaster>),
        With<Prop>,
    >,
    mut stats: ResMut<PropLodStats>,
    mut last_update: Local<f32>,
) {
    if !config.shadow_culling_enabled {
        return;
    }

    // Throttle updates
    let now = time.elapsed_secs();
    if now - *last_update < config.update_interval {
        return;
    }
    *last_update = now;

    let Ok(camera_transform) = camera_query.single() else {
        return;
    };
    let camera_pos = camera_transform.translation();

    let mut with_shadows = 0usize;
    let mut without_shadows = 0usize;
    let mut switches = 0usize;

    for (entity, transform, lod_state, has_no_shadow) in prop_query.iter_mut() {
        let prop_pos = transform.translation();
        let distance = camera_pos.distance(prop_pos);

        // Determine if shadows should be disabled with hysteresis
        let currently_no_shadow = has_no_shadow.is_some();
        let threshold = if currently_no_shadow {
            config.shadow_cull_distance - config.hysteresis
        } else {
            config.shadow_cull_distance + config.hysteresis
        };

        let should_disable_shadows = distance > threshold;

        if should_disable_shadows != currently_no_shadow {
            switches += 1;

            if should_disable_shadows {
                // Add NotShadowCaster
                commands.entity(entity).insert(NotShadowCaster);

                // Update LOD state if present
                if let Some(mut state) = lod_state {
                    state.shadows_disabled = true;
                }
            } else {
                // Remove NotShadowCaster
                commands.entity(entity).remove::<NotShadowCaster>();

                if let Some(mut state) = lod_state {
                    state.shadows_disabled = false;
                }
            }
        }

        if should_disable_shadows {
            without_shadows += 1;
        } else {
            with_shadows += 1;
        }
    }

    stats.props_with_shadows = with_shadows;
    stats.props_without_shadows = without_shadows;
    stats.shadow_switches_this_frame = switches;
}

/// System to initialize the simple LOD material on startup.
pub fn setup_simple_lod_material(
    mut commands: Commands,
    mut materials: ResMut<Assets<SimpleLodMaterial>>,
) {
    let material = materials.add(SimpleLodMaterial::default());
    commands.insert_resource(SimpleLodMaterialHandle { handle: material });
}
