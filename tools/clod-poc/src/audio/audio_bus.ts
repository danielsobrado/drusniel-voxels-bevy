import { AudioEventId } from "./audio_event_id.js";
import { defaultAudioConfig, AudioConfig } from "./audio_config.js";
import { ProceduralAudio } from "./procedural_audio.js";
import { AudioThrottle } from "./audio_throttle.js";

export interface AudioEventOptions {
  volume?: number;
  pitch?: number;
  variant?: number;
  durationMs?: number;
  force?: boolean;
}

export interface AudioState {
  enabled: boolean;
  masterVolume: number;
  initialized: boolean;
}

export class AudioBus {
  private synthManager = new ProceduralAudio();
  private throttle = new AudioThrottle();
  private config: AudioConfig = defaultAudioConfig;

  constructor() {
    this.loadPersistence();
    this.setupLazyInit();
  }

  private loadPersistence(): void {
    if (typeof localStorage === "undefined") return;
    try {
      const savedEnabled = localStorage.getItem("clod_audio_enabled");
      if (savedEnabled !== null) {
        this.synthManager.setEnabled(savedEnabled === "true");
      } else {
        // Fallback to YAML global config
        this.synthManager.setEnabled(this.config.global.enabled);
      }

      const savedVol = localStorage.getItem("clod_audio_master_volume");
      if (savedVol !== null) {
        this.synthManager.setMasterVolume(parseFloat(savedVol));
      } else {
        // Fallback to YAML global config
        this.synthManager.setMasterVolume(this.config.global.master_volume);
      }
    } catch {
      // Ignored for safety
    }
  }

  private savePersistence(): void {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem("clod_audio_enabled", String(this.synthManager.isEnabled()));
      localStorage.setItem("clod_audio_master_volume", String(this.synthManager.getMasterVolume()));
    } catch {
      // Ignored for safety
    }
  }

  private setupLazyInit(): void {
    if (typeof window === "undefined") return;
    const initOnGesture = () => {
      this.init();
      removeListeners();
    };
    const removeListeners = () => {
      window.removeEventListener("pointerdown", initOnGesture, { capture: true });
      window.removeEventListener("keydown", initOnGesture, { capture: true });
      window.removeEventListener("click", initOnGesture, { capture: true });
    };
    window.addEventListener("pointerdown", initOnGesture, { capture: true, passive: true });
    window.addEventListener("keydown", initOnGesture, { capture: true, passive: true });
    window.addEventListener("click", initOnGesture, { capture: true, passive: true });
  }

  init(ctx?: AudioContext): void {
    this.synthManager.init(ctx);
  }

  emitAudio(eventId: AudioEventId, options?: AudioEventOptions): void {
    // If not initialized, try initializing (just in case)
    if (!this.synthManager.isInitialized()) {
      this.init();
    }

    if (!this.synthManager.isEnabled()) return;

    const eventCfg = this.config.events[eventId];
    if (!eventCfg) {
      console.warn(`[audio] Unknown event ID: ${eventId}`);
      return;
    }

    if (!eventCfg.enabled) return;

    const force = options?.force ?? false;
    if (this.throttle.isThrottled(eventId, eventCfg, force)) {
      return;
    }

    // Apply category volume scaling if any (ui_volume, world_volume, debug_volume)
    let categoryScale = 1.0;
    if (eventId.startsWith("ui.")) {
      categoryScale = this.config.global.ui_volume;
    } else if (
      eventId.startsWith("project.") ||
      eventId.startsWith("camera.") ||
      eventId.startsWith("texture.") ||
      eventId.startsWith("material.") ||
      eventId.startsWith("terrain.") ||
      eventId.startsWith("spell.")
    ) {
      categoryScale = this.config.global.world_volume;
    } else if (eventId.startsWith("clod.")) {
      categoryScale = this.config.global.debug_volume;
    }

    // Combined volume: event volume * options volume (if provided) * category scale
    const eventVol = options?.volume !== undefined ? options.volume : eventCfg.volume;
    const finalVolume = Math.min(1, Math.max(0, eventVol * categoryScale));

    this.synthManager.playSynth(
      eventCfg.synth,
      eventCfg,
      finalVolume,
      options?.pitch,
      options?.variant,
      options?.durationMs,
    );
  }

  setAudioEnabled(enabled: boolean): void {
    this.synthManager.setEnabled(enabled);
    this.savePersistence();
  }

  setMasterVolume(volume: number): void {
    this.synthManager.setMasterVolume(volume);
    this.savePersistence();
  }

  getAudioState(): AudioState {
    return {
      enabled: this.synthManager.isEnabled(),
      masterVolume: this.synthManager.getMasterVolume(),
      initialized: this.synthManager.isInitialized(),
    };
  }

  // Helper for tests to inject mock configs/states
  getConfig(): AudioConfig {
    return this.config;
  }
}

export const audioBus = new AudioBus();
