use super::events::AudioEventId;
use bevy::prelude::*;
use std::collections::HashMap;
use std::time::Instant;

#[derive(Resource, Default)]
pub struct AudioThrottle {
    last_played: HashMap<AudioEventId, Instant>,
}

impl AudioThrottle {
    pub fn is_throttled(&mut self, id: AudioEventId, cooldown_ms: u64) -> bool {
        if cooldown_ms == 0 {
            return false;
        }
        let now = Instant::now();
        if let Some(&last) = self.last_played.get(&id) {
            if now.duration_since(last).as_millis() < cooldown_ms as u128 {
                return true;
            }
        }
        self.last_played.insert(id, now);
        false
    }
}
