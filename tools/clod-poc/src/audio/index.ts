import { AudioBus, audioBus } from "./audio_bus.js";
import type { AudioEventOptions, AudioState } from "./audio_bus.js";
import type { AudioEventId } from "./audio_event_id.js";

export { AudioBus, audioBus };
export type { AudioEventId, AudioEventOptions, AudioState };

export const emitAudio = (eventId: AudioEventId, options?: AudioEventOptions): void => {
  audioBus.emitAudio(eventId, options);
};

export const setAudioEnabled = (enabled: boolean): void => {
  audioBus.setAudioEnabled(enabled);
};

export const setMasterVolume = (volume: number): void => {
  audioBus.setMasterVolume(volume);
};

export const getAudioState = (): AudioState => {
  return audioBus.getAudioState();
};
