import type { SwimConfig } from "./swim_config.js";
import type { WaterSample } from "../water/water_authority.js";

export type SwimMode = "dry" | "surface" | "submerged" | "blocked_unknown";

export interface SwimContactState {
  mode: SwimMode;
  submersionM: number;
  bodyId: string;
  sourceRevision: number;
}

export interface SwimVelocity {
  x: number;
  y: number;
  z: number;
}

export interface SwimForceInput {
  velocity: SwimVelocity;
  desiredX: number;
  desiredZ: number;
  ascend: boolean;
  dive: boolean;
  capsuleBottomY: number;
  sample: WaterSample;
  contact: SwimContactState;
  stepSeconds: number;
  config: Readonly<SwimConfig>;
}

export interface SwimForceResult {
  velocity: SwimVelocity;
  targetSubmersionM: number;
}

export const DRY_SWIM_CONTACT: Readonly<SwimContactState> = Object.freeze({
  mode: "dry",
  submersionM: 0,
  bodyId: "",
  sourceRevision: 0,
});

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function approach(current: number, target: number, maxDelta: number): number {
  return current + clamp(target - current, -maxDelta, maxDelta);
}

function dragFactor(perSecond: number, stepSeconds: number): number {
  return Math.exp(-Math.max(0, perSecond) * Math.max(0, stepSeconds));
}

export function resolveSwimContact(
  previous: SwimContactState,
  sample: WaterSample,
  capsuleBottomY: number,
  capsuleHeight: number,
  config: Readonly<SwimConfig>,
): SwimContactState {
  if (!config.enabled) return { ...DRY_SWIM_CONTACT, sourceRevision: sample.sourceRevision };
  if (sample.state === "unknown") {
    return {
      mode: "blocked_unknown",
      submersionM: previous.submersionM,
      bodyId: previous.bodyId,
      sourceRevision: sample.sourceRevision,
    };
  }
  if (sample.state === "dry") {
    return { ...DRY_SWIM_CONTACT, sourceRevision: sample.sourceRevision };
  }

  const submersionM = clamp(sample.surfaceY - capsuleBottomY, 0, Math.max(0, capsuleHeight));
  const wasSwimming = previous.mode === "surface" || previous.mode === "submerged";
  const active = wasSwimming
    ? submersionM >= config.exitSubmersionM
    : submersionM >= config.enterSubmersionM;
  if (!active) {
    return {
      mode: "dry",
      submersionM,
      bodyId: sample.bodyId,
      sourceRevision: sample.sourceRevision,
    };
  }

  return {
    mode: submersionM >= config.diveSubmersionM ? "submerged" : "surface",
    submersionM,
    bodyId: sample.bodyId,
    sourceRevision: sample.sourceRevision,
  };
}

export function applySwimForces(input: SwimForceInput): SwimForceResult {
  const { config, stepSeconds, sample, contact } = input;
  if (contact.mode !== "surface" && contact.mode !== "submerged") {
    return { velocity: { ...input.velocity }, targetSubmersionM: 0 };
  }

  const desiredLength = Math.hypot(input.desiredX, input.desiredZ);
  const desiredScale = desiredLength > 1e-8 ? config.swimSpeedMps / desiredLength : 0;
  const flowX = sample.flow[0] * config.flowInfluence;
  const flowZ = sample.flow[1] * config.flowInfluence;
  const targetX = input.desiredX * desiredScale + flowX;
  const targetZ = input.desiredZ * desiredScale + flowZ;
  const accelerationStep = config.accelerationMps2 * stepSeconds;
  let velocityX = approach(input.velocity.x, targetX, accelerationStep);
  let velocityZ = approach(input.velocity.z, targetZ, accelerationStep);
  if (desiredLength <= 1e-8) {
    const drag = dragFactor(config.horizontalDragPerSecond, stepSeconds);
    velocityX = flowX + (velocityX - flowX) * drag;
    velocityZ = flowZ + (velocityZ - flowZ) * drag;
  }

  const targetSubmersionM = input.dive ? config.diveSubmersionM : config.surfaceSubmersionM;
  let velocityY = input.velocity.y;
  if (input.ascend && !input.dive) {
    velocityY = approach(velocityY, config.verticalControlSpeedMps, accelerationStep);
  } else if (input.dive) {
    velocityY = approach(velocityY, -config.verticalControlSpeedMps, accelerationStep);
  } else {
    const targetBottomY = sample.surfaceY - targetSubmersionM;
    const displacement = targetBottomY - input.capsuleBottomY;
    const buoyancy = clamp(
      displacement * config.buoyancyAccelerationMps2,
      -config.maxBuoyancyAccelerationMps2,
      config.maxBuoyancyAccelerationMps2,
    );
    velocityY += buoyancy * stepSeconds;
  }
  velocityY *= dragFactor(config.verticalDragPerSecond, stepSeconds);

  return {
    velocity: { x: velocityX, y: velocityY, z: velocityZ },
    targetSubmersionM,
  };
}
