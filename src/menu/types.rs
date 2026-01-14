//! Menu system types, components, and resources

use bevy::prelude::*;
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex};

// ============================================================================
// Multiplayer Types
// ============================================================================

#[derive(Resource, Default, Clone)]
pub struct FavoriteServer {
    pub ip: String,
    pub port: String,
    pub password: String,
}

#[derive(Resource, Default)]
pub struct MultiplayerFormState {
    pub host_password: String,
    pub join_ip: String,
    pub join_port: String,
    pub join_password: String,
    pub favorites: Vec<FavoriteServer>,
    pub active_field: Option<MultiplayerField>,
}

#[derive(Resource, Default)]
pub(crate) struct ConnectTaskState {
    pub receiver: Option<Arc<Mutex<Receiver<ConnectOutcome>>>>,
}

pub(crate) enum ConnectOutcome {
    Success {
        ip: String,
        port: String,
        address: String,
        latency_ms: u128,
    },
    Failure {
        message: String,
    },
}

#[derive(Component, Copy, Clone, Eq, PartialEq)]
pub enum MultiplayerField {
    HostPassword,
    JoinIp,
    JoinPort,
    JoinPassword,
}

#[derive(Component, Copy, Clone)]
pub(crate) struct InputField {
    pub field: MultiplayerField,
}

#[derive(Component, Copy, Clone)]
pub(crate) struct InputText {
    pub field: MultiplayerField,
}

#[derive(Component)]
pub(crate) struct FavoritesList;

#[derive(Component, Copy, Clone)]
pub(crate) struct FavoriteButton(pub usize);

// ============================================================================
// Pause Menu Types
// ============================================================================

#[derive(Resource)]
pub struct PauseMenuState {
    pub open: bool,
    pub root_entity: Option<Entity>,
    pub current_screen: MenuScreen,
}

