use bevy::prelude::*;
use serde::{Deserialize, Serialize};

use crate::rendering::capabilities::GraphicsCapabilities;
#[cfg(feature = "naadf")]
use crate::rendering::naadf::{NaadfConfig, NaadfPreviewCompositeModeConfig};

pub(crate) const VOXEL_RAY_NOTICE_SECONDS: f64 = 4.0;
pub(crate) const NAADF_NOT_COMPILED_REASON: &str = "NAADF feature is not compiled in this build";
const NAADF_RESTART_HINT: &str =
    "Rebuild with default features; --no-default-features omits NAADF.";

#[cfg(feature = "naadf")]
const NAADF_FEATURE_COMPILED: bool = true;
#[cfg(not(feature = "naadf"))]
const NAADF_FEATURE_COMPILED: bool = false;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Reflect, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VoxelRayBackendMode {
    #[default]
    CurrentSdf,
    Naadf,
    Auto,
}

impl VoxelRayBackendMode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::CurrentSdf => "current_sdf",
            Self::Naadf => "naadf",
            Self::Auto => "auto",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "current_sdf" | "current-sdf" | "current" | "sdf" => Some(Self::CurrentSdf),
            "naadf" => Some(Self::Naadf),
            "auto" => Some(Self::Auto),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Reflect, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExperimentalRenderMode {
    #[default]
    Current,
    CurrentWithNaadfGi,
    NaadfPreview,
}

impl ExperimentalRenderMode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Current => "current",
            Self::CurrentWithNaadfGi => "current_with_naadf_gi",
            Self::NaadfPreview => "naadf_preview",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "current" => Some(Self::Current),
            "current_with_naadf_gi" | "current-with-naadf-gi" | "naadf_gi" | "naadf-gi" => {
                Some(Self::CurrentWithNaadfGi)
            }
            "naadf_preview" | "naadf-preview" | "preview" => Some(Self::NaadfPreview),
            _ => None,
        }
    }
}

/// Runtime switches for voxel ray backends. Defaults preserve the current renderer.
#[derive(Resource, Clone, Debug, Reflect, Serialize, Deserialize)]
#[reflect(Resource)]
pub struct RayTracingSettings {
    pub enabled: bool,
    pub voxel_backend: VoxelRayBackendMode,
    #[serde(default)]
    pub resolved_voxel_backend: VoxelRayBackendMode,
    pub experimental_mode: ExperimentalRenderMode,
    pub allow_naadf_on_integrated_gpu: bool,
    pub reset_history_on_backend_switch: bool,
    pub backend_switch_generation: u64,
    pub fallback_reason: Option<String>,
}

#[derive(Resource, Debug)]
pub(crate) struct VoxelRayBackendNotice {
    visible_until_secs: f64,
}

impl Default for VoxelRayBackendNotice {
    fn default() -> Self {
        Self {
            visible_until_secs: f64::NEG_INFINITY,
        }
    }
}

#[derive(Component)]
pub(crate) struct VoxelRayBackendNoticeText;

impl VoxelRayBackendNotice {
    pub(crate) fn show_for(&mut self, now_secs: f64, duration_secs: f64) {
        self.visible_until_secs = now_secs + duration_secs;
    }

    fn visible(&self, now_secs: f64) -> bool {
        now_secs < self.visible_until_secs
    }
}

impl Default for RayTracingSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            voxel_backend: VoxelRayBackendMode::CurrentSdf,
            resolved_voxel_backend: VoxelRayBackendMode::CurrentSdf,
            experimental_mode: ExperimentalRenderMode::Current,
            allow_naadf_on_integrated_gpu: false,
            reset_history_on_backend_switch: true,
            backend_switch_generation: 0,
            fallback_reason: None,
        }
    }
}

