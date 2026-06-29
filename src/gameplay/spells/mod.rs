use bevy::asset::RenderAssetUsages;
use bevy::pbr::OpaqueRendererMethod;
use bevy::prelude::*;
use bevy::render::render_resource::{AsBindGroup, ShaderType};
use bevy_mesh::{Indices, PrimitiveTopology};
use bevy_shader::ShaderRef;
use serde::Deserialize;
use std::fs;
use std::path::Path;

use crate::audio::events::{AudioEventId, GameAudioEvent};
use crate::input::config::GameAction;
use crate::input::manager::{ActionState, update_action_state};

const SPELL_CONFIG_PATH: &str = "assets/config/spells.yaml";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SpellKind {
    Fire,
    Water,
    Air,
}

impl SpellKind {
    fn shader_id(self) -> f32 {
        match self {
            Self::Fire => 0.0,
            Self::Water => 1.0,
            Self::Air => 2.0,
        }
    }

    fn audio_event(self) -> AudioEventId {
        match self {
            Self::Fire => AudioEventId::SpellFireCast,
            Self::Water => AudioEventId::SpellWaterCast,
            Self::Air => AudioEventId::SpellAirCast,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct SpellConfigFile {
    pub spells: SpellConfig,
}

#[derive(Resource, Clone, Debug, Deserialize)]
pub struct SpellConfig {
    pub menu: SpellMenuConfig,
    pub fire: SpellEntryConfig,
    pub water: SpellEntryConfig,
    pub air: SpellEntryConfig,
}

#[derive(Clone, Debug, Deserialize)]
pub struct SpellMenuConfig {
    pub root_id: String,
    pub title: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct SpellEntryConfig {
    pub id: SpellKind,
    pub label: String,
    pub cast_duration_ms: u64,
    pub audio: SpellAudioConfig,
    pub vfx: SpellVfxConfig,
}

#[derive(Clone, Debug, Deserialize)]
pub struct SpellAudioConfig {
    pub volume: f32,
}

#[derive(Clone, Copy, Debug, Deserialize)]
pub struct SpellVfxConfig {
    pub flame_scale: f32,
    pub world_width: f32,
    pub world_height: f32,
    pub hand_forward_m: f32,
    pub hand_right_m: f32,
    pub hand_up_m: f32,
}

impl SpellConfig {
    pub fn load_or_default(path: impl AsRef<Path>) -> Self {
        fs::read_to_string(path)
            .ok()
            .and_then(|contents| serde_yaml::from_str::<SpellConfigFile>(&contents).ok())
            .map(|file| file.spells.clamped())
            .unwrap_or_else(Self::default)
    }

    pub fn entry(&self, kind: SpellKind) -> &SpellEntryConfig {
        match kind {
            SpellKind::Fire => &self.fire,
            SpellKind::Water => &self.water,
            SpellKind::Air => &self.air,
        }
    }

    fn clamped(mut self) -> Self {
        self.fire.clamp(SpellKind::Fire);
        self.water.clamp(SpellKind::Water);
        self.air.clamp(SpellKind::Air);
        self
    }
}

impl Default for SpellConfig {
    fn default() -> Self {
        Self {
            menu: SpellMenuConfig {
                root_id: "spell-menu".to_string(),
                title: "Spells".to_string(),
            },
            fire: SpellEntryConfig::new(SpellKind::Fire, "Fire", 2600, 0.38, 1.6, 5.0),
            water: SpellEntryConfig::new(SpellKind::Water, "Water", 2200, 0.34, 1.2, 4.5),
            air: SpellEntryConfig::new(SpellKind::Air, "Air", 1800, 0.28, 1.45, 5.4),
        }
    }
}

impl SpellEntryConfig {
    fn new(
        id: SpellKind,
        label: &str,
        cast_duration_ms: u64,
        volume: f32,
        world_width: f32,
        world_height: f32,
    ) -> Self {
        Self {
            id,
            label: label.to_string(),
            cast_duration_ms,
            audio: SpellAudioConfig { volume },
            vfx: SpellVfxConfig {
                flame_scale: 1.0,
                world_width,
                world_height,
                hand_forward_m: 0.5,
                hand_right_m: 0.35,
                hand_up_m: -0.35,
            },
        }
    }

    fn clamp(&mut self, expected_id: SpellKind) {
        self.id = expected_id;
        self.cast_duration_ms = self.cast_duration_ms.clamp(250, 8000);
        self.audio.volume = self.audio.volume.clamp(0.0, 1.0);
        self.vfx.flame_scale = self.vfx.flame_scale.clamp(0.25, 3.0);
        self.vfx.world_width = self.vfx.world_width.clamp(0.2, 20.0);
        self.vfx.world_height = self.vfx.world_height.clamp(0.2, 30.0);
        self.vfx.hand_forward_m = self.vfx.hand_forward_m.clamp(-5.0, 10.0);
        self.vfx.hand_right_m = self.vfx.hand_right_m.clamp(-5.0, 5.0);
        self.vfx.hand_up_m = self.vfx.hand_up_m.clamp(-5.0, 5.0);
    }
}

#[derive(Message, Clone, Copy, Debug)]
pub struct SpellCastEvent {
    pub kind: SpellKind,
}

#[derive(Resource, Default)]
pub struct SpellMenuState {
    pub visible: bool,
}

#[derive(Component)]
pub struct SpellBeam {
    pub kind: SpellKind,
    pub elapsed_secs: f32,
    pub duration_secs: f32,
    pub vfx: SpellVfxConfig,
}

#[derive(Clone, Copy, ShaderType, Debug)]
pub struct SpellBeamUniforms {
    /// x = spell kind, y = elapsed seconds, z = progress, w = opacity scale.
    pub params: Vec4,
}

impl Default for SpellBeamUniforms {
    fn default() -> Self {
        Self {
            params: Vec4::new(0.0, 0.0, 0.0, 1.0),
        }
    }
}

#[derive(Asset, TypePath, AsBindGroup, Clone, Debug)]
pub struct SpellBeamMaterial {
    #[uniform(0)]
    pub uniforms: SpellBeamUniforms,
}

impl Material for SpellBeamMaterial {
    fn fragment_shader() -> ShaderRef {
        "shaders/spell_beam.wgsl".into()
    }

    fn alpha_mode(&self) -> AlphaMode {
        AlphaMode::Blend
    }

    fn opaque_render_method(&self) -> OpaqueRendererMethod {
        OpaqueRendererMethod::Forward
    }
}

pub struct SpellPlugin;

impl Plugin for SpellPlugin {
    fn build(&self, app: &mut App) {
        app.insert_resource(SpellConfig::load_or_default(SPELL_CONFIG_PATH))
            .init_resource::<SpellMenuState>()
            .add_message::<SpellCastEvent>()
            .add_systems(Startup, setup_spell_mesh)
            .add_systems(
                Update,
                (
                    handle_spell_input.after(update_action_state),
                    cast_spell_events,
                    update_spell_beams,
                )
                    .chain(),
            );
    }
}

#[derive(Resource, Clone)]
struct SpellBeamMesh(pub Handle<Mesh>);

fn setup_spell_mesh(mut commands: Commands, mut meshes: ResMut<Assets<Mesh>>) {
    commands.insert_resource(SpellBeamMesh(meshes.add(create_spell_beam_mesh())));
}

fn handle_spell_input(
    action_state: Res<ActionState>,
    mut menu: ResMut<SpellMenuState>,
    mut casts: MessageWriter<SpellCastEvent>,
) {
    if action_state.just_pressed(GameAction::ToggleSpellMenu) {
        menu.visible = !menu.visible;
    }
    if action_state.just_pressed(GameAction::CastFire) {
        casts.write(SpellCastEvent {
            kind: SpellKind::Fire,
        });
    }
    if action_state.just_pressed(GameAction::CastWater) {
        casts.write(SpellCastEvent {
            kind: SpellKind::Water,
        });
    }
    if action_state.just_pressed(GameAction::CastAir) {
        casts.write(SpellCastEvent {
            kind: SpellKind::Air,
        });
    }
}

fn cast_spell_events(
    mut commands: Commands,
    config: Res<SpellConfig>,
    mesh: Res<SpellBeamMesh>,
    mut materials: ResMut<Assets<SpellBeamMaterial>>,
    mut casts: MessageReader<SpellCastEvent>,
    existing: Query<(Entity, &SpellBeam)>,
    mut audio_events: MessageWriter<GameAudioEvent>,
) {
    for cast in casts.read() {
        let entry = config.entry(cast.kind);
        for (entity, beam) in &existing {
            if beam.kind == cast.kind {
                commands.entity(entity).despawn();
            }
        }

        let material = materials.add(SpellBeamMaterial {
            uniforms: SpellBeamUniforms {
                params: Vec4::new(cast.kind.shader_id(), 0.0, 0.0, 1.0),
            },
        });
        let width = entry.vfx.world_width * entry.vfx.flame_scale;
        let height = entry.vfx.world_height * entry.vfx.flame_scale;

        commands.spawn((
            Name::new(format!("{} Spell Beam", entry.label)),
            Mesh3d(mesh.0.clone()),
            MeshMaterial3d(material),
            Transform::from_scale(Vec3::new(width, height, 1.0)),
            SpellBeam {
                kind: cast.kind,
                elapsed_secs: 0.0,
                duration_secs: (entry.cast_duration_ms as f32 / 1000.0).max(0.001),
                vfx: entry.vfx,
            },
        ));
        audio_events
            .write(GameAudioEvent::ui(cast.kind.audio_event()).with_strength(entry.audio.volume));
    }
}

fn update_spell_beams(
    mut commands: Commands,
    time: Res<Time>,
    camera: Query<&GlobalTransform, With<Camera3d>>,
    mut materials: ResMut<Assets<SpellBeamMaterial>>,
    mut beams: Query<(
        Entity,
        &mut Transform,
        &MeshMaterial3d<SpellBeamMaterial>,
        &mut SpellBeam,
    )>,
) {
    let Some(camera_transform) = camera.iter().next() else {
        return;
    };
    let pose = camera_transform.compute_transform();
    let camera_pos = pose.translation;
    let aim = pose.forward().as_vec3().normalize_or_zero();
    let world_up = Vec3::Y;
    let mut right = aim.cross(world_up);
    if right.length_squared() <= 1.0e-6 {
        right = Vec3::X;
    } else {
        right = right.normalize();
    }
    let cam_up = right.cross(aim).normalize_or_zero();

    for (entity, mut transform, material_handle, mut beam) in &mut beams {
        beam.elapsed_secs += time.delta_secs();
        let progress = beam.elapsed_secs / beam.duration_secs;
        if progress >= 1.0 {
            commands.entity(entity).despawn();
            continue;
        }

        let base = camera_pos
            + aim * beam.vfx.hand_forward_m
            + right * beam.vfx.hand_right_m
            + cam_up * beam.vfx.hand_up_m;
        transform.translation = base;
        transform.rotation = orient_spell_beam(base, aim, camera_pos);

        if let Some(material) = materials.get_mut(&material_handle.0) {
            material.uniforms.params = Vec4::new(
                beam.kind.shader_id(),
                beam.elapsed_secs,
                progress.clamp(0.0, 1.0),
                1.0,
            );
        }
    }
}

pub fn resolve_spell_pose(camera: &Transform, vfx: SpellVfxConfig) -> (Vec3, Vec3) {
    let aim = camera.forward().as_vec3().normalize_or_zero();
    let mut right = aim.cross(Vec3::Y);
    if right.length_squared() <= 1.0e-6 {
        right = Vec3::X;
    } else {
        right = right.normalize();
    }
    let cam_up = right.cross(aim).normalize_or_zero();
    let base = camera.translation
        + aim * vfx.hand_forward_m
        + right * vfx.hand_right_m
        + cam_up * vfx.hand_up_m;
    (base, aim)
}

pub fn orient_spell_beam(base: Vec3, dir: Vec3, camera_pos: Vec3) -> Quat {
    let y_axis = dir.normalize_or_zero();
    let mut z_axis = camera_pos - base;
    z_axis -= y_axis * z_axis.dot(y_axis);
    if z_axis.length_squared() < 1.0e-8 {
        z_axis = if y_axis.y.abs() < 0.99 {
            Vec3::Y
        } else {
            Vec3::X
        };
        z_axis -= y_axis * z_axis.dot(y_axis);
    }
    z_axis = z_axis.normalize_or_zero();
    let x_axis = y_axis.cross(z_axis).normalize_or_zero();
    let z_axis = x_axis.cross(y_axis).normalize_or_zero();
    Quat::from_mat3(&Mat3::from_cols(x_axis, y_axis, z_axis))
}

fn create_spell_beam_mesh() -> Mesh {
    Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::all())
        .with_inserted_attribute(
            Mesh::ATTRIBUTE_POSITION,
            vec![
                [-0.5, 0.0, 0.0],
                [0.5, 0.0, 0.0],
                [-0.5, 1.0, 0.0],
                [0.5, 1.0, 0.0],
            ],
        )
        .with_inserted_attribute(Mesh::ATTRIBUTE_NORMAL, vec![[0.0, 0.0, 1.0]; 4])
        .with_inserted_attribute(
            Mesh::ATTRIBUTE_UV_0,
            vec![[0.0, 0.0], [1.0, 0.0], [0.0, 1.0], [1.0, 1.0]],
        )
        .with_inserted_indices(Indices::U16(vec![0, 1, 3, 0, 3, 2]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn shipped_spell_config_parses_with_poc_values() {
        let config = SpellConfig::load_or_default(SPELL_CONFIG_PATH);
        assert_eq!(config.fire.id, SpellKind::Fire);
        assert_eq!(config.fire.cast_duration_ms, 2600);
        assert_eq!(config.water.cast_duration_ms, 2200);
        assert_eq!(config.air.cast_duration_ms, 1800);
        assert!((config.fire.vfx.world_width - 1.6).abs() < f32::EPSILON);
        assert!((config.air.vfx.world_height - 5.4).abs() < f32::EPSILON);
    }

    #[test]
    fn pose_uses_camera_hand_offsets() {
        let camera = Transform::from_xyz(1.0, 2.0, 3.0);
        let vfx = SpellVfxConfig {
            flame_scale: 1.0,
            world_width: 1.0,
            world_height: 1.0,
            hand_forward_m: 0.5,
            hand_right_m: 0.35,
            hand_up_m: -0.35,
        };
        let (base, dir) = resolve_spell_pose(&camera, vfx);
        assert!((dir - Vec3::NEG_Z).length() < 1.0e-5);
        assert!((base - Vec3::new(1.35, 1.65, 2.5)).length() < 1.0e-5);
    }

    #[test]
    fn cast_event_spawns_updates_and_expires_one_beam() {
        let mut app = App::new();
        app.add_plugins(MinimalPlugins)
            .add_message::<SpellCastEvent>()
            .add_message::<GameAudioEvent>()
            .insert_resource(SpellConfig::default())
            .init_resource::<Assets<Mesh>>()
            .init_resource::<Assets<SpellBeamMaterial>>();

        let mesh = {
            let mut meshes = app.world_mut().resource_mut::<Assets<Mesh>>();
            meshes.add(create_spell_beam_mesh())
        };
        app.insert_resource(SpellBeamMesh(mesh));
        app.world_mut().spawn((
            Camera3d::default(),
            Transform::from_xyz(0.0, 1.0, 5.0).looking_at(Vec3::ZERO, Vec3::Y),
        ));
        app.add_systems(Update, (cast_spell_events, update_spell_beams).chain());

        app.world_mut().write_message(SpellCastEvent {
            kind: SpellKind::Fire,
        });
        app.update();
        assert_eq!(
            app.world_mut()
                .query::<&SpellBeam>()
                .iter(app.world())
                .count(),
            1
        );

        app.world_mut()
            .resource_mut::<Time>()
            .advance_by(Duration::from_secs_f32(0.5));
        app.update();
        let beam = app
            .world_mut()
            .query::<&SpellBeam>()
            .iter(app.world())
            .next()
            .expect("beam should still be alive");
        assert!(beam.elapsed_secs > 0.0);

        {
            let world = app.world_mut();
            let mut query = world.query::<&mut SpellBeam>();
            for mut beam in query.iter_mut(world) {
                beam.elapsed_secs = 3.0;
            }
        }
        app.world_mut()
            .resource_mut::<Time>()
            .advance_by(Duration::from_secs_f32(0.1));
        app.update();
        assert_eq!(
            app.world_mut()
                .query::<&SpellBeam>()
                .iter(app.world())
                .count(),
            0
        );
    }
}
