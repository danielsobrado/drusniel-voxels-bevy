import { mulberry32 } from "../ui/icons/drawing.js";

export interface AgentSimRingConfig {
  readonly fullRadiusM: number;
  readonly midRadiusM: number;
  readonly midTickStride: number;
}

export const DEFAULT_AGENT_SIM_RING_CONFIG: AgentSimRingConfig = Object.freeze({
  fullRadiusM: 64,
  midRadiusM: 256,
  midTickStride: 4,
});

export interface AgentSimEnvelopeConfig {
  readonly count: number;
  readonly seed: number;
  readonly centerX: number;
  readonly centerZ: number;
  readonly spreadM: number;
  readonly rings: AgentSimRingConfig;
}

export interface AgentSimEnvelopeCounters {
  agents_full: number;
  agents_mid: number;
  agents_frozen: number;
  agent_sim_ms: number;
}

export interface AgentSimEnvelope {
  readonly config: AgentSimEnvelopeConfig;
  tick(frameIndex: number, counters: Record<string, number>): void;
  positionAt(index: number): { readonly x: number; readonly z: number };
  readonly count: number;
}

export function createAgentSimEnvelope(config: AgentSimEnvelopeConfig): AgentSimEnvelope {
  const rng = mulberry32(config.seed);
  const xs = new Float64Array(config.count);
  const zs = new Float64Array(config.count);
  const headings = new Float64Array(config.count);
  for (let index = 0; index < config.count; index += 1) {
    const angle = rng() * Math.PI * 2;
    const radius = rng() * config.spreadM;
    xs[index] = config.centerX + Math.cos(angle) * radius;
    zs[index] = config.centerZ + Math.sin(angle) * radius;
    headings[index] = rng() * Math.PI * 2;
  }

  function ringFor(index: number): "full" | "mid" | "frozen" {
    const dx = xs[index]! - config.centerX;
    const dz = zs[index]! - config.centerZ;
    const dist = Math.hypot(dx, dz);
    if (dist <= config.rings.fullRadiusM) return "full";
    if (dist <= config.rings.midRadiusM) return "mid";
    return "frozen";
  }

  return {
    config,
    count: config.count,
    positionAt(index) {
      return { x: xs[index] ?? config.centerX, z: zs[index] ?? config.centerZ };
    },
    tick(frameIndex, counters) {
      const started = performance.now();
      let full = 0;
      let mid = 0;
      let frozen = 0;
      const wanderRng = mulberry32(config.seed + frameIndex * 977);
      for (let index = 0; index < config.count; index += 1) {
        const ring = ringFor(index);
        if (ring === "full") {
          full += 1;
          headings[index]! += (wanderRng() - 0.5) * 0.08;
          const speed = 0.35 + wanderRng() * 0.15;
          xs[index]! += Math.cos(headings[index]!) * speed;
          zs[index]! += Math.sin(headings[index]!) * speed;
          continue;
        }
        if (ring === "mid") {
          mid += 1;
          if (frameIndex % config.rings.midTickStride !== index % config.rings.midTickStride) continue;
          headings[index]! += (wanderRng() - 0.5) * 0.04;
          const speed = 0.2;
          xs[index]! += Math.cos(headings[index]!) * speed;
          zs[index]! += Math.sin(headings[index]!) * speed;
          continue;
        }
        frozen += 1;
      }
      counters["agents_full"] = full;
      counters["agents_mid"] = mid;
      counters["agents_frozen"] = frozen;
      counters["agent_sim_ms"] = performance.now() - started;
    },
  };
}