impl RayTracingSettings {
    pub fn from_env_or_default() -> Self {
        let requested = std::env::var("DRUSNIEL_NAADF").is_ok_and(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        });
        Self::with_naadf_env_request(requested)
    }

    fn with_naadf_env_request(naadf_requested: bool) -> Self {
        let mut settings = Self::default();
        if !naadf_requested {
            return settings;
        }
        if NAADF_FEATURE_COMPILED {
            settings.voxel_backend = VoxelRayBackendMode::Naadf;
            settings.resolved_voxel_backend = VoxelRayBackendMode::Naadf;
            settings.backend_switch_generation = 1;
        } else {
            settings.fallback_reason = Some(NAADF_NOT_COMPILED_REASON.into());
        }
        settings
    }

    pub fn set_voxel_backend(
        &mut self,
        next: VoxelRayBackendMode,
        capabilities: Option<&GraphicsCapabilities>,
    ) -> bool {
        if next == VoxelRayBackendMode::Naadf
            && !self.allow_naadf_on_integrated_gpu
            && capabilities.is_some_and(|capabilities| capabilities.integrated_gpu)
        {
            self.fallback_reason =
                Some("NAADF blocked on integrated GPU; enable explicit override to use it".into());
            return false;
        }

        self.fallback_reason = None;
        if self.voxel_backend == next {
            return false;
        }
        self.voxel_backend = next;
        self.resolved_voxel_backend = match next {
            VoxelRayBackendMode::Auto => VoxelRayBackendMode::CurrentSdf,
            mode => mode,
        };
        if self.reset_history_on_backend_switch {
            self.backend_switch_generation = self.backend_switch_generation.saturating_add(1);
        }
        true
    }

    pub fn effective_backend(&self) -> VoxelRayBackendMode {
        self.resolved_voxel_backend
    }

    pub fn resolve_naadf_cache_policy(
        &mut self,
        cache_ready: bool,
        cache_warming: bool,
        cache_stale: bool,
    ) {
        match self.voxel_backend {
            VoxelRayBackendMode::CurrentSdf => {
                self.resolved_voxel_backend = VoxelRayBackendMode::CurrentSdf;
                if self
                    .fallback_reason
                    .as_deref()
                    .is_some_and(is_naadf_cache_fallback)
                {
                    self.fallback_reason = None;
                }
            }
            VoxelRayBackendMode::Naadf | VoxelRayBackendMode::Auto => {
                if cache_ready && !cache_stale {
                    self.resolved_voxel_backend = VoxelRayBackendMode::Naadf;
                    if self
                        .fallback_reason
                        .as_deref()
                        .is_some_and(is_naadf_cache_fallback)
                    {
                        self.fallback_reason = None;
                    }
                } else {
                    self.resolved_voxel_backend = VoxelRayBackendMode::CurrentSdf;
                    self.fallback_reason = Some(if cache_stale {
                        "NAADF cache stale; using CurrentSdf fallback".into()
                    } else if cache_warming {
                        "NAADF cache warming; using CurrentSdf fallback".into()
                    } else {
                        "NAADF cache not ready; using CurrentSdf fallback".into()
                    });
                }
            }
        }
    }
}

fn is_naadf_cache_fallback(reason: &str) -> bool {
    reason.starts_with("NAADF cache ")
}

#[cfg(feature = "naadf")]
pub(crate) fn activate_naadf_preview(
    config: &mut NaadfConfig,
    settings: &mut RayTracingSettings,
    composite_mode: NaadfPreviewCompositeModeConfig,
) {
    config.enabled = true;
    config.debug.force_cpu_builder = true;
    config.preview.composite_mode = composite_mode;
    settings.experimental_mode = ExperimentalRenderMode::NaadfPreview;
}

