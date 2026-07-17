import type * as THREE from "three";
import {
  isRpgDensityScene,
  rpgDensitySceneCenter,
  type RpgDensitySceneId,
} from "../scenes/rpg_density_scenes.js";
import { createAgentQueryEnvelope } from "./agent_query_envelope.js";
import { createAgentRenderEnvelope } from "./agent_render_envelope.js";
import { createAgentSimEnvelope, DEFAULT_AGENT_SIM_RING_CONFIG } from "./agent_sim_envelope.js";

export interface AgentEnvelopeRuntimeConfig {
  readonly count: number;
  readonly seed: number;
  readonly skinned: boolean;
  readonly sceneId: RpgDensitySceneId;
}

export interface AgentEnvelopeRuntime {
  update(deltaSeconds: number, counters: Record<string, number>): void;
  dispose(): void;
}

function parsePositiveInt(raw: string | null, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

export function resolveAgentEnvelopeConfig(searchParams: URLSearchParams): AgentEnvelopeRuntimeConfig | null {
  if (searchParams.get("agentEnvelope") !== "1") return null;
  const sceneParam = searchParams.get("rpgDensityScene");
  const sceneId = isRpgDensityScene(sceneParam) ? sceneParam : "rpg-village";
  return {
    count: parsePositiveInt(searchParams.get("agentCount"), 50),
    seed: parsePositiveInt(searchParams.get("seed"), 1337),
    skinned: searchParams.get("agentSkin") === "1",
    sceneId,
  };
}

export function createAgentEnvelopeRuntime(
  scene: THREE.Scene,
  searchParams: URLSearchParams,
): AgentEnvelopeRuntime | null {
  const config = resolveAgentEnvelopeConfig(searchParams);
  if (!config) return null;
  const center = rpgDensitySceneCenter(config.sceneId);
  const sim = createAgentSimEnvelope({
    count: config.count,
    seed: config.seed,
    centerX: center.x,
    centerZ: center.z,
    spreadM: 96,
    rings: DEFAULT_AGENT_SIM_RING_CONFIG,
  });
  const render = createAgentRenderEnvelope(scene, {
    count: config.count,
    seed: config.seed + 17,
    centerX: center.x,
    centerZ: center.z,
    spreadM: 96,
    skinned: config.skinned,
  });
  const query = createAgentQueryEnvelope({
    sim,
    centerX: center.x,
    centerZ: center.z,
    fullRadiusM: DEFAULT_AGENT_SIM_RING_CONFIG.fullRadiusM,
    midRadiusM: DEFAULT_AGENT_SIM_RING_CONFIG.midRadiusM,
    budget: {
      fullQueries: 4,
      midQueries: 2,
      frozenQueries: 0,
    },
  });

  let frameIndex = 0;
  return {
    update(deltaSeconds, counters) {
      frameIndex += 1;
      sim.tick(frameIndex, counters);
      render.update(deltaSeconds, counters);
      query.tick(counters);
    },
    dispose() {
      render.dispose();
    },
  };
}
