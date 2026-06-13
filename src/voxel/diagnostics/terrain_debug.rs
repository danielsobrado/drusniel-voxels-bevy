//! Runtime terrain wireframe / normal-visualisation debug modes.

use crate::audio::events::{AudioEventId, GameAudioEvent};
use crate::camera::controller::PlayerCamera;
use crate::rendering::triplanar_material::{TerrainMaterialQuality, TriplanarMaterial};
use crate::voxel::chunk::LodLevel;
use crate::voxel::meshing::MeshSettings;
use crate::voxel::plugin::LodSettings;
use bevy::prelude::*;
use bevy::render::view::screenshot::{Screenshot, save_to_disk};
use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

const LOD_MATERIAL_SLOTS: usize = 4;

/// Live terrain mesh debug view toggles (wireframe overlay, normal-as-colour).
#[derive(Resource, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TerrainDebugView {
    pub wireframe: bool,
    pub normals: bool,
    pub iso_band: bool,
    pub flat_unlit: bool,
}

impl TerrainDebugView {
    pub fn active(self) -> bool {
        self.wireframe || self.normals || self.iso_band || self.flat_unlit
    }

    pub fn material_mode(self) -> TerrainDebugMaterialMode {
        if self.flat_unlit {
            return if self.wireframe {
                TerrainDebugMaterialMode::WireframeFlatUnlit
            } else {
                TerrainDebugMaterialMode::FlatUnlit
            };
        }
        match (self.wireframe, self.normals) {
            (true, true) => TerrainDebugMaterialMode::WireframeNormals,
            (true, false) => TerrainDebugMaterialMode::Wireframe,
            (false, true) => TerrainDebugMaterialMode::Normals,
            (false, false) => TerrainDebugMaterialMode::None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TerrainDebugMaterialMode {
    None,
    Wireframe,
    Normals,
    WireframeNormals,
    FlatUnlit,
    WireframeFlatUnlit,
}

impl TerrainDebugMaterialMode {
    pub fn base_quality(self) -> Option<TerrainMaterialQuality> {
        match self {
            Self::None => None,
            Self::Wireframe => Some(TerrainMaterialQuality::WireframeDebug),
            Self::Normals => Some(TerrainMaterialQuality::NormalsDebug),
            Self::WireframeNormals => Some(TerrainMaterialQuality::WireframeNormalsDebug),
            Self::FlatUnlit => Some(TerrainMaterialQuality::FlatUnlitDebug),
            Self::WireframeFlatUnlit => Some(TerrainMaterialQuality::WireframeFlatUnlitDebug),
        }
    }
}

/// Per-LOD triplanar handles for terrain debug modes.
#[derive(Resource, Clone, Debug)]
pub struct TerrainDebugMaterialHandles {
    wireframe: [Handle<TriplanarMaterial>; LOD_MATERIAL_SLOTS],
    normals: [Handle<TriplanarMaterial>; LOD_MATERIAL_SLOTS],
    wireframe_normals: [Handle<TriplanarMaterial>; LOD_MATERIAL_SLOTS],
    flat_unlit: [Handle<TriplanarMaterial>; LOD_MATERIAL_SLOTS],
    wireframe_flat_unlit: [Handle<TriplanarMaterial>; LOD_MATERIAL_SLOTS],
}

impl TerrainDebugMaterialHandles {
    pub fn from_base(
        _base: &Handle<TriplanarMaterial>,
        wireframe: &Handle<TriplanarMaterial>,
        normals: &Handle<TriplanarMaterial>,
        wireframe_normals: &Handle<TriplanarMaterial>,
        flat_unlit: &Handle<TriplanarMaterial>,
        wireframe_flat_unlit: &Handle<TriplanarMaterial>,
        iso_band_volume: &Handle<Image>,
        materials: &mut Assets<TriplanarMaterial>,
    ) -> Self {
        let mut clone_with_lod =
            |source: &Handle<TriplanarMaterial>, lod_index: u8| -> Handle<TriplanarMaterial> {
                let mut material = materials.get(source).cloned().unwrap_or_default();
                material.uniforms.weather_flags =
                    crate::rendering::triplanar_material::triplanar_weather_flags_with_debug_lod(
                        material.uniforms.weather_flags,
                        lod_index,
                    );
                material.iso_band_volume = Some(iso_band_volume.clone());
                materials.add(material)
            };

        Self {
            wireframe: std::array::from_fn(|lod| clone_with_lod(wireframe, lod as u8)),
            normals: std::array::from_fn(|lod| clone_with_lod(normals, lod as u8)),
            wireframe_normals: std::array::from_fn(|lod| {
                clone_with_lod(wireframe_normals, lod as u8)
            }),
            flat_unlit: std::array::from_fn(|lod| clone_with_lod(flat_unlit, lod as u8)),
            wireframe_flat_unlit: std::array::from_fn(|lod| {
                clone_with_lod(wireframe_flat_unlit, lod as u8)
            }),
        }
    }

    pub fn handle_for(
        &self,
        mode: TerrainDebugMaterialMode,
        lod: LodLevel,
    ) -> Option<Handle<TriplanarMaterial>> {
        let index = lod_debug_index(lod);
        match mode {
            TerrainDebugMaterialMode::None => None,
            TerrainDebugMaterialMode::Wireframe => Some(self.wireframe[index].clone()),
            TerrainDebugMaterialMode::Normals => Some(self.normals[index].clone()),
            TerrainDebugMaterialMode::WireframeNormals => {
                Some(self.wireframe_normals[index].clone())
            }
            TerrainDebugMaterialMode::FlatUnlit => Some(self.flat_unlit[index].clone()),
            TerrainDebugMaterialMode::WireframeFlatUnlit => {
                Some(self.wireframe_flat_unlit[index].clone())
            }
        }
    }

    pub fn all_handles(&self) -> impl Iterator<Item = &Handle<TriplanarMaterial>> {
        self.wireframe
            .iter()
            .chain(self.normals.iter())
            .chain(self.wireframe_normals.iter())
            .chain(self.flat_unlit.iter())
            .chain(self.wireframe_flat_unlit.iter())
    }
}

pub fn lod_debug_index(lod: LodLevel) -> usize {
    lod.wireframe_lod_index() as usize
}

pub fn terrain_debug_material_mode(
    terrain_debug: &TerrainDebugView,
    editor_wireframe: bool,
    forced_quality: Option<TerrainMaterialQuality>,
) -> TerrainDebugMaterialMode {
    if terrain_debug.active() {
        return terrain_debug.material_mode();
    }
    if editor_wireframe || forced_quality == Some(TerrainMaterialQuality::WireframeDebug) {
        return TerrainDebugMaterialMode::Wireframe;
    }
    TerrainDebugMaterialMode::None
}

#[derive(Component)]
pub(crate) struct TerrainDebugIndicator;

#[derive(Serialize)]
struct TerrainDebugCaptureSidecar {
    camera_pos: [f32; 3],
    camera_rot: [f32; 4],
    fov_degrees: f32,
    mode_flags: TerrainDebugCaptureModes,
    terrain_settings_hash: u64,
}

#[derive(Serialize)]
struct TerrainDebugCaptureModes {
    wireframe: bool,
    normals: bool,
    iso_band: bool,
    flat_unlit: bool,
    editor_wireframe: bool,
}

/// Transient on-screen confirmation that a terrain hole probe was written
/// (Shift+F9). `seconds_left` counts down; the indicator shows the file while > 0.
#[derive(Resource, Default)]
pub struct TerrainProbeNotice {
    pub seconds_left: f32,
    pub text: String,
}

impl TerrainProbeNotice {
    /// Show a "probe written" confirmation for a few seconds.
    pub fn notify(&mut self, text: impl Into<String>) {
        self.text = text.into();
        self.seconds_left = 5.0;
    }
}

pub fn setup_terrain_debug_indicator(mut commands: Commands) {
    commands.spawn((
        Text::new(""),
        TextFont {
            font_size: 16.0,
            ..default()
        },
        TextColor(Color::srgba(0.2, 1.0, 1.0, 0.95)),
        Node {
            position_type: PositionType::Absolute,
            top: Val::Px(10.0),
            right: Val::Px(10.0),
            ..default()
        },
        Visibility::Hidden,
        TerrainDebugIndicator,
    ));
}

pub fn toggle_terrain_debug_view(
    keyboard: Res<ButtonInput<KeyCode>>,
    mut terrain_debug: ResMut<TerrainDebugView>,
    mut audio_events: MessageWriter<GameAudioEvent>,
) {
    let alt_held = keyboard.pressed(KeyCode::AltLeft) || keyboard.pressed(KeyCode::AltRight);
    let shift_held = keyboard.pressed(KeyCode::ShiftLeft) || keyboard.pressed(KeyCode::ShiftRight);
    if !alt_held {
        return;
    }

    if wireframe_toggle_requested(shift_held, keyboard.just_pressed(KeyCode::F7)) {
        terrain_debug.wireframe = !terrain_debug.wireframe;
        info!(
            "Terrain wireframe debug: {} (Alt+F7)",
            if terrain_debug.wireframe { "ON" } else { "OFF" }
        );
        audio_events.write(GameAudioEvent::ui(AudioEventId::WireframeToggle));
    }

    if keyboard.just_pressed(KeyCode::F8) {
        terrain_debug.normals = !terrain_debug.normals;
        info!(
            "Terrain normal debug: {} (Alt+F8)",
            if terrain_debug.normals { "ON" } else { "OFF" }
        );
        if terrain_debug.normals {
            audio_events.write(GameAudioEvent::ui(AudioEventId::DebugToggleOn));
        } else {
            audio_events.write(GameAudioEvent::ui(AudioEventId::DebugToggleOff));
        }
    }

    if keyboard.just_pressed(KeyCode::F9) {
        terrain_debug.iso_band = !terrain_debug.iso_band;
        info!(
            "Terrain iso-band debug: {} (Alt+F9)",
            if terrain_debug.iso_band { "ON" } else { "OFF" }
        );
        if terrain_debug.iso_band {
            audio_events.write(GameAudioEvent::ui(AudioEventId::DebugToggleOn));
        } else {
            audio_events.write(GameAudioEvent::ui(AudioEventId::DebugToggleOff));
        }
    }

    if keyboard.just_pressed(KeyCode::F10) {
        terrain_debug.flat_unlit = !terrain_debug.flat_unlit;
        info!(
            "Terrain flat unlit debug: {} (Alt+F10)",
            if terrain_debug.flat_unlit {
                "ON"
            } else {
                "OFF"
            }
        );
        if terrain_debug.flat_unlit {
            audio_events.write(GameAudioEvent::ui(AudioEventId::DebugToggleOn));
        } else {
            audio_events.write(GameAudioEvent::ui(AudioEventId::DebugToggleOff));
        }
    }
}

/// Returns true when Alt+F7 should toggle wireframe (not Alt+Shift+F7 capture).
pub(crate) fn wireframe_toggle_requested(shift_held: bool, f7_just_pressed: bool) -> bool {
    !shift_held && f7_just_pressed
}

pub fn capture_terrain_debug_frame(
    mut commands: Commands,
    keyboard: Res<ButtonInput<KeyCode>>,
    terrain_debug: Res<TerrainDebugView>,
    runtime_debug: Option<Res<crate::runtime_commands::RuntimeViewportDebugState>>,
    mesh_settings: Res<MeshSettings>,
    lod_settings: Res<LodSettings>,
    camera_query: Query<(&Transform, &Projection), With<PlayerCamera>>,
) {
    let alt_held = keyboard.pressed(KeyCode::AltLeft) || keyboard.pressed(KeyCode::AltRight);
    let shift_held = keyboard.pressed(KeyCode::ShiftLeft) || keyboard.pressed(KeyCode::ShiftRight);
    if !(alt_held && shift_held && keyboard.just_pressed(KeyCode::F7)) {
        return;
    }

    let Ok((transform, projection)) = camera_query.single() else {
        warn!("Terrain debug capture skipped: no player camera");
        return;
    };

    let timestamp = timestamp_utc_compact();
    let output_dir = PathBuf::from("debug");
    if let Err(err) = std::fs::create_dir_all(&output_dir) {
        warn!("Failed to create debug output directory: {err}");
        return;
    }

    let stem = format!("wireframe-{timestamp}");
    let png_path = output_dir.join(format!("{stem}.png"));
    let json_path = output_dir.join(format!("{stem}.json"));

    let rotation = transform.rotation;
    let sidecar = TerrainDebugCaptureSidecar {
        camera_pos: transform.translation.to_array(),
        camera_rot: [rotation.x, rotation.y, rotation.z, rotation.w],
        fov_degrees: projection_fov_degrees(projection),
        mode_flags: TerrainDebugCaptureModes {
            wireframe: terrain_debug.wireframe,
            normals: terrain_debug.normals,
            iso_band: terrain_debug.iso_band,
            flat_unlit: terrain_debug.flat_unlit,
            editor_wireframe: runtime_debug.is_some_and(|state| state.wireframe),
        },
        terrain_settings_hash: terrain_settings_hash(&mesh_settings, &lod_settings),
    };

    match serde_json::to_string_pretty(&sidecar) {
        Ok(json) => {
            if let Err(err) = std::fs::write(&json_path, json) {
                warn!(
                    "Failed to write terrain debug sidecar {}: {err}",
                    json_path.display()
                );
            } else {
                info!("Terrain debug sidecar written to {}", json_path.display());
            }
        }
        Err(err) => warn!("Failed to serialize terrain debug sidecar: {err}"),
    }

    commands
        .spawn(Screenshot::primary_window())
        .observe(save_to_disk(png_path.clone()));
    info!("Terrain debug screenshot requested: {}", png_path.display());
}

pub(crate) fn update_terrain_debug_indicator(
    time: Res<Time>,
    terrain_debug: Res<TerrainDebugView>,
    lod_control: Res<crate::voxel::plugin::TerrainLodControl>,
    mut probe_notice: ResMut<TerrainProbeNotice>,
    mut query: Query<(&mut Text, &mut Visibility), With<TerrainDebugIndicator>>,
) {
    // Runs every frame: the probe-written toast decays on a timer, so we cannot
    // gate on change detection alone.
    if probe_notice.seconds_left > 0.0 {
        probe_notice.seconds_left = (probe_notice.seconds_left - time.delta_secs()).max(0.0);
    }
    let probe_text = (probe_notice.seconds_left > 0.0).then(|| probe_notice.text.clone());

    let label = terrain_debug_indicator_label(*terrain_debug, lod_control.freeze_lod, probe_text);
    for (mut text, mut visibility) in query.iter_mut() {
        if label.is_empty() {
            *visibility = Visibility::Hidden;
        } else {
            **text = label.clone();
            *visibility = Visibility::Visible;
        }
    }
}

fn terrain_debug_indicator_label(
    view: TerrainDebugView,
    lod_frozen: bool,
    probe_written: Option<String>,
) -> String {
    let mut lines = Vec::new();
    if lod_frozen {
        lines.push("LOD FROZEN (Alt+F6)".to_string());
    }
    if let Some(file) = probe_written {
        lines.push(format!("PROBE WRITTEN: {file}"));
    }
    let mut parts = Vec::new();
    if view.wireframe {
        parts.push("WIRE");
    }
    if view.normals {
        parts.push("NORMALS");
    }
    if view.iso_band {
        parts.push("ISO");
    }
    if view.flat_unlit {
        parts.push("FLAT");
    }
    if !parts.is_empty() {
        lines.push(format!("TERRAIN DEBUG: {} ON", parts.join(" + ")));
    }
    lines.join("\n")
}

fn projection_fov_degrees(projection: &Projection) -> f32 {
    match projection {
        Projection::Perspective(perspective) => perspective.fov.to_degrees(),
        Projection::Orthographic(orthographic) => {
            let height = orthographic.area.max.y - orthographic.area.min.y;
            if height <= f32::EPSILON {
                0.0
            } else {
                (2.0 * (0.5 * height).atan()).to_degrees()
            }
        }
        Projection::Custom(_) => 0.0,
    }
}

pub fn terrain_settings_hash(mesh_settings: &MeshSettings, lod_settings: &LodSettings) -> u64 {
    let mut hasher = DefaultHasher::new();
    format!("{:?}", mesh_settings.mode).hash(&mut hasher);
    format!("{:?}", mesh_settings.water_air_exposure_mode).hash(&mut hasher);
    lod_settings
        .high_detail_distance
        .to_bits()
        .hash(&mut hasher);
    lod_settings.cull_distance.to_bits().hash(&mut hasher);
    format!("{:?}", lod_settings.low_detail_mode).hash(&mut hasher);
    hasher.finish()
}

fn timestamp_utc_compact() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    format!("{seconds}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terrain_debug_material_mode_prefers_live_toggles() {
        let view = TerrainDebugView {
            wireframe: false,
            normals: true,
            iso_band: false,
            flat_unlit: false,
        };
        assert_eq!(
            terrain_debug_material_mode(&view, true, Some(TerrainMaterialQuality::WireframeDebug)),
            TerrainDebugMaterialMode::Normals
        );
    }

    #[test]
    fn terrain_debug_material_mode_falls_back_to_forced_wireframe() {
        let view = TerrainDebugView::default();
        assert_eq!(
            terrain_debug_material_mode(&view, false, Some(TerrainMaterialQuality::WireframeDebug)),
            TerrainDebugMaterialMode::Wireframe
        );
    }

    #[test]
    fn terrain_debug_material_mode_prefers_flat_unlit() {
        let view = TerrainDebugView {
            wireframe: true,
            normals: true,
            iso_band: false,
            flat_unlit: true,
        };
        assert_eq!(
            terrain_debug_material_mode(&view, false, None),
            TerrainDebugMaterialMode::WireframeFlatUnlit
        );
    }

    #[test]
    fn capture_shortcut_does_not_request_wireframe_toggle() {
        assert!(!wireframe_toggle_requested(true, true));
        assert!(wireframe_toggle_requested(false, true));
        assert!(!wireframe_toggle_requested(true, false));
    }
}
