import * as THREE from "three";
import type { FirstPersonWeapon } from "./first_person_weapon.js";
import { AttackPhase, type CombatConfig, type AttackState, DEFAULT_COMBAT_CONFIG } from "./sword_attack_types.js";

export interface SwordAttackControllerDeps {
  camera: THREE.PerspectiveCamera;
  weapon: FirstPersonWeapon;
}

export interface SwordAttackController {
  readonly state: AttackState;
  readonly config: CombatConfig;
  trigger(): boolean;
  update(timeMs: number): void;
  getConfig(): CombatConfig;
  setConfig(config: Partial<CombatConfig>): void;
}

export function createSwordAttackController(deps: SwordAttackControllerDeps): SwordAttackController {
  const config: CombatConfig = { ...DEFAULT_COMBAT_CONFIG };
  const state: AttackState = { phase: AttackPhase.Idle, phaseStartMs: 0, hitDelivered: false };

  function trigger(): boolean {
    if (state.phase !== AttackPhase.Idle) return false;
    state.phase = AttackPhase.Windup;
    state.phaseStartMs = performance.now();
    state.hitDelivered = false;
    return true;
  }

  function update(timeMs: number) {
    if (state.phase === AttackPhase.Idle) return;

    const elapsed = timeMs - state.phaseStartMs;

    switch (state.phase) {
      case AttackPhase.Windup: {
        const t = Math.min(elapsed / config.windup_ms, 1);
        deps.weapon.swingProgress(-t * 0.3);
        if (elapsed >= config.windup_ms) {
          state.phase = AttackPhase.Active;
          state.phaseStartMs = timeMs;
        }
        break;
      }
      case AttackPhase.Active: {
        const t = Math.min(elapsed / config.active_ms, 1);
        deps.weapon.swingProgress(-0.3 + t * 0.8);
        if (!state.hitDelivered) {
          doHitCheck();
          state.hitDelivered = true;
        }
        if (elapsed >= config.active_ms) {
          state.phase = AttackPhase.Recovery;
          state.phaseStartMs = timeMs;
        }
        break;
      }
      case AttackPhase.Recovery: {
        const t = Math.min(elapsed / config.recovery_ms, 1);
        deps.weapon.swingProgress(0.5 - t * 0.5);
        if (elapsed >= config.recovery_ms) {
          state.phase = AttackPhase.Idle;
          deps.weapon.resetPose();
        }
        break;
      }
    }
  }

  function doHitCheck() {
    const origin = new THREE.Vector3();
    const forward = new THREE.Vector3();
    deps.camera.getWorldPosition(origin);
    deps.camera.getWorldDirection(forward);

    const range = config.range_m;

    console.log(
      `[Combat] Sword attack range=${range}m arc=${config.arc_degrees}°`,
      `origin=(${origin.x.toFixed(2)}, ${origin.y.toFixed(2)}, ${origin.z.toFixed(2)})`,
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
    },
  };
}
