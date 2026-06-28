export enum AttackPhase {
  Idle = 0,
  Windup = 1,
  Active = 2,
  Recovery = 3,
}

export interface CombatConfig {
  model_path: string;
  cooldown_ms: number;
  windup_ms: number;
  active_ms: number;
  recovery_ms: number;
  range_m: number;
  arc_degrees: number;
  damage: number;
  camera_offset: [number, number, number];
}

const FIRST_PERSON_SWORD_MODEL_PATH = "assets/combat/quaternius/rpg_items/models/sword_01.glb";

export const DEFAULT_COMBAT_CONFIG: CombatConfig = {
  model_path: FIRST_PERSON_SWORD_MODEL_PATH,
  cooldown_ms: 650,
  windup_ms: 120,
  active_ms: 130,
  recovery_ms: 400,
  range_m: 2.2,
  arc_degrees: 75,
  damage: 25,
  camera_offset: [0.35, -0.38, -0.65],
};

export interface AttackState {
  phase: AttackPhase;
  phaseStartMs: number;
  cooldownUntilMs: number;
  hitDelivered: boolean;
}