pub(crate) fn toggle_voxel_ray_backend_key(
    keys: Res<ButtonInput<KeyCode>>,
    time: Res<Time>,
    capabilities: Option<Res<GraphicsCapabilities>>,
    mut settings: ResMut<RayTracingSettings>,
    mut notice: ResMut<VoxelRayBackendNotice>,
    #[cfg(feature = "naadf")] mut naadf_config: Option<ResMut<NaadfConfig>>,
) {
    let shift_held = keys.pressed(KeyCode::ShiftLeft) || keys.pressed(KeyCode::ShiftRight);
    let alt_held = keys.pressed(KeyCode::AltLeft) || keys.pressed(KeyCode::AltRight);
    let control_held = keys.pressed(KeyCode::ControlLeft) || keys.pressed(KeyCode::ControlRight);
    if !voxel_ray_backend_toggle_requested(
        shift_held,
        alt_held,
        control_held,
        keys.just_pressed(KeyCode::F11),
    ) {
        return;
    }

    if !NAADF_FEATURE_COMPILED {
        settings.fallback_reason = Some(NAADF_NOT_COMPILED_REASON.into());
        notice.show_for(time.elapsed_secs_f64(), VOXEL_RAY_NOTICE_SECONDS);
        warn!("Voxel ray backend unchanged: {}", NAADF_NOT_COMPILED_REASON);
        return;
    }

    #[cfg(not(feature = "naadf"))]
    let next = VoxelRayBackendMode::CurrentSdf;

    #[cfg(feature = "naadf")]
    let (next, activate_preview) = {
        let Some(config) = naadf_config.as_deref_mut() else {
            settings.fallback_reason = Some("NAADF config resource is unavailable".into());
            notice.show_for(time.elapsed_secs_f64(), VOXEL_RAY_NOTICE_SECONDS);
            warn!("Voxel ray backend unchanged: NAADF config resource is unavailable");
            return;
        };

        if settings.experimental_mode == ExperimentalRenderMode::NaadfPreview
            && settings.voxel_backend == VoxelRayBackendMode::Naadf
            && config.preview.composite_mode == NaadfPreviewCompositeModeConfig::Fullscreen
        {
            (VoxelRayBackendMode::CurrentSdf, false)
        } else {
            (VoxelRayBackendMode::Naadf, true)
        }
    };

    let previous_experimental_mode = settings.experimental_mode;
    let backend_changed = settings.set_voxel_backend(next, capabilities.as_deref());
    if let Some(reason) = settings.fallback_reason.as_deref() {
        notice.show_for(time.elapsed_secs_f64(), VOXEL_RAY_NOTICE_SECONDS);
        warn!("Voxel ray backend unchanged: {}", reason);
        return;
    }

    #[cfg(feature = "naadf")]
    {
        if let Some(config) = naadf_config.as_deref_mut() {
            if activate_preview {
                activate_naadf_preview(
                    config,
                    &mut settings,
                    NaadfPreviewCompositeModeConfig::Fullscreen,
                );
            } else {
                settings.experimental_mode = ExperimentalRenderMode::Current;
                config.enabled = false;
            }
        }
    }

    if !backend_changed
        && settings.reset_history_on_backend_switch
        && settings.experimental_mode != previous_experimental_mode
    {
        settings.backend_switch_generation = settings.backend_switch_generation.saturating_add(1);
    }

    if backend_changed || settings.experimental_mode == ExperimentalRenderMode::NaadfPreview {
        notice.show_for(time.elapsed_secs_f64(), VOXEL_RAY_NOTICE_SECONDS);
        info!(
            "Voxel ray backend requested: {}, effective: {}, mode: {}, fallback: {} (F11 toggles NAADF preview)",
            settings.voxel_backend.as_str(),
            settings.effective_backend().as_str(),
            settings.experimental_mode.as_str(),
            settings.fallback_reason.as_deref().unwrap_or("none")
        );
    }
}

fn voxel_ray_backend_toggle_requested(
    shift_held: bool,
    alt_held: bool,
    control_held: bool,
    f11_just_pressed: bool,
) -> bool {
    f11_just_pressed && !shift_held && !alt_held && !control_held
}

pub(crate) fn setup_voxel_ray_backend_notice(
    mut commands: Commands,
    time: Res<Time>,
    settings: Res<RayTracingSettings>,
    mut notice: ResMut<VoxelRayBackendNotice>,
) {
    if settings.voxel_backend != VoxelRayBackendMode::CurrentSdf
        || settings.fallback_reason.is_some()
    {
        notice.show_for(time.elapsed_secs_f64(), VOXEL_RAY_NOTICE_SECONDS);
    }

    commands.spawn((
        Text::new(""),
        TextFont {
            font_size: 14.0,
            ..default()
        },
        TextColor(Color::srgba(0.9, 0.98, 1.0, 0.95)),
        BackgroundColor(Color::srgba(0.0, 0.0, 0.0, 0.55)),
        Node {
            position_type: PositionType::Absolute,
            top: Val::Px(44.0),
            left: Val::Px(10.0),
            padding: UiRect::all(Val::Px(6.0)),
            ..default()
        },
        Visibility::Hidden,
        VoxelRayBackendNoticeText,
    ));
}

