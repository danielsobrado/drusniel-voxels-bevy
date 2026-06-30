import * as THREE from "three";
import { createPropBillboardGeometry } from "../props/prop_billboard.js";
import { createFireNodeMaterial, type SpellNodeMaterialHandle } from "./fire_node_material.js";
import { createWaterNodeMaterial } from "./water_node_material.js";
import { createAirNodeMaterial } from "./air_node_material.js";
import type { FireSpellVfxConfig, SpellColor } from "./spell_config.js";

const SPELL_LIGHT_ENVELOPE = {
  castInEnd: 0.12,
  castOutStart: 0.72,
  pulseStrength: 0.08,
  pulseCycles: 8.0,
} as const;

export interface SpellVfxMeshConfig {
  worldWidth: number;
  worldHeight: number;
  flameScale: number;
  handForwardM: number;
  handRightM: number;
  handUpM: number;
  glowColor: SpellColor;
  glowIntensity: number;
  glowDistance: number;
  glowDecay: number;
  glowLocalYRatio: number;
}

/** Caster pose: the spell base (hand) and the direction the jet travels. */
export interface SpellPose {
  base: THREE.Vector3;
  dir: THREE.Vector3;
}

export interface SpellPoseDeps {
  camera: THREE.Camera;
  vfx: Pick<FireSpellVfxConfig, "handForwardM" | "handRightM" | "handUpM">;
}

interface SpellPoseScratch {
  worldUp: THREE.Vector3;
  aim: THREE.Vector3;
  right: THREE.Vector3;
  camUp: THREE.Vector3;
  base: THREE.Vector3;
  dir: THREE.Vector3;
}

function createPoseScratch(): SpellPoseScratch {
  return {
    worldUp: new THREE.Vector3(0, 1, 0),
    aim: new THREE.Vector3(),
    right: new THREE.Vector3(),
    camUp: new THREE.Vector3(),
    base: new THREE.Vector3(),
    dir: new THREE.Vector3(),
  };
}

export function resolveSpellPose(camera: THREE.Camera, vfx: SpellPoseDeps["vfx"], scratch = createPoseScratch()): SpellPose {
  camera.getWorldDirection(scratch.aim).normalize();
  scratch.right.crossVectors(scratch.aim, scratch.worldUp);
  if (scratch.right.lengthSq() < 1e-6) scratch.right.set(1, 0, 0);
  else scratch.right.normalize();
  scratch.camUp.crossVectors(scratch.right, scratch.aim).normalize();
  scratch.base.copy(camera.position)
    .addScaledVector(scratch.aim, vfx.handForwardM)
    .addScaledVector(scratch.right, vfx.handRightM)
    .addScaledVector(scratch.camUp, vfx.handUpM);
  scratch.dir.copy(scratch.aim);
  return { base: scratch.base, dir: scratch.dir };
}

/** Resolves the caster pose each frame from the camera and spell hand offset. */
export function createSpellPoseResolver(deps: SpellPoseDeps): () => SpellPose {
  const scratch = createPoseScratch();
  return () => resolveSpellPose(deps.camera, deps.vfx, scratch);
}

/**
 * Orientation for a beam-style billboard: local +Y (geometry base→tip) aligns
 * with `dir`, and the quad rolls around that axis so its face turns toward the
 * camera.
 */
export function orientFireJet(
  base: THREE.Vector3,
  dir: THREE.Vector3,
  camPos: THREE.Vector3,
  target?: THREE.Quaternion,
): THREE.Quaternion {
  const yAxis = dir.clone().normalize();
  const camToBase = camPos.clone().sub(base);
  const zAxis = camToBase.clone().addScaledVector(yAxis, -camToBase.dot(yAxis));
  if (zAxis.lengthSq() < 1e-8) {
    zAxis.copy(Math.abs(yAxis.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0));
    zAxis.addScaledVector(yAxis, -zAxis.dot(yAxis));
  }
  zAxis.normalize();
  const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
  zAxis.crossVectors(xAxis, yAxis).normalize();
  const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  return (target ?? new THREE.Quaternion()).setFromRotationMatrix(m);
}

export interface SpellVfxControllerDeps {
  scene: THREE.Scene;
  /** Active render camera (read each frame for billboarding and pose). */
  getCamera: () => THREE.Camera;
  fire: SpellVfxMeshConfig;
  water: SpellVfxMeshConfig;
  air: SpellVfxMeshConfig;
  /** Clock source; defaults to performance.now. Injectable for tests. */
  now?: () => number;
}

export interface SpellVfxController {
  playFire: (durationMs: number) => void;
  playWater: (durationMs: number) => void;
  playAir: (durationMs: number) => void;
  /** Drive active spells; call once per frame with a performance.now() timestamp. */
  update: (nowMs: number) => void;
  dispose: () => void;
}