impl Default for PauseMenuState {
    fn default() -> Self {
        Self {
            open: false,
            root_entity: None,
            current_screen: MenuScreen::Main,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum MenuScreen {
    Main,
    Multiplayer,
}

#[derive(Component)]
pub(crate) struct PauseMenuRoot;

#[derive(Component, Copy, Clone)]
pub(crate) enum PauseMenuButton {
    Save,
    Load,
    Settings,
    Multiplayer,
    StartServer,
    Connect,
    SaveFavorite,
    BackToMain,
    Resume,
}

// ============================================================================
// Settings Types
// ============================================================================

#[derive(Resource, Clone)]
pub struct SettingsState {
    pub dialog_root: Option<Entity>,
    pub active_tab: SettingsTab,
    pub graphics_quality: GraphicsQuality,
    pub anti_aliasing: AntiAliasing,
    pub ray_tracing: bool,
    pub display_mode: DisplayMode,
    pub resolution: UVec2,
    pub day_length: DayLengthOption,
    pub time_scale: TimeScaleOption,
    pub rayleigh: RayleighOption,
    pub mie: MieOption,
    pub mie_direction: MieDirectionOption,
    pub exposure: ExposureOption,
    pub twilight_band: TwilightBandOption,
    pub night_brightness: NightBrightnessOption,
    pub fog_preset: FogPresetOption,
    pub cycle_enabled: bool,
    pub shadow_filtering: ShadowFiltering,
    pub walk_speed: WalkSpeedPreset,
    pub run_speed: RunSpeedPreset,
    pub jump_height: JumpHeightPreset,
    pub float_height: FloatHeightPreset,
}

impl Default for SettingsState {
    fn default() -> Self {
        Self {
            dialog_root: None,
            active_tab: SettingsTab::Graphics,
            graphics_quality: GraphicsQuality::Medium,
            anti_aliasing: AntiAliasing::Fxaa,
            ray_tracing: false,
            display_mode: DisplayMode::Bordered,
            resolution: UVec2::new(1920, 1080),
            day_length: DayLengthOption::Standard,
            time_scale: TimeScaleOption::RealTime,
            rayleigh: RayleighOption::Balanced,
            mie: MieOption::Standard,
            mie_direction: MieDirectionOption::Standard,
            exposure: ExposureOption::Neutral,
            twilight_band: TwilightBandOption::Medium,
            night_brightness: NightBrightnessOption::Balanced,
            fog_preset: FogPresetOption::Balanced,
            cycle_enabled: false,
            shadow_filtering: ShadowFiltering::Gaussian,
            walk_speed: WalkSpeedPreset::Standard,
            run_speed: RunSpeedPreset::Standard,
            jump_height: JumpHeightPreset::Standard,
            float_height: FloatHeightPreset::Standard,
        }
    }
}

#[derive(Component, Copy, Clone, Eq, PartialEq)]
pub enum ShadowFiltering {
    Gaussian,
    Hardware2x2,
    Temporal,
}

#[derive(Component, Copy, Clone, Eq, PartialEq)]
pub(crate) struct ShadowFilteringOption(pub ShadowFiltering);

#[derive(Component, Copy, Clone, Eq, PartialEq)]
pub(crate) struct DayNightCycleOption(pub bool);

#[derive(Component, Copy, Clone, Eq, PartialEq)]
pub(crate) struct PlayerWalkSpeedOption(pub WalkSpeedPreset);

#[derive(Component, Copy, Clone, Eq, PartialEq)]
pub(crate) struct PlayerRunSpeedOption(pub RunSpeedPreset);

#[derive(Component, Copy, Clone, Eq, PartialEq)]
pub(crate) struct PlayerJumpHeightOption(pub JumpHeightPreset);

#[derive(Component, Copy, Clone, Eq, PartialEq)]
pub(crate) struct PlayerFloatHeightOption(pub FloatHeightPreset);

#[derive(Component, Copy, Clone)]
pub(crate) enum SettingsTabButton {
    Graphics,
    Gameplay,
    Atmosphere,
    Fog,
    Visual,
}

#[derive(Component)]
pub(crate) struct SettingsDialogRoot;

#[derive(Component, Copy, Clone)]
pub(crate) struct GraphicsQualityOption(pub GraphicsQuality);

#[derive(Component, Copy, Clone)]
pub(crate) struct AntiAliasingOption(pub AntiAliasing);

#[derive(Component, Copy, Clone, Eq, PartialEq)]
pub(crate) struct RayTracingOption(pub bool);

#[derive(Component, Copy, Clone, Eq, PartialEq)]
pub(crate) enum DisplayModeOption {
    Bordered,
    Borderless,
    Fullscreen,
}

#[derive(Component, Copy, Clone, Eq, PartialEq)]
pub(crate) struct ResolutionOption(pub UVec2);

#[derive(Component)]
pub(crate) struct CloseSettingsButton;

#[derive(Component, Copy, Clone, Eq, PartialEq)]
pub enum SettingsTab {
    Graphics,
    Gameplay,
    Atmosphere,
    Fog,
    Visual,
}

#[derive(Component)]
pub(crate) struct GraphicsTabContent;

#[derive(Component)]
pub(crate) struct GameplayTabContent;

#[derive(Component)]
pub(crate) struct AtmosphereTabContent;

#[derive(Component)]
pub(crate) struct FogTabContent;

#[derive(Component)]
pub(crate) struct VisualTabContent;

#[derive(Component, Copy, Clone, Eq, PartialEq)]
pub enum GraphicsQuality {
    Low,
    Medium,
    High,
}

#[derive(Component, Copy, Clone, Eq, PartialEq)]
pub enum AntiAliasing {
    None,
    Fxaa,
    Msaa4x,
    /// Temporal Anti-Aliasing with Contrast Adaptive Sharpening to counter blur
    Taa,
}

#[derive(Component, Copy, Clone, Eq, PartialEq)]
pub enum DisplayMode {
    Bordered,
    Borderless,
    Fullscreen,
}

#[derive(Component, Copy, Clone, Eq, PartialEq)]
pub enum DayLengthOption {
    Short,
    Standard,
    Long,
}

#[derive(Component, Copy, Clone, Eq, PartialEq)]
pub enum TimeScaleOption {
    Slow,
    RealTime,
    Fast,
}

#[derive(Component, Copy, Clone, Eq, PartialEq)]
pub enum RayleighOption {
    Gentle,
    Balanced,
    Vivid,
}

#[derive(Component, Copy, Clone, Eq, PartialEq)]
pub enum MieOption {
    Soft,
    Standard,
    Dense,
}

#[derive(Component, Copy, Clone, Eq, PartialEq)]
pub enum MieDirectionOption {
    Broad,
    Standard,
    Forward,
}

#[derive(Component, Copy, Clone, Eq, PartialEq)]
pub enum ExposureOption {
    Low,
    Neutral,
    High,
}

#[derive(Component, Copy, Clone, Eq, PartialEq)]
pub enum TwilightBandOption {
    Narrow,
    Medium,
    Wide,
}

#[derive(Component, Copy, Clone, Eq, PartialEq)]
pub enum NightBrightnessOption {
    Dim,
    Balanced,
    Bright,
}

#[derive(Component, Copy, Clone, Eq, PartialEq)]
pub enum FogPresetOption {
    Clear,
    Balanced,
    Misty,
}

#[derive(Component, Copy, Clone, Eq, PartialEq)]
pub(crate) struct DistanceFogOption(pub bool);

#[derive(Component, Copy, Clone, Eq, PartialEq)]
pub(crate) struct VolumetricFogOption(pub bool);

#[derive(Component, Copy, Clone, Eq, PartialEq)]
pub enum WalkSpeedPreset {
    Slow,
    Standard,
    Fast,
}

impl WalkSpeedPreset {
    pub fn value(self) -> f32 {
        match self {
            WalkSpeedPreset::Slow => 4.0,
            WalkSpeedPreset::Standard => 6.0,
            WalkSpeedPreset::Fast => 8.0,
        }
    }
}

#[derive(Component, Copy, Clone, Eq, PartialEq)]
pub enum RunSpeedPreset {
    Slow,
    Standard,
    Fast,
}

impl RunSpeedPreset {
    pub fn value(self) -> f32 {
        match self {
            RunSpeedPreset::Slow => 9.0,
            RunSpeedPreset::Standard => 12.0,
            RunSpeedPreset::Fast => 16.0,
        }
    }
}

#[derive(Component, Copy, Clone, Eq, PartialEq)]
pub enum JumpHeightPreset {
    Low,
    Standard,
    High,
}

impl JumpHeightPreset {
    pub fn value(self) -> f32 {
        match self {
            JumpHeightPreset::Low => 1.5,
            JumpHeightPreset::Standard => 2.0,
            JumpHeightPreset::High => 2.6,
        }
    }
}

#[derive(Component, Copy, Clone, Eq, PartialEq)]
pub enum FloatHeightPreset {
    Low,
    Standard,
    High,
}

impl FloatHeightPreset {
    pub fn value(self) -> f32 {
        match self {
            FloatHeightPreset::Low => 1.2,
            FloatHeightPreset::Standard => 1.5,
            FloatHeightPreset::High => 1.8,
        }
    }
}

// ============================================================================
// Visual Settings Types
// ============================================================================

/// Resource for visual/color grading settings that can be adjusted at runtime
#[derive(Resource, Clone)]
pub struct VisualSettings {
    /// Color temperature (-0.5 to 0.5, 0 = neutral)
    pub temperature: f32,
    /// Color saturation (0.5 to 2.0, 1.0 = normal)
    pub saturation: f32,
    /// Exposure adjustment (-1.0 to 1.0, 0 = neutral)
    pub exposure: f32,
    /// Midtones gamma (0.5 to 1.5, 1.0 = normal)
    pub gamma: f32,
    /// Highlights gain (0.5 to 1.5, 1.0 = normal)
    pub highlights_gain: f32,
    /// Sun warmth (0.0 to 1.0, affects sun color)
    pub sun_warmth: f32,
    /// Sun illuminance (5000 to 50000 lux)
    pub illuminance: f32,
    /// Skybox brightness (1000 to 10000)
    pub skybox_brightness: f32,
}

impl Default for VisualSettings {
    fn default() -> Self {
        Self {
            temperature: 0.0,
            saturation: 1.15,
            exposure: -0.2,
            gamma: 0.95,
            highlights_gain: 0.9,
            sun_warmth: 0.05,
            illuminance: 20_000.0,
            skybox_brightness: 4000.0,
        }
    }
}

/// Component marker for visual setting sliders
#[derive(Component, Copy, Clone, Eq, PartialEq)]
pub enum VisualSlider {
    Temperature,
    Saturation,
    Exposure,
    Gamma,
    HighlightsGain,
    SunWarmth,
    Illuminance,
    SkyboxBrightness,
}

/// Component for slider value text display
#[derive(Component)]
pub struct SliderValueText(pub VisualSlider);

/// Component for the slider track (the clickable background)
#[derive(Component)]
pub struct SliderTrack(pub VisualSlider);

/// Component for the slider fill (the colored portion)
#[derive(Component)]
pub struct SliderFill(pub VisualSlider);

// ============================================================================
// Fog Settings Types
// ============================================================================

/// Component marker for fog setting sliders
#[derive(Component, Copy, Clone, Eq, PartialEq)]
pub enum FogSlider {
    Visibility,
    VolumeDensity,
    VolumeScattering,
    VolumeAbsorption,
    ScatteringAsymmetry,
    VolumeSize,
    StepCount,
    Jitter,
    AmbientIntensity,
}

/// Component for fog slider value text display
#[derive(Component)]
pub struct FogSliderValueText(pub FogSlider);

/// Component for the fog slider track (the clickable background)
#[derive(Component)]
pub struct FogSliderTrack(pub FogSlider);

/// Component for the fog slider fill (the colored portion)
#[derive(Component)]
pub struct FogSliderFill(pub FogSlider);
