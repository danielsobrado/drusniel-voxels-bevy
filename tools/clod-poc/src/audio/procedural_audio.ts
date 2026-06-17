/**
 * Procedural WebAudio sound effects for CLOD.
 */

import { EventAudioConfig } from "./audio_config.js";

export class ProceduralAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private enabled = true;
  private masterVol = 0.55;

  init(ctx?: AudioContext): void {
    if (this.ctx) return;
    try {
      this.ctx = ctx ?? new (window.AudioContext || (window as any).webkitAudioContext)();
      if (!this.ctx) return;
      
      this.master = this.ctx.createGain();
      this.master.gain.value = this.masterVol;
      this.master.connect(this.ctx.destination);
      
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === "suspended") {
        void this.ctx.resume();
      }
    } catch (e) {
      this.ctx = null;
      this.master = null;
      this.noiseBuf = null;
    }
  }

  setMasterVolume(v: number): void {
    this.masterVol = Math.min(1, Math.max(0, v));
    if (this.master) {
      this.master.gain.value = this.masterVol;
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getMasterVolume(): number {
    return this.masterVol;
  }

  isInitialized(): boolean {
    return this.ctx !== null;
  }

  private noise(duration: number, filterFreq: number, gain: number, decay = 0.9, filterType: BiquadFilterType = "lowpass"): void {
    if (!this.enabled || !this.ctx || !this.master || !this.noiseBuf) return;
    try {
      const t = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.playbackRate.value = 0.8 + Math.random() * 0.4;
      
      const filter = this.ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = filterFreq;
      
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + duration * decay);
      
      src.connect(filter).connect(g).connect(this.master);
      src.start(t, Math.random() * 0.5, duration);
    } catch {
      // Ignored for safety
    }
  }

  private tone(freq: number, duration: number, gain: number, type: OscillatorType = "sine", delay = 0, slideTo?: number): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    try {
      const t = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (slideTo) {
        osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
      }
      
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + duration);
      
      osc.connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + duration + 0.05);
    } catch {
      // Ignored for safety
    }
  }

  playSynth(synthName: string, config: EventAudioConfig, optionsVolume?: number, optionsPitch?: number, optionsVariant?: number): void {
    if (!this.ctx) return;
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    const vol = Math.min(1, Math.max(0, optionsVolume !== undefined ? optionsVolume : config.volume));
    const pitch = optionsPitch !== undefined ? optionsPitch : config.pitch;
    const duration = config.duration_ms / 1000;
    const variant = optionsVariant !== undefined ? optionsVariant : 0;

    switch (synthName) {
      case "click":
        this.tone(pitch, duration, vol, "square");
        break;
      case "soft_click":
        this.tone(pitch, duration, vol, "sine");
        break;
      case "error":
        this.tone(pitch, duration, vol, "square", 0, pitch * 0.7);
        break;
      case "warning":
        this.tone(pitch, duration, vol, "triangle");
        break;
      case "success":
        this.tone(pitch, duration * 0.5, vol, "triangle");
        this.tone(pitch * 1.33, duration, vol, "triangle", duration * 0.4);
        break;
      case "toggle_on":
        this.tone(pitch, duration, vol, "sine", 0, pitch * 1.5);
        break;
      case "toggle_off":
        this.tone(pitch * 1.5, duration, vol, "sine", 0, pitch);
        break;
      case "texture_load":
        this.noise(duration, 2000, vol * 0.5, 0.7, "bandpass");
        this.tone(pitch, duration, vol, "triangle", 0, pitch * 1.25);
        break;
      case "dig":
        // One cohesive earthy dig: filtered noise + low sawtooth, played together.
        this.noise(duration, 300 + (variant * 50), vol, 0.8);
        this.tone(pitch - (variant * 20), duration, vol * 0.5, "sawtooth", 0, 50);
        break;
      case "jump":
        this.tone(pitch, duration, vol, "triangle", 0, pitch * 1.35);
        break;
      case "raise":
        // One cohesive soil-mound sound: noise + rising triangle, played together.
        this.noise(duration, 500, vol, 0.8);
        this.tone(pitch, duration, vol * 0.35, "triangle", 0, pitch * 1.5);
        break;
      case "lower":
        this.noise(duration, 350, vol, 0.8);
        this.tone(pitch * 1.5, duration, vol * 0.35, "triangle", 0, pitch);
        break;
      case "smooth":
        this.noise(duration, 800, vol, 0.9, "lowpass");
        this.tone(pitch, duration, vol * 0.3, "sine");
        break;
      case "paint":
        this.noise(duration, 1500, vol, 0.6, "bandpass");
        break;
      case "rebuild_start":
        this.tone(pitch, duration, vol, "sine", 0, pitch * 1.1);
        break;
      case "rebuild_done":
        this.tone(pitch, duration, vol, "sine");
        this.tone(pitch * 1.5, duration, vol * 0.8, "sine", 0.05);
        break;
      case "rebuild_error":
        this.tone(pitch, duration, vol, "square", 0, pitch * 0.5);
        this.noise(duration, 400, vol * 0.5);
        break;
      case "validation_warning":
        this.tone(pitch, duration, vol, "triangle");
        this.tone(pitch, duration, vol, "triangle", duration * 0.5);
        break;
      case "validation_error":
        this.tone(pitch, duration, vol, "square", 0, pitch * 0.6);
        this.tone(pitch * 0.9, duration, vol, "square", 0.1, pitch * 0.5);
        break;
      default:
        // Fallback simple click
        this.tone(pitch, duration, vol, "sine");
        break;
    }
  }
}
