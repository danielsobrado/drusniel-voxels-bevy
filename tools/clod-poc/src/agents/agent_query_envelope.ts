import { surfaceHeight } from "../terrain/terrain.js";
import type { AgentSimEnvelope } from "./agent_sim_envelope.js";

export interface AgentQueryRingBudget {
  readonly fullQueries: number;
  readonly midQueries: number;
  readonly frozenQueries: number;
}

export const DEFAULT_AGENT_QUERY_BUDGET: AgentQueryRingBudget = Object.freeze({
  fullQueries: 4,
  midQueries: 2,
  frozenQueries: 0,
});

export interface AgentQueryEnvelopeConfig {
  readonly sim: AgentSimEnvelope;
  readonly centerX: number;
  readonly centerZ: number;
  readonly fullRadiusM: number;
  readonly midRadiusM: number;
  readonly budget: AgentQueryRingBudget;
}

export interface AgentQueryEnvelope {
  tick(counters: Record<string, number>): void;
}

/** Cheap stand-in until a real collider query API is wired for agent envelopes. */
export function stubAgentColliderHit(x: number, z: number): boolean {
  const cellX = Math.floor(x / 16);
  const cellZ = Math.floor(z / 16);
  return ((cellX * 73856093) ^ (cellZ * 19349663)) % 7 === 0;
}

export function createAgentQueryEnvelope(config: AgentQueryEnvelopeConfig): AgentQueryEnvelope {
  return {
    tick(counters) {
      const started = performance.now();
      let queries = 0;
      for (let index = 0; index < config.sim.count; index += 1) {
        const position = config.sim.positionAt(index);
        const dx = position.x - config.centerX;
        const dz = position.z - config.centerZ;
        const dist = Math.hypot(dx, dz);
        const budget = dist <= config.fullRadiusM
          ? config.budget.fullQueries
          : dist <= config.midRadiusM
            ? config.budget.midQueries
            : config.budget.frozenQueries;
        for (let query = 0; query < budget; query += 1) {
          const sampleX = position.x + query * 0.25;
          const sampleZ = position.z + query * 0.25;
          surfaceHeight(sampleX, sampleZ);
          stubAgentColliderHit(sampleX, sampleZ);
          queries += 1;
        }
      }
      counters["agent_terrain_query_ms"] = performance.now() - started;
      counters["agent_terrain_queries"] = queries;
    },
  };
}
