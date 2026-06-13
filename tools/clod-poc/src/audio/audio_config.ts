import { load } from "js-yaml";
import { AudioEventId, ALL_AUDIO_EVENTS } from "./audio_event_id.js";
import audioEventsYamlText from "../../config/audio_events.yaml?raw";

export interface EventAudioConfig {
  enabled: boolean;
  volume: number;
  cooldown_ms: number;
  synth: string;
  pitch: number;
  duration_ms: number;
}

export interface GlobalAudioConfig {
  enabled: boolean;
  master_volume: number;
  ui_volume: number;
  world_volume: number;
  debug_volume: number;
}

export interface AudioConfig {
  global: GlobalAudioConfig;
  events: Record<AudioEventId, EventAudioConfig>;
}

export function parseAudioConfig(text: string): AudioConfig {
  const parsed = load(text) as any;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid audio configuration");
  }
  if (!parsed.global || typeof parsed.global !== "object") {
    throw new Error("Missing global audio configuration");
  }
  if (!parsed.events || typeof parsed.events !== "object") {
    throw new Error("Missing events audio configuration");
  }

  // Validate each registered event has a well-formed entry
  const requiredFields: Array<[keyof EventAudioConfig, string]> = [
    ["enabled", "boolean"],
    ["volume", "number"],
    ["cooldown_ms", "number"],
    ["synth", "string"],
    ["pitch", "number"],
    ["duration_ms", "number"],
  ];
  for (const eventId of ALL_AUDIO_EVENTS) {
    const entry = parsed.events[eventId];
    if (!entry || typeof entry !== "object") {
      throw new Error(`Missing audio config for event "${eventId}"`);
    }
    for (const [field, expectedType] of requiredFields) {
      if (typeof entry[field] !== expectedType) {
        throw new Error(
          `Event "${eventId}": field "${field}" should be ${expectedType}, got ${typeof entry[field]}`
        );
      }
    }
  }

  return parsed as AudioConfig;
}

export const defaultAudioConfig = parseAudioConfig(audioEventsYamlText);
