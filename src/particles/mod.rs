use bevy::prelude::*;
use bevy_hanabi::prelude::*;

pub mod weather;

pub use weather::{WeatherConfig, WeatherState, WeatherType, set_weather, set_wind};

pub struct ParticlePlugin;

#[derive(Resource)]
pub struct ParticleRegistry {
    pub dig_effect: Handle<EffectAsset>,
}

#[derive(Message, Debug, Clone)]
pub struct SpawnParticleEvent {
    pub position: Vec3,
    pub particle_type: ParticleType,
}

#[derive(Debug, Clone)]
pub enum ParticleType {
    Dig,
}

impl Plugin for ParticlePlugin {
    fn build(&self, app: &mut App) {
        if !app.is_plugin_added::<HanabiPlugin>() {
            app.add_plugins(HanabiPlugin);
        }

        app.add_message::<SpawnParticleEvent>()
            .add_systems(Startup, setup_particles)
            .add_systems(Update, (handle_particle_events, despawn_finished_effects));
    }
}

fn setup_particles(mut commands: Commands, mut effects: ResMut<Assets<EffectAsset>>) {
    let handle = create_dig_effect(&mut effects);

    commands.insert_resource(ParticleRegistry { dig_effect: handle });
}

fn create_dig_effect(effects: &mut Assets<EffectAsset>) -> Handle<EffectAsset> {
    let mut color_gradient = bevy_hanabi::Gradient::new();
    color_gradient.add_key(0.0, Vec4::new(1.7, 1.25, 0.75, 1.0));
    color_gradient.add_key(0.35, Vec4::new(0.85, 0.62, 0.38, 0.9));
    color_gradient.add_key(0.8, Vec4::new(0.28, 0.24, 0.22, 0.35));
    color_gradient.add_key(1.0, Vec4::new(0.18, 0.16, 0.14, 0.0));

    let mut size_gradient = bevy_hanabi::Gradient::new();
    size_gradient.add_key(0.0, Vec3::splat(0.045));
    size_gradient.add_key(0.35, Vec3::splat(0.075));
    size_gradient.add_key(1.0, Vec3::splat(0.015));

    let writer = ExprWriter::new();

    let init_lifetime = SetAttributeModifier::new(Attribute::LIFETIME, writer.lit(0.75).expr());
    let init_pos = SetPositionSphereModifier {
        center: writer.lit(Vec3::ZERO).expr(),
        radius: writer.lit(0.08).expr(),
        dimension: ShapeDimension::Volume,
    };
    let init_vel = SetVelocitySphereModifier {
        center: writer.lit(Vec3::new(0.0, 1.25, 0.0)).expr(),
        speed: writer.lit(2.2).expr(),
    };

    let gravity = writer.lit(Vec3::new(0.0, -4.5, 0.0)).expr();
    let drag = writer.lit(1.4).expr();

    let effect = EffectAsset::new(256, SpawnerSettings::once(28.0.into()), writer.finish())
        .with_name("dig_burst")
        .with_simulation_space(SimulationSpace::Global)
        .init(init_lifetime)
        .init(init_pos)
        .init(init_vel)
        .update(AccelModifier::new(gravity))
        .update(LinearDragModifier::new(drag))
        .render(ColorOverLifetimeModifier::new(color_gradient))
        .render(SizeOverLifetimeModifier {
            gradient: size_gradient,
            screen_space_size: false,
        })
        .render(OrientModifier::new(OrientMode::FaceCameraPosition));

    effects.add(effect)
}

fn handle_particle_events(
    mut commands: Commands,
    registry: Res<ParticleRegistry>,
    mut events: MessageReader<SpawnParticleEvent>,
) {
    for event in events.read() {
        match event.particle_type {
            ParticleType::Dig => {
                commands.spawn((
                    Name::new("Dig Particle Effect"),
                    ParticleEffect::new(registry.dig_effect.clone()),
                    Transform::from_translation(event.position),
                    AutoDespawnEffect {
                        timer: Timer::from_seconds(1.25, TimerMode::Once),
                    },
                ));
            }
        }
    }
}

#[derive(Component)]
struct AutoDespawnEffect {
    timer: Timer,
}

fn despawn_finished_effects(
    mut commands: Commands,
    time: Res<Time>,
    mut query: Query<(Entity, &mut AutoDespawnEffect, Option<&EffectSpawner>)>,
) {
    for (entity, mut auto_despawn, spawner) in query.iter_mut() {
        if spawner.is_some_and(|spawner| !spawner.has_completed()) {
            continue;
        }

        auto_despawn.timer.tick(time.delta());
        if auto_despawn.timer.is_finished() {
            commands.entity(entity).despawn();
        }
    }
}
