//! CLOD page fade material bridge.
//!
//! `crossfade_runtime` writes renderer-neutral `ClodPageFade` components. This
//! system maps them into per-page `TriplanarMaterial` uniforms and enables the
//! `TERRAIN_CLOD_DITHER` shader specialization only when the material fade path
//! is explicitly enabled.

use bevy::prelude::*;

use crate::rendering::triplanar_material::TriplanarMaterial;

use super::crossfade::ClodDitherRole;
use super::crossfade_runtime::ClodPageFade;
use super::dither_material::{ClodDitherUniformState, dither_role_to_shader_id};

#[derive(Resource, Clone, Debug)]
pub(crate) struct ClodFadeMaterialSettings {
    pub enabled: bool,
}

impl Default for ClodFadeMaterialSettings {
    fn default() -> Self {
        Self {
            enabled: env_flag("VOXEL_CLOD_CROSSFADE_MATERIAL"),
        }
    }
}

pub(crate) fn clod_page_fade_material_system(
    settings: Res<ClodFadeMaterialSettings>,
    mut materials: ResMut<Assets<TriplanarMaterial>>,
    pages: Query<(&MeshMaterial3d<TriplanarMaterial>, Option<&ClodPageFade>)>,
) {
    for (material_handle, fade) in pages.iter() {
        let Some(material) = materials.get_mut(&material_handle.0) else {
            continue;
        };

        let state = material_state_for_page(fade.copied(), settings.enabled);
        material.uniforms.clod_fade = state.fade_alpha;
        material.clod_page_dither =
            settings.enabled && state.role != dither_role_to_shader_id(ClodDitherRole::Stable);
    }
}

pub(crate) fn material_state_for_page(
    fade: Option<ClodPageFade>,
    material_crossfade_enabled: bool,
) -> ClodDitherUniformState {
    if !material_crossfade_enabled {
        return ClodDitherUniformState::stable();
    }

    let Some(fade) = fade else {
        return ClodDitherUniformState::stable();
    };

    ClodDitherUniformState::new(fade.alpha, fade.role)
}

fn env_flag(name: &str) -> bool {
    std::env::var(name).ok().is_some_and(|value| {
        matches!(
            value.trim(),
            "1" | "true" | "TRUE" | "yes" | "YES" | "on" | "ON"
        )
    })
}

#[cfg(test)]
mod tests {
    use super::super::dither_material::{
        CLOD_DITHER_ROLE_FADE_IN, CLOD_DITHER_ROLE_FADE_OUT, CLOD_DITHER_ROLE_STABLE,
    };
    use super::*;

    #[test]
    fn disabled_material_path_forces_stable_visibility() {
        let state = material_state_for_page(
            Some(ClodPageFade {
                alpha: 0.25,
                role: ClodDitherRole::FadeIn,
            }),
            false,
        );

        assert_eq!(state.fade_alpha, 1.0);
        assert_eq!(state.role, CLOD_DITHER_ROLE_STABLE);
    }

    #[test]
    fn missing_fade_component_is_stable_visible() {
        let state = material_state_for_page(None, true);
        assert_eq!(state.fade_alpha, 1.0);
        assert_eq!(state.role, CLOD_DITHER_ROLE_STABLE);
    }

    #[test]
    fn fade_component_maps_to_uniform_state() {
        let fade_in = material_state_for_page(
            Some(ClodPageFade {
                alpha: 0.35,
                role: ClodDitherRole::FadeIn,
            }),
            true,
        );
        assert_eq!(fade_in.fade_alpha, 0.35);
        assert_eq!(fade_in.role, CLOD_DITHER_ROLE_FADE_IN);

        let fade_out = material_state_for_page(
            Some(ClodPageFade {
                alpha: 0.65,
                role: ClodDitherRole::FadeOut,
            }),
            true,
        );
        assert_eq!(fade_out.fade_alpha, 0.65);
        assert_eq!(fade_out.role, CLOD_DITHER_ROLE_FADE_OUT);
    }
}