pub(crate) fn update_voxel_ray_backend_notice(
    time: Res<Time>,
    notice: Res<VoxelRayBackendNotice>,
    settings: Res<RayTracingSettings>,
    mut query: Query<(&mut Text, &mut Visibility), With<VoxelRayBackendNoticeText>>,
) {
    let visible = notice.visible(time.elapsed_secs_f64());
    for (mut text, mut visibility) in query.iter_mut() {
        if visible {
            let new_text = voxel_ray_backend_notice_text(&settings);
            if **text != new_text {
                **text = new_text;
            }
            if *visibility != Visibility::Visible {
                *visibility = Visibility::Visible;
            }
        } else if *visibility != Visibility::Hidden {
            *visibility = Visibility::Hidden;
        }
    }
}

fn voxel_ray_backend_notice_text(settings: &RayTracingSettings) -> String {
    let mut text = format!(
        "F11 voxel rays: requested {} / effective {}\nMode: {}",
        settings.voxel_backend.as_str(),
        settings.effective_backend().as_str(),
        settings.experimental_mode.as_str()
    );
    if let Some(reason) = settings.fallback_reason.as_deref() {
        text.push_str(&format!("\nFallback: {reason}"));
    }
    if !NAADF_FEATURE_COMPILED {
        text.push('\n');
        text.push_str(NAADF_RESTART_HINT);
    } else if settings.voxel_backend == VoxelRayBackendMode::Naadf {
        if settings.experimental_mode == ExperimentalRenderMode::NaadfPreview {
            text.push_str("\nNAADF fullscreen preview active.");
        } else {
            text.push_str("\nNAADF cache/backend selected; F11 opens fullscreen preview.");
        }
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn naadf_cache_policy_falls_back_while_warming() {
        let mut settings = RayTracingSettings {
            voxel_backend: VoxelRayBackendMode::Naadf,
            resolved_voxel_backend: VoxelRayBackendMode::Naadf,
            ..default()
        };

        settings.resolve_naadf_cache_policy(false, true, false);

        assert_eq!(
            settings.effective_backend(),
            VoxelRayBackendMode::CurrentSdf
        );
        assert_eq!(
            settings.fallback_reason.as_deref(),
            Some("NAADF cache warming; using CurrentSdf fallback")
        );
    }

    #[test]
    fn naadf_cache_policy_allows_ready_cache() {
        let mut settings = RayTracingSettings {
            voxel_backend: VoxelRayBackendMode::Auto,
            ..default()
        };

        settings.resolve_naadf_cache_policy(true, false, false);

        assert_eq!(settings.effective_backend(), VoxelRayBackendMode::Naadf);
        assert!(settings.fallback_reason.is_none());
    }

    #[test]
    fn naadf_cache_policy_falls_back_when_stale() {
        let mut settings = RayTracingSettings {
            voxel_backend: VoxelRayBackendMode::Naadf,
            resolved_voxel_backend: VoxelRayBackendMode::Naadf,
            ..default()
        };

        settings.resolve_naadf_cache_policy(true, false, true);

        assert_eq!(
            settings.effective_backend(),
            VoxelRayBackendMode::CurrentSdf
        );
        assert_eq!(
            settings.fallback_reason.as_deref(),
            Some("NAADF cache stale; using CurrentSdf fallback")
        );
    }

    #[test]
    fn notice_default_is_hidden_at_any_time() {
        let notice = VoxelRayBackendNotice::default();
        assert!(!notice.visible(0.0));
        assert!(!notice.visible(1_000_000.0));
    }

    #[test]
    fn notice_visible_within_window_only() {
        let mut notice = VoxelRayBackendNotice::default();
        notice.show_for(10.0, 4.0);
        assert!(notice.visible(10.0));
        assert!(notice.visible(13.999));
        // Strict-less makes the upper boundary the first hidden frame.
        assert!(!notice.visible(14.0));
        assert!(!notice.visible(14.001));
    }

    #[test]
    fn notice_text_reports_requested_and_effective_backend() {
        let settings = RayTracingSettings::default();
        let text = voxel_ray_backend_notice_text(&settings);
        assert!(text.contains("requested current_sdf"));
        assert!(text.contains("effective current_sdf"));
        assert!(text.contains("Mode: current"));
    }

    #[test]
    fn notice_text_includes_fallback_reason_when_present() {
        let settings = RayTracingSettings {
            fallback_reason: Some("test reason".into()),
            ..default()
        };
        let text = voxel_ray_backend_notice_text(&settings);
        assert!(text.contains("Fallback: test reason"));
    }

    #[test]
    fn voxel_ray_backend_toggle_requires_unmodified_f11() {
        assert!(voxel_ray_backend_toggle_requested(
            false, false, false, true
        ));
        assert!(!voxel_ray_backend_toggle_requested(
            false, true, false, true
        ));
        assert!(!voxel_ray_backend_toggle_requested(
            true, false, false, true
        ));
        assert!(!voxel_ray_backend_toggle_requested(
            false, false, true, true
        ));
        assert!(!voxel_ray_backend_toggle_requested(
            false, false, false, false
        ));
    }

    #[test]
    #[cfg(not(feature = "naadf"))]
    fn notice_text_includes_default_features_hint_when_feature_missing() {
        let settings = RayTracingSettings::default();
        let text = voxel_ray_backend_notice_text(&settings);
        assert!(text.contains("default features"));
    }

    #[test]
    #[cfg(not(feature = "naadf"))]
    fn naadf_env_request_records_fallback_when_feature_missing() {
        let settings = RayTracingSettings::with_naadf_env_request(true);
        assert_eq!(settings.voxel_backend, VoxelRayBackendMode::CurrentSdf);
        assert_eq!(
            settings.fallback_reason.as_deref(),
            Some(NAADF_NOT_COMPILED_REASON)
        );
    }

    #[test]
    #[cfg(feature = "naadf")]
    fn notice_text_includes_preview_status_when_naadf_selected() {
        let settings = RayTracingSettings {
            voxel_backend: VoxelRayBackendMode::Naadf,
            experimental_mode: ExperimentalRenderMode::NaadfPreview,
            ..default()
        };
        let text = voxel_ray_backend_notice_text(&settings);
        assert!(text.contains("fullscreen preview active"));
    }

    #[test]
    #[cfg(feature = "naadf")]
    fn activate_naadf_preview_forces_cpu_backed_visible_preview() {
        let mut config = NaadfConfig::default();
        let mut settings = RayTracingSettings::default();

        activate_naadf_preview(
            &mut config,
            &mut settings,
            NaadfPreviewCompositeModeConfig::SplitView,
        );

        assert!(config.enabled);
        assert!(config.debug.force_cpu_builder);
        assert_eq!(
            config.preview.composite_mode,
            NaadfPreviewCompositeModeConfig::SplitView
        );
        assert_eq!(
            settings.experimental_mode,
            ExperimentalRenderMode::NaadfPreview
        );
    }

    #[test]
    #[cfg(feature = "naadf")]
    fn naadf_env_request_selects_naadf_when_feature_present() {
        let settings = RayTracingSettings::with_naadf_env_request(true);
        assert_eq!(settings.voxel_backend, VoxelRayBackendMode::Naadf);
        assert_eq!(settings.resolved_voxel_backend, VoxelRayBackendMode::Naadf);
        assert!(settings.fallback_reason.is_none());
    }

    #[test]
    fn naadf_env_request_no_change_without_request() {
        let settings = RayTracingSettings::with_naadf_env_request(false);
        assert_eq!(settings.voxel_backend, VoxelRayBackendMode::CurrentSdf);
        assert!(settings.fallback_reason.is_none());
    }
}
