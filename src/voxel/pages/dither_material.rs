//! Renderer-facing CLOD dither/crossfade contract.
//!
//! This mirrors the PoC dither material boundary without depending on Bevy's
//! material specialization yet.  The WGSL helper in
//! `assets/shaders/terrain/clod_dither.wgsl` uses the same role ids and the
//! same Bayer threshold policy as this module.

use super::crossfade::{ClodDitherRole, generate_dither_pattern};

pub const CLOD_DITHER_SIZE: usize = 16;
pub const CLOD_DITHER_ROLE_STABLE: u32 = 0;
pub const CLOD_DITHER_ROLE_FADE_IN: u32 = 1;
pub const CLOD_DITHER_ROLE_FADE_OUT: u32 = 2;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct ClodDitherUniformState {
    /// 0.0 means fully hidden by the dither mask; 1.0 means fully visible.
    pub fade_alpha: f32,
    /// Shader role id: 0 = stable, 1 = fade-in, 2 = fade-out.
    pub role: u32,
    /// Repeated Bayer pattern size in pixels.
    pub dither_size: f32,
}

impl ClodDitherUniformState {
    pub fn new(fade_alpha: f32, role: ClodDitherRole) -> Self {
        Self {
            fade_alpha: fade_alpha.clamp(0.0, 1.0),
            role: dither_role_to_shader_id(role),
            dither_size: CLOD_DITHER_SIZE as f32,
        }
    }

    pub fn stable() -> Self {
        Self::new(1.0, ClodDitherRole::Stable)
    }
}

pub fn dither_role_to_shader_id(role: ClodDitherRole) -> u32 {
    match role {
        ClodDitherRole::Stable => CLOD_DITHER_ROLE_STABLE,
        ClodDitherRole::FadeIn => CLOD_DITHER_ROLE_FADE_IN,
        ClodDitherRole::FadeOut => CLOD_DITHER_ROLE_FADE_OUT,
    }
}

pub fn shader_id_to_dither_role(role: u32) -> ClodDitherRole {
    match role {
        CLOD_DITHER_ROLE_FADE_IN => ClodDitherRole::FadeIn,
        CLOD_DITHER_ROLE_FADE_OUT => ClodDitherRole::FadeOut,
        _ => ClodDitherRole::Stable,
    }
}

/// Generate the canonical 16x16 tiled Bayer pattern used by the transition mask.
pub fn generate_clod_dither_pattern() -> Vec<u8> {
    generate_dither_pattern(CLOD_DITHER_SIZE)
}

/// Return a normalized threshold in `[0, 1)` for integer screen coordinates.
pub fn dither_threshold_at(screen_x: u32, screen_y: u32) -> f32 {
    let pattern = generate_clod_dither_pattern();
    let x = screen_x as usize % CLOD_DITHER_SIZE;
    let y = screen_y as usize % CLOD_DITHER_SIZE;
    pattern[y * CLOD_DITHER_SIZE + x] as f32 / 16.0
}

/// CPU equivalent of the WGSL clip decision.
///
/// `true` means the pixel remains visible. The policy keeps `fade_alpha` as a
/// literal visibility alpha for both fade-in and fade-out roles, while using
/// complementary masks so the old and new cuts do not reveal the same pixels
/// during a transition.
pub fn dither_pixel_visible(role: ClodDitherRole, fade_alpha: f32, threshold: f32) -> bool {
    let alpha = fade_alpha.clamp(0.0, 1.0);
    let threshold = threshold.clamp(0.0, 1.0);
    match role {
        ClodDitherRole::Stable => true,
        ClodDitherRole::FadeIn => threshold < alpha,
        ClodDitherRole::FadeOut => threshold >= 1.0 - alpha,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn role_ids_match_shader_contract() {
        assert_eq!(dither_role_to_shader_id(ClodDitherRole::Stable), 0);
        assert_eq!(dither_role_to_shader_id(ClodDitherRole::FadeIn), 1);
        assert_eq!(dither_role_to_shader_id(ClodDitherRole::FadeOut), 2);
        assert_eq!(shader_id_to_dither_role(99), ClodDitherRole::Stable);
    }

    #[test]
    fn canonical_pattern_is_sixteen_by_sixteen_and_tiled() {
        let pattern = generate_clod_dither_pattern();
        assert_eq!(pattern.len(), CLOD_DITHER_SIZE * CLOD_DITHER_SIZE);
        assert_eq!(pattern[0], 0);
        assert_eq!(pattern[1], 8);
        assert_eq!(pattern[4], 0);
        assert_eq!(pattern[16 * 4], 0);
    }

    #[test]
    fn stable_is_always_visible() {
        assert!(dither_pixel_visible(ClodDitherRole::Stable, 0.0, 0.95));
        assert!(dither_pixel_visible(ClodDitherRole::Stable, 1.0, 0.0));
    }

    #[test]
    fn fade_in_grows_visibility_with_alpha() {
        assert!(!dither_pixel_visible(ClodDitherRole::FadeIn, 0.0, 0.0));
        assert!(dither_pixel_visible(ClodDitherRole::FadeIn, 0.5, 0.25));
        assert!(!dither_pixel_visible(ClodDitherRole::FadeIn, 0.5, 0.75));
        assert!(dither_pixel_visible(ClodDitherRole::FadeIn, 1.0, 0.9375));
    }

    #[test]
    fn fade_out_shrinks_visibility_with_alpha() {
        assert!(dither_pixel_visible(ClodDitherRole::FadeOut, 1.0, 0.0));
        assert!(dither_pixel_visible(ClodDitherRole::FadeOut, 0.5, 0.75));
        assert!(!dither_pixel_visible(ClodDitherRole::FadeOut, 0.5, 0.25));
        assert!(!dither_pixel_visible(ClodDitherRole::FadeOut, 0.0, 0.9375));
    }
}
