import type { CausticsConfig } from "./causticsConfig.js";

export type WaterCausticsMode = "off" | "procedural_shader" | "compute_stub";

export interface WaterCausticsPolicy {
  activeMode: WaterCausticsMode;
  computeAvailable: boolean;
  proceduralEnabled: boolean;
  gain: number;
  scale: number;
  speed: number;
  reason: string;
}

export function resolveWaterCausticsPolicy(caustics: CausticsConfig): WaterCausticsPolicy {
  const proceduralEnabled = caustics.enabled;
  return {
    activeMode: proceduralEnabled ? "procedural_shader" : "off",
    computeAvailable: false,
    proceduralEnabled,
    gain: Math.max(0, caustics.gain),
    scale: Math.max(0, caustics.scale),
    speed: Math.max(0, caustics.speed),
    reason: proceduralEnabled
      ? "procedural shader caustics baseline; compute caustics not implemented"
      : "caustics disabled by config; compute caustics not implemented",
  };
}
