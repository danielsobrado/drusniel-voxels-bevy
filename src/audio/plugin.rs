use super::config::load_audio_config;
use super::events::GameAudioEvent;
use super::playback::{MissingAssetsTracker, play_audio_events_system};
use super::throttle::AudioThrottle;
use bevy::prelude::*;

pub struct AudioEventsPlugin;

impl Plugin for AudioEventsPlugin {
    fn build(&self, app: &mut App) {
        let (settings, config) = load_audio_config();

        app.insert_resource(settings)
            .insert_resource(config)
            .init_resource::<AudioThrottle>()
            .init_resource::<MissingAssetsTracker>()
            .add_message::<GameAudioEvent>()
            .add_systems(Update, play_audio_events_system);
    }
}
