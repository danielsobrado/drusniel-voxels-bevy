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
            cycle_enabled: true,
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
}

#[derive(Component)]
pub(crate) struct GraphicsTabContent;

#[derive(Component)]
pub(crate) struct GameplayTabContent;

#[derive(Component)]
pub(crate) struct AtmosphereTabContent;

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
