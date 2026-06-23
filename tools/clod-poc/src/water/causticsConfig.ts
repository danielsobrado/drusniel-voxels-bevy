// Procedural caustics config for the water material.
// These control the optional caustic effect on submerged terrain surfaces.
export interface CausticsConfig {
  enabled: boolean;
  gain: number;
  depthFade: number;
  focalDepth: number;
  sunGateStart: number;
  sunGateEnd: number;
  flowAdvection: number;
  scale: number;
  speed: number;
}

export const DEFAULT_CAUSTICS_CONFIG: CausticsConfig = {
  enabled: false,
  gain: 1.3,
  depthFade: 0.32,
  focalDepth: 0.5,
  sunGateStart: 0.03,
  sunGateEnd: 0.16,
  flowAdvection: 1.9,
  scale: 0.12,
  speed: 0.7,
};
