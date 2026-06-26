import { getAudioState } from "../audio/index.js";
import type { FireSpellAudioConfig } from "./spell_config.js";

const BASE_RATE = 16000;
const DELAY = 222.5;
const ATTACK_SECONDS = 0.08;
const RELEASE_START = 0.82;

type StereoSample = readonly [number, number];

export class FlameSfx {
  private ctx: AudioContext | null = null;
  private output: GainNode | null = null;
  private activeSources = new Set<AudioBufferSourceNode>();

  play(config: FireSpellAudioConfig, durationMs: number): void {
    const state = getAudioState();
    if (!state.enabled) return;

    this.ensureContext();
    if (!this.ctx || !this.output) return;

    const durationSeconds = Math.max(0.25, durationMs / 1000);
    const volume = Math.min(1, Math.max(0, config.volume * state.masterVolume));
    if (volume <= 0.001) return;

    try {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      this.start(durationSeconds, volume);
    } catch (error) {
      console.warn("[spells] Flame SFX failed.", error);
    }
  }

  dispose(): void {
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }
    this.activeSources.clear();
    this.output?.disconnect();
    if (this.ctx && this.ctx.state !== "closed") {
      void this.ctx.close();
    }
    this.ctx = null;
    this.output = null;
  }

  private ensureContext(): void {
    if (this.ctx && this.output) return;

    try {
      const audioWindow = window as Window & { webkitAudioContext?: typeof AudioContext };
      const AudioContextCtor = window.AudioContext ?? audioWindow.webkitAudioContext;
      if (!AudioContextCtor) return;

      this.ctx = new AudioContextCtor();
      this.output = this.ctx.createGain();
      this.output.connect(this.ctx.destination);
    } catch (error) {
      console.warn("[spells] Flame SFX init failed.", error);
      this.ctx = null;
      this.output = null;
    }
  }

  private start(durationSeconds: number, volume: number): void {
    if (!this.ctx || !this.output) return;

    const count = Math.max(1, Math.floor(this.ctx.sampleRate * durationSeconds));
    const buffer = this.ctx.createBuffer(2, count, this.ctx.sampleRate);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    for (let i = 0; i < count; i++) {
      const t = i / this.ctx.sampleRate;
      const sample = FlameSfx.mainSound(t);
      const env = FlameSfx.envelope(t, durationSeconds);
      left[i] = FlameSfx.clamp(sample[0] * env);
      right[i] = FlameSfx.clamp(sample[1] * env);
    }

    const now = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    const highpass = this.ctx.createBiquadFilter();
    const lowpass = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    source.buffer = buffer;
    highpass.type = "highpass";
    highpass.frequency.value = 55;
    lowpass.type = "lowpass";
    lowpass.frequency.value = 7200;
    lowpass.Q.value = 0.45;
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.04);
    gain.gain.linearRampToValueAtTime(0.001, now + durationSeconds);

    source.connect(highpass).connect(lowpass).connect(gain).connect(this.output);
    source.addEventListener("ended", () => {
      this.activeSources.delete(source);
      highpass.disconnect();
      lowpass.disconnect();
      gain.disconnect();
    }, { once: true });
    this.activeSources.add(source);
    source.start(now);
    source.stop(now + durationSeconds + 0.05);
  }

  private static mainSound(time: number): StereoSample {
    const sample = FlameSfx.getSound(time);
    return [0.5 * sample[0], 0.5 * sample[1]];
  }

  private static getSound(time: number): StereoSample {
    const flameVar = Math.sin(time * 0.55)
      + 0.56 * Math.sin(time * 0.134)
      + 0.22 * Math.sin(time * 0.095);
    const delay = DELAY * (1 - 0.02 * flameVar);
    const t2 = BASE_RATE * ((time % 3.254) + (time % 1.8456));
    const left = FlameSfx.noise(t2)
      - 0.8 * FlameSfx.noise(t2 + delay * 0.5)
      + 0.5 * FlameSfx.noise(t2 - delay);
    const right = FlameSfx.noise(t2 + 1000)
      - 0.8 * FlameSfx.noise(t2 + delay + 3000)
      + 0.5 * FlameSfx.noise(t2 + delay * 0.5 + 3000);
    const flicker = (0.8 + 0.3 * flameVar) * (1 + 0.3 * FlameSfx.noise(time * 16));
    return [flicker * left, flicker * right];
  }

  private static noise(x: number): number {
    const p = Math.floor(x);
    let f = x - p;
    f = f * f * (3 - 2 * f);
    return FlameSfx.mix(FlameSfx.rand2(p, p + 1000), FlameSfx.rand2(p + 1, p + 1001), f);
  }

  private static rand2(x: number, y: number): number {
    const r1 = FlameSfx.fract(Math.sin(x * 16.9898 + y * 78.233) * 23758.5453);
    return FlameSfx.fract(Math.sin(r1 * 12.9898 + y * 1.562 * 78.233) * 43758.5453);
  }

  private static envelope(time: number, durationSeconds: number): number {
    const attack = Math.min(ATTACK_SECONDS, durationSeconds * 0.12);
    const attackGain = Math.min(1, time / Math.max(attack, 0.001));
    const releaseAt = durationSeconds * RELEASE_START;
    if (time <= releaseAt) return attackGain;
    return attackGain * Math.max(0, (durationSeconds - time) / Math.max(0.001, durationSeconds - releaseAt));
  }

  private static clamp(value: number): number {
    return Math.min(1, Math.max(-1, value));
  }

  private static mix(a: number, b: number, t: number): number {
    return a * (1 - t) + b * t;
  }

  private static fract(value: number): number {
    return value - Math.floor(value);
  }
}
