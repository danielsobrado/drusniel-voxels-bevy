import { load } from "js-yaml";
import swimmingConfigText from "../../config/player/swimming.yaml?raw";

export interface SwimConfig {
  enabled: boolean;
  enterSubmersionM: number;
  exitSubmersionM: number;
  surfaceSubmersionM: number;
  diveSubmersionM: number;
  swimSpeedMps: number;
  accelerationMps2: number;
  verticalControlSpeedMps: number;
  buoyancyAccelerationMps2: number;
  maxBuoyancyAccelerationMps2: number;
  horizontalDragPerSecond: number;
  verticalDragPerSecond: number;
  flowInfluence: number;
  shoreEpsilonM: number;
}

const FALLBACK_SWIM_CONFIG: Readonly<SwimConfig> = Object.freeze({
  enabled: true,
  enterSubmersionM: 0.65,
  exitSubmersionM: 0.35,
  surfaceSubmersionM: 0.85,
  diveSubmersionM: 1.45,
  swimSpeedMps: 5.5,
  accelerationMps2: 18,
  verticalControlSpeedMps: 4,
  buoyancyAccelerationMps2: 20,
  maxBuoyancyAccelerationMps2: 30,
  horizontalDragPerSecond: 1.5,
  verticalDragPerSecond: 3.5,
  flowInfluence: 1,
  shoreEpsilonM: 0.05,
});

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function numberAt(
  source: Record<string, unknown> | null,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number(source?.[key]);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function parseSwimConfig(text: string = swimmingConfigText): SwimConfig {
  try {
    const parsed = record(load(text));
    const swimming = record(parsed?.swimming);
    const enterSubmersionM = numberAt(swimming, "enter_submersion_m", FALLBACK_SWIM_CONFIG.enterSubmersionM, 0.05, 4);
    const exitSubmersionM = Math.min(
      enterSubmersionM,
      numberAt(swimming, "exit_submersion_m", FALLBACK_SWIM_CONFIG.exitSubmersionM, 0, 4),
    );
    const surfaceSubmersionM = numberAt(swimming, "surface_submersion_m", FALLBACK_SWIM_CONFIG.surfaceSubmersionM, enterSubmersionM, 4);
    const diveSubmersionM = Math.max(
      surfaceSubmersionM,
      numberAt(swimming, "dive_submersion_m", FALLBACK_SWIM_CONFIG.diveSubmersionM, 0.1, 8),
    );
    return {
      enabled: typeof swimming?.enabled === "boolean" ? swimming.enabled : FALLBACK_SWIM_CONFIG.enabled,
      enterSubmersionM,
      exitSubmersionM,
      surfaceSubmersionM,
      diveSubmersionM,
      swimSpeedMps: numberAt(swimming, "swim_speed_mps", FALLBACK_SWIM_CONFIG.swimSpeedMps, 0.1, 30),
      accelerationMps2: numberAt(swimming, "acceleration_mps2", FALLBACK_SWIM_CONFIG.accelerationMps2, 0.1, 100),
      verticalControlSpeedMps: numberAt(swimming, "vertical_control_speed_mps", FALLBACK_SWIM_CONFIG.verticalControlSpeedMps, 0.1, 20),
      buoyancyAccelerationMps2: numberAt(swimming, "buoyancy_acceleration_mps2", FALLBACK_SWIM_CONFIG.buoyancyAccelerationMps2, 0, 100),
      maxBuoyancyAccelerationMps2: numberAt(swimming, "max_buoyancy_acceleration_mps2", FALLBACK_SWIM_CONFIG.maxBuoyancyAccelerationMps2, 0.1, 200),
      horizontalDragPerSecond: numberAt(swimming, "horizontal_drag_per_second", FALLBACK_SWIM_CONFIG.horizontalDragPerSecond, 0, 30),
      verticalDragPerSecond: numberAt(swimming, "vertical_drag_per_second", FALLBACK_SWIM_CONFIG.verticalDragPerSecond, 0, 30),
      flowInfluence: numberAt(swimming, "flow_influence", FALLBACK_SWIM_CONFIG.flowInfluence, 0, 4),
      shoreEpsilonM: numberAt(swimming, "shore_epsilon_m", FALLBACK_SWIM_CONFIG.shoreEpsilonM, 0, 1),
    };
  } catch (error) {
    console.warn("[player] failed to parse swimming config; using fallback", error);
    return { ...FALLBACK_SWIM_CONFIG };
  }
}

export const defaultSwimConfig: Readonly<SwimConfig> = Object.freeze(parseSwimConfig());
