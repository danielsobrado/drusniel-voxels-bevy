import * as THREE from "three";
import type { FirstPersonWeapon } from "./first_person_weapon.js";
import { AttackPhase, type CombatConfig, type AttackState, DEFAULT_COMBAT_CONFIG } from "./sword_attack_types.js";

const MIN_PHASE_MS = 1;
const ATTACK_LOG_THROTTLE_MS = 250;

export interface SwordAttackControllerDeps {
  camera: THREE.PerspectiveCamera;
  weapon: FirstPersonWeapon;
  isEnabled?: () => boolean;
}

export interface SwordAttackController {
  readonly state: AttackState;
  readonly config: CombatConfig;
  trigger(timeMs?: number): boolean;
  update(timeMs: number): void;
  getConfig(): CombatConfig;
  setConfig(config: Partial<CombatConfig>): void;
}

export function createSwordAttackController(deps: SwordAttackControllerDeps): SwordAttackController {
  const config: CombatConfig = { ...DEFAULT_COMBAT_CONFIG };
  const state: AttackState = {
    phase: AttackPhase.Idle,
    phaseStartMs: 0,
    cooldownUntilMs: 0,
    hitDelivered: false,
  };
  let lastAttackLogMs = -Infinity;

  function isEnabled(): boolean {
    return deps.isEnabled?.() ?? true;
  }

  function phaseDurationMs(value: number): number {
    return Math.max(MIN_PHASE_MS, value);
  }

  function resetToIdle(timeMs: number): void {
    state.phase = AttackPhase.Idle;
    state.phaseStartMs = timeMs;
    state.hitDelivered = false;
    deps.weapon.resetPose();
  }

  function trigger(timeMs = performance.now()): boolean {
    if (!isEnabled()) return false;
    if (state.phase !== AttackPhase.Idle) return false;
    if (timeMs < state.cooldownUntilMs) return false;
    state.phase = AttackPhase.Windup;
    state.phaseStartMs = timeMs;
    state.cooldownUntilMs = timeMs + Math.max(config.cooldown_ms, 0);
    state.hitDelivered = false;
    return true;
  }

  function update(timeMs: number): void {
    const enabled = isEnabled();
    deps.weapon.setVisible(enabled);
    deps.weapon.update();
    if (!enabled) {
      if (state.phase !== AttackPhase.Idle) resetToIdle(timeMs);
      return;
    }
    if (state.phase === AttackPhase.Idle) return;

    const elapsed = Math.max(0, timeMs - state.phaseStartMs);

    switch (state.phase) {
      case AttackPhase.Windup: {
        const duration = phaseDurationMs(config.windup_ms);
        const t = Math.min(elapsed / duration, 1);
        deps.weapon.swingProgress(-t * 0.3);
        if (elapsed >= duration) {
          state.phase = AttackPhase.Active;
          state.phaseStartMs = timeMs;
        }
        break;
      }
      case AttackPhase.Active: {
        const duration = phaseDurationMs(config.active_ms);
        const t = Math.min(elapsed / duration, 1);
        deps.weapon.swingProgress(-0.3 + t * 0.8);
        if (!state.hitDelivered) {
          doHitCheck(timeMs);
          state.hitDelivered = true;
        }
        if (elapsed >= duration) {
          state.phase = AttackPhase.Recovery;
          state.phaseStartMs = timeMs;
        }
        break;
      }
      case AttackPhase.Recovery: {
        const duration = phaseDurationMs(config.recovery_ms);
        const t = Math.min(elapsed / duration, 1);
        deps.weapon.swingProgress(0.5 - t * 0.5);
        if (elapsed >= duration) resetToIdle(timeMs);
        break;
      }
      case AttackPhase.Idle:
        break;
    }
  }

  function doHitCheck(timeMs: number): void {
    const origin = new THREE.Vector3();
    const forward = new THREE.Vector3();
    deps.camera.getWorldPosition(origin);
    deps.camera.getWorldDirection(forward);

    if (timeMs - lastAttackLogMs < ATTACK_LOG_THROTTLE_MS) return;
    lastAttackLogMs = timeMs;
    console.debug(
      `[combat] sword attack damage=${config.damage} range=${config.range_m}m arc=${config.arc_degrees}°`,
      `origin=(${origin.x.toFixed(2)}, ${origin.y.toFixed(2)}, ${origin.z.toFixed(2)})`,
      `forward=(${forward.x.toFixed(2)}, ${forward.y.toFixed(2)}, ${forward.z.toFixed(2)})`,
    );
  }

  return {
    state,
    config,
    trigger,
    update,
    getConfig() { return { ...config }; },
    setConfig(partial) {
      Object.assign(config, partial);
      config.cooldown_ms = Math.max(0, config.cooldown_ms);
      config.windup_ms = phaseDurationMs(config.windup_ms);
      config.active_ms = phaseDurationMs(config.active_ms);
      config.recovery_ms = phaseDurationMs(config.recovery_ms);
      config.range_m = Math.max(0, config.range_m);
      config.arc_degrees = THREE.MathUtils.clamp(config.arc_degrees, 1, 180);
      config.damage = Math.max(0, config.damage);
    },
  };
}
