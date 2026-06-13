import { describe, expect, it, beforeEach } from "vitest";
import { ALL_AUDIO_EVENTS } from "./audio_event_id.js";
import { defaultAudioConfig } from "./audio_config.js";
import { ProceduralAudio } from "./procedural_audio.js";
import { AudioThrottle } from "./audio_throttle.js";

// Mocking AudioContext
class MockAudioContext {
  sampleRate = 44100;
  currentTime = 0;
  destination = {};
  createGain() {
    return {
      gain: { value: 1, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, linearRampToValueAtTime: () => {} },
      connect: () => {},
    };
  }
  createBuffer() {
    return {
      getChannelData: () => new Float32Array(100),
    };
  }
  createBufferSource() {
    return {
      buffer: null,
      playbackRate: { value: 1 },
      connect: () => ({ connect: () => ({ connect: () => {} }) }),
      start: () => {},
      stop: () => {},
    };
  }
  createOscillator() {
    return {
      type: "sine",
      frequency: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
      connect: () => ({ connect: () => {} }),
      start: () => {},
      stop: () => {},
    };
  }
  createBiquadFilter() {
    return {
      type: "lowpass",
      frequency: { value: 1000 },
    };
  }
}

describe("Audio Configuration", () => {
  it("defines config entries for all AudioEventId values", () => {
    const eventsConfig = defaultAudioConfig.events;
    for (const eventId of ALL_AUDIO_EVENTS) {
      const entry = eventsConfig[eventId];
      expect(entry).toBeDefined();
      expect(typeof entry.enabled).toBe("boolean");
      expect(typeof entry.volume).toBe("number");
      expect(typeof entry.cooldown_ms).toBe("number");
      expect(typeof entry.synth).toBe("string");
      expect(typeof entry.pitch).toBe("number");
      expect(typeof entry.duration_ms).toBe("number");
    }
  });

  it("fails validation/lookup for unknown event ids at runtime", () => {
    const eventsConfig = defaultAudioConfig.events;
    expect((eventsConfig as any)["non_existent_event"]).toBeUndefined();
  });
});

describe("Audio Throttling", () => {
  let throttle: AudioThrottle;
  const dummyConfig = {
    enabled: true,
    volume: 0.5,
    cooldown_ms: 100,
    synth: "click",
    pitch: 440,
    duration_ms: 50,
  };

  beforeEach(() => {
    throttle = new AudioThrottle();
  });

  it("allows the first event play", () => {
    expect(throttle.isThrottled("ui.click", dummyConfig)).toBe(false);
  });

  it("blocks subsequent plays within the cooldown window", () => {
    expect(throttle.isThrottled("ui.click", dummyConfig)).toBe(false);
    expect(throttle.isThrottled("ui.click", dummyConfig)).toBe(true);
  });

  it("allows plays if forced, regardless of cooldown", () => {
    expect(throttle.isThrottled("ui.click", dummyConfig)).toBe(false);
    expect(throttle.isThrottled("ui.click", dummyConfig)).toBe(true);
    expect(throttle.isThrottled("ui.click", dummyConfig, true)).toBe(false);
  });
});

describe("Volume Clamping", () => {
  it("clamps master volume between 0 and 1", () => {
    const synth = new ProceduralAudio();
    synth.setMasterVolume(1.5);
    expect(synth.getMasterVolume()).toBe(1.0);
    
    synth.setMasterVolume(-0.5);
    expect(synth.getMasterVolume()).toBe(0.0);

    synth.setMasterVolume(0.5);
    expect(synth.getMasterVolume()).toBe(0.5);
  });
});

describe("No-op Safety when AudioContext is missing/disabled", () => {
  it("does not throw when emitting events on a fresh bus before initialization", () => {
    // Use a fresh ProceduralAudio to avoid shared singleton state
    const synth = new ProceduralAudio();
    expect(synth.isInitialized()).toBe(false);
    expect(() => synth.playSynth("click", {
      enabled: true,
      volume: 0.5,
      cooldown_ms: 0,
      synth: "click",
      pitch: 440,
      duration_ms: 50,
    })).not.toThrow();
  });

  it("does not throw when initialized with null context (stays uninitialized)", () => {
    const synth = new ProceduralAudio();
    // With ?? instead of ||, null context stays null — no AudioContext created
    expect(() => synth.init(null as any)).not.toThrow();
    expect(synth.isInitialized()).toBe(false);
    expect(() => synth.playSynth("click", {
      enabled: true,
      volume: 0.5,
      cooldown_ms: 0,
      synth: "click",
      pitch: 440,
      duration_ms: 50,
    })).not.toThrow();
  });

  it("runs correctly when fully initialized with mock context", () => {
    const synth = new ProceduralAudio();
    const mockCtx = new MockAudioContext();
    synth.init(mockCtx as any);
    expect(synth.isInitialized()).toBe(true);
    expect(() => synth.playSynth("click", {
      enabled: true,
      volume: 0.5,
      cooldown_ms: 0,
      synth: "click",
      pitch: 440,
      duration_ms: 50,
    })).not.toThrow();
  });
});