interface SpellState {
  mesh: THREE.Mesh;
  light: THREE.PointLight;
  baseLightIntensity: number;
  handle: SpellNodeMaterialHandle;
  config: SpellVfxMeshConfig;
  poseScratch: SpellPoseScratch;
  startMs: number;
  durationMs: number;
  active: boolean;
}

/** Lifetime/animation state for an active spell at a given frame time. */
export function computeSpellFrame(
  startMs: number,
  durationMs: number,
  nowMs: number,
): { active: boolean; progress: number; timeSeconds: number } {
  const elapsed = nowMs - startMs;
  const progress = elapsed / Math.max(1, durationMs);
  return { active: progress < 1, progress, timeSeconds: elapsed / 1000 };
}

export function computeSpellLightEnvelope(progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  const castIn = Math.min(1, p / SPELL_LIGHT_ENVELOPE.castInEnd);
  const castOut = 1 - Math.min(1, Math.max(0, (p - SPELL_LIGHT_ENVELOPE.castOutStart) / (1 - SPELL_LIGHT_ENVELOPE.castOutStart)));
  const pulse = 1 - SPELL_LIGHT_ENVELOPE.pulseStrength * 0.5
    + Math.sin(p * Math.PI * 2 * SPELL_LIGHT_ENVELOPE.pulseCycles) * SPELL_LIGHT_ENVELOPE.pulseStrength * 0.5;
  return Math.min(1, Math.max(0, castIn * castOut * pulse));
}

function spellLightColor(color: SpellColor): THREE.Color {
  return new THREE.Color(color[0], color[1], color[2]);
}

/**
 * Owns the in-scene spell billboards. Each spell is a single beam-style quad
 * anchored at that spell's configured hand offset, aimed along the camera.
 */
export function createSpellVfxController(deps: SpellVfxControllerDeps): SpellVfxController {
  const { scene, getCamera } = deps;
  const now = deps.now ?? (() => performance.now());

  const buildSpell = (
    name: string,
    handle: SpellNodeMaterialHandle,
    config: SpellVfxMeshConfig,
  ): SpellState => {
    const geometry = createPropBillboardGeometry(config.worldWidth * config.flameScale, config.worldHeight * config.flameScale);
    const mesh = new THREE.Mesh(geometry, handle.material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.renderOrder = 4000;
    mesh.visible = false;

    const light = new THREE.PointLight(spellLightColor(config.glowColor), 0, config.glowDistance, config.glowDecay);
    light.name = `${name}-glow`;
    light.position.set(0, config.worldHeight * config.flameScale * config.glowLocalYRatio, 0);
    light.visible = false;
    mesh.add(light);

    scene.add(mesh);
    return {
      mesh,
      light,
      baseLightIntensity: config.glowIntensity,
      handle,
      config,
      poseScratch: createPoseScratch(),
      startMs: 0,
      durationMs: 0,
      active: false,
    };
  };

  const fire = buildSpell("fire-spell", createFireNodeMaterial(), deps.fire);
  const water = buildSpell("water-spell", createWaterNodeMaterial(), deps.water);
  const air = buildSpell("air-spell", createAirNodeMaterial(), deps.air);
  const spells = [fire, water, air];

  const start = (spell: SpellState, durationMs: number): void => {
    spell.startMs = now();
    spell.durationMs = Math.max(1, durationMs);
    spell.active = true;
    spell.handle.uTime.value = 0;
    spell.handle.uProgress.value = 0;
    spell.light.intensity = 0;
    spell.light.visible = true;
    spell.mesh.visible = true;
  };

  const tick = (spell: SpellState, nowMs: number): void => {
    if (!spell.active) return;
    const frame = computeSpellFrame(spell.startMs, spell.durationMs, nowMs);
    if (!frame.active) {
      spell.active = false;
      spell.light.intensity = 0;
      spell.light.visible = false;
      spell.mesh.visible = false;
      return;
    }
    spell.handle.uTime.value = frame.timeSeconds;
    spell.handle.uProgress.value = frame.progress;
    spell.light.intensity = spell.baseLightIntensity * computeSpellLightEnvelope(frame.progress);
    const camera = getCamera();
    const pose = resolveSpellPose(camera, spell.config, spell.poseScratch);
    spell.mesh.position.copy(pose.base);
    orientFireJet(pose.base, pose.dir, camera.position, spell.mesh.quaternion);
  };

  return {
    playFire: (durationMs) => start(fire, durationMs),
    playWater: (durationMs) => start(water, durationMs),
    playAir: (durationMs) => start(air, durationMs),
    update: (nowMs) => {
      for (const spell of spells) tick(spell, nowMs);
    },
    dispose: () => {
      for (const spell of spells) {
        scene.remove(spell.mesh);
        spell.mesh.geometry.dispose();
        spell.handle.material.dispose();
      }
    },
  };
}
