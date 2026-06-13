import { AudioEventId } from "./audio_event_id.js";
import { EventAudioConfig } from "./audio_config.js";

export class AudioThrottle {
  private lastPlayed = new Map<AudioEventId, number>();

  /**
   * Check if an event is throttled (i.e. still within cooldown_ms).
   * If not throttled, records the current time as the last played time and returns false.
   * If throttled, returns true.
   * If `force` is true, bypasses throttle and records the current time, returning false.
   */
  isThrottled(eventId: AudioEventId, config: EventAudioConfig, force = false): boolean {
    if (force) {
      this.lastPlayed.set(eventId, Date.now());
      return false;
    }
    const now = Date.now();
    const last = this.lastPlayed.get(eventId) ?? 0;
    const cooldown = config.cooldown_ms;
    if (now - last < cooldown) {
      return true;
    }
    this.lastPlayed.set(eventId, now);
    return false;
  }

  clear(): void {
    this.lastPlayed.clear();
  }
}
