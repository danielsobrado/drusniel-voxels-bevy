use super::config::{AudioEventsConfig, AudioSettings};
use super::events::{AudioEventId, GameAudioEvent};
use super::throttle::AudioThrottle;
use bevy::audio::{AudioPlayer, PlaybackSettings, Volume};
use bevy::prelude::*;
use std::collections::HashSet;

#[derive(Resource, Default)]
pub struct MissingAssetsTracker {
    pub warned_assets: HashSet<String>,
    pub warned_events: HashSet<AudioEventId>,
}

pub fn play_audio_events_system(
    mut commands: Commands,
    mut events: MessageReader<GameAudioEvent>,
    asset_server: Option<Res<AssetServer>>,
    audio_settings: Res<AudioSettings>,
    config: Res<AudioEventsConfig>,
    mut throttle: ResMut<AudioThrottle>,
    mut tracker: ResMut<MissingAssetsTracker>,
) {
    if !audio_settings.enabled {
        return;
    }

    let Some(asset_server) = asset_server else {
        return;
    };

    for event in events.read() {
        let Some(event_cfg) = config.events.get(&event.id) else {
            if tracker.warned_events.insert(event.id) {
                warn!("Missing audio configuration for event {:?}", event.id);
            }
            continue;
        };

        if !event_cfg.enabled {
            continue;
        }

        if throttle.is_throttled(event.id, event_cfg.cooldown_ms) {
            continue;
        }

        let volume =
            audio_settings.effective_volume(event_cfg.category, event_cfg.volume, event.strength);
        if volume <= 0.0 {
            continue;
        }

        let Some(ref asset_path) = event_cfg.asset else {
            continue;
        };

        let handle = asset_server.load(asset_path);

        // TODO: spatial audio — use event.position + event_cfg.max_distance
        // to configure SpatialAudioSink when spatial audio is implemented.

        // Spawn a one-shot audio source using the new AudioPlayer in Bevy 0.15/0.18
        commands.spawn((
            AudioPlayer::new(handle),
            PlaybackSettings {
                volume: Volume::Linear(volume),
                ..PlaybackSettings::DESPAWN
            },
        ));
    }
}
