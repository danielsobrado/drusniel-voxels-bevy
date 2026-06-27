/**
 * Procedural WebAudio sound effects for CLOD.
 */

import { EventAudioConfig } from "./audio_config.js";

const FLAME_BASE_RATE = 16000;
const FLAME_DELAY = 222.5;
const FLAME_ATTACK_SECONDS = 0.08;
const FLAME_RELEASE_START = 0.82;

type StereoSample = readonly [number, number];

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
    } catch {
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

  private fireFlame(duration: number, gain: number): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    try {
      const count = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
      const buffer = this.ctx.createBuffer(2, count, this.ctx.sampleRate);
      const left = buffer.getChannelData(0);
      const right = buffer.getChannelData(1);

      for (let i = 0; i < count; i++) {
        const time = i / this.ctx.sampleRate;
        const sample = ProceduralAudio.flameMainSound(time);
        const envelope = ProceduralAudio.flameEnvelope(time, duration);
        left[i] = ProceduralAudio.clampSample(sample[0] * envelope);
        right[i] = ProceduralAudio.clampSample(sample[1] * envelope);
      }

      const now = this.ctx.currentTime;
      const source = this.ctx.createBufferSource();
      const highpass = this.ctx.createBiquadFilter();
      const lowpass = this.ctx.createBiquadFilter();
      const out = this.ctx.createGain();

      source.buffer = buffer;
      highpass.type = "highpass";
      highpass.frequency.value = 55;
      lowpass.type = "lowpass";
      lowpass.frequency.value = 7200;
      lowpass.Q.value = 0.45;
      out.gain.setValueAtTime(0.001, now);
      out.gain.linearRampToValueAtTime(gain, now + 0.04);
      out.gain.linearRampToValueAtTime(0.001, now + duration);

      source.connect(highpass).connect(lowpass).connect(out).connect(this.master);
      source.addEventListener("ended", () => {
        highpass.disconnect();
        lowpass.disconnect();
        out.disconnect();
      }, { once: true });
      source.start(now);
      source.stop(now + duration + 0.05);
    } catch {
      // Ignored for safety
    }
  }

  playSynth(
    synthName: string,
    config: EventAudioConfig,
    optionsVolume?: number,
    optionsPitch?: number,
    optionsVariant?: number,
    optionsDurationMs?: number,
  ): void {
    if (!this.ctx) return;
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    const vol = Math.min(1, Math.max(0, optionsVolume !== undefined ? optionsVolume : config.volume));
    const pitch = optionsPitch !== undefined ? optionsPitch : config.pitch;
    const duration = (optionsDurationMs !== undefined ? optionsDurationMs : config.duration_ms) / 1000;
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
      case "fire_flame":
        this.fireFlame(duration, vol);
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

  private static flameMainSound(time: number): StereoSample {
    const sample = ProceduralAudio.flameSound(time);
    return [0.5 * sample[0], 0.5 * sample[1]];
  }

  private static flameSound(time: number): StereoSample {
    const flameVar = Math.sin(time * 0.55)
      + 0.56 * Math.sin(time * 0.134)
      + 0.22 * Math.sin(time * 0.095);
    const delay = FLAME_DELAY * (1 - 0.02 * flameVar);
    const t2 = FLAME_BASE_RATE * ((time % 3.254) + (time % 1.8456));
    const left = ProceduralAudio.flameNoise(t2)
      - 0.8 * ProceduralAudio.flameNoise(t2 + delay * 0.5)
      + 0.5 * ProceduralAudio.flameNoise(t2 - delay);
    const right = ProceduralAudio.flameNoise(t2 + 1000)
      - 0.8 * ProceduralAudio.flameNoise(t2 + delay + 3000)
      + 0.5 * ProceduralAudio.flameNoise(t2 + delay * 0.5 + 3000);
    const flicker = (0.8 + 0.3 * flameVar) * (1 + 0.3 * ProceduralAudio.flameNoise(time * 16));
    return [flicker * left, flicker * right];
  }

  private static flameNoise(x: number): number {
    const p = Math.floor(x);
    let f = x - p;
    f = f * f * (3 - 2 * f);
    return ProceduralAudio.mix(ProceduralAudio.flameRand2(p, p + 1000), ProceduralAudio.flameRand2(p + 1, p + 1001), f);
  }

  private static flameRand2(x: number, y: number): number {
    const r1 = ProceduralAudio.fract(Math.sin(x * 16.9898 + y * 78.233) * 23758.5453);
    return ProceduralAudio.fract(Math.sin(r1 * 12.9898 + y * 1.562 * 78.233) * 43758.5453);
  }

  private static flameEnvelope(time: number, duration: number): number {
    const attack = Math.min(FLAME_ATTACK_SECONDS, duration * 0.12);
    const attackGain = Math.min(1, time / Math.max(attack, 0.001));
    const releaseAt = duration * FLAME_RELEASE_START;
    if (time <= releaseAt) return attackGain;
    return attackGain * Math.max(0, (duration - time) / Math.max(0.001, duration - releaseAt));
  }

  private static clampSample(value: number): number {
    return Math.min(1, Math.max(-1, value));
  }

  private static mix(a: number, b: number, t: number): number {
    return a * (1 - t) + b * t;
  }

  private static fract(value: number): number {
    return value - Math.floor(value);
  }
}
