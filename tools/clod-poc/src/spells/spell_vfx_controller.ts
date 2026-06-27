import * as THREE from "three";
import { createPropBillboardGeometry } from "../props/prop_billboard.js";
import { createFireNodeMaterial, type SpellNodeMaterialHandle } from "./fire_node_material.js";
import { createWaterNodeMaterial } from "./water_node_material.js";
import type { FireSpellVfxConfig } from "./spell_config.js";

export interface SpellVfxMeshConfig {
  worldWidth: number;
  worldHeight: number;
  flameScale: number;
}

/** Caster pose: the flame base (hand) and the direction the jet travels. */
export interface SpellPose {
  base: THREE.Vector3;
  dir: THREE.Vector3;
}

export interface SpellPoseDeps {
  camera: THREE.PerspectiveCamera;
  vfx: FireSpellVfxConfig;
}

/**
 * Resolves the caster pose each frame from the camera. The flame base sits at a
 * hand offset (forward + to the side + down) from the eye, and the jet travels
 * along the aim (look) direction — so the spell shoots forward from the hand and
 * follows where the player looks. Camera-relative, so it works in player and
 * orbit modes alike.
 */
export function createSpellPoseResolver(deps: SpellPoseDeps): () => SpellPose {
  const { camera, vfx } = deps;
  const worldUp = new THREE.Vector3(0, 1, 0);
  const aim = new THREE.Vector3();
  const right = new THREE.Vector3();
  const camUp = new THREE.Vector3();
  const base = new THREE.Vector3();
  const dir = new THREE.Vector3();
  return () => {
    camera.getWorldDirection(aim).normalize();
    right.crossVectors(aim, worldUp);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    else right.normalize();
    camUp.crossVectors(right, aim).normalize();
    base.copy(camera.position)
      .addScaledVector(aim, vfx.handForwardM)
      .addScaledVector(right, vfx.handRightM)
      .addScaledVector(camUp, vfx.handUpM);
    dir.copy(aim);
    return { base, dir };
  };
}

/**
 * Orientation for a beam-style billboard: local +Y (geometry base→tip) aligns
 * with `dir`, and the quad rolls around that axis so its face turns toward the
 * camera. Falls back to an arbitrary perpendicular when the camera sits exactly
 * on the jet axis (degenerate roll).
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
  /** Active render camera (read each frame for billboarding). */
  getCamera: () => THREE.Camera;
  /** Caster pose (hand position + jet direction), re-resolved each frame. */
  getPose: () => SpellPose;
  fire: SpellVfxMeshConfig;
  water: SpellVfxMeshConfig;
  /** Clock source; defaults to performance.now. Injectable for tests. */
  now?: () => number;
}

export interface SpellVfxController {
  playFire: (durationMs: number) => void;
  playWater: (durationMs: number) => void;
  /** Drive active spells; call once per frame with a performance.now() timestamp. */
  update: (nowMs: number) => void;
  dispose: () => void;
}

interface SpellState {
  mesh: THREE.Mesh;
  handle: SpellNodeMaterialHandle;
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

/**
 * Owns the in-scene fire/water billboards. Each spell is a single beam-style
 * quad anchored at the caster's hand, its long axis along the aim direction so
 * the jet shoots forward, drawn only while a cast is active. Depth-tested so
 * terrain occludes it; depth-write off so the flame blends without
 * self-occlusion.
 */
export function createSpellVfxController(deps: SpellVfxControllerDeps): SpellVfxController {
  const { scene, getCamera, getPose } = deps;
  const now = deps.now ?? (() => performance.now());

  const buildSpell = (name: string, handle: SpellNodeMaterialHandle, cfg: SpellVfxMeshConfig): SpellState => {
    const geometry = createPropBillboardGeometry(cfg.worldWidth * cfg.flameScale, cfg.worldHeight * cfg.flameScale);
    const mesh = new THREE.Mesh(geometry, handle.material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.renderOrder = 4000;
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, handle, startMs: 0, durationMs: 0, active: false };
  };

  const fire = buildSpell("fire-spell", createFireNodeMaterial(), deps.fire);
  const water = buildSpell("water-spell", createWaterNodeMaterial(), deps.water);

  const start = (spell: SpellState, durationMs: number): void => {
    spell.startMs = now();
    spell.durationMs = Math.max(1, durationMs);
    spell.active = true;
    spell.handle.uTime.value = 0;
    spell.handle.uProgress.value = 0;
    spell.mesh.visible = true;
  };

  const tick = (spell: SpellState, nowMs: number): void => {
    if (!spell.active) return;
    const frame = computeSpellFrame(spell.startMs, spell.durationMs, nowMs);
    if (!frame.active) {
      spell.active = false;
      spell.mesh.visible = false;
      return;
    }
    spell.handle.uTime.value = frame.timeSeconds;
    spell.handle.uProgress.value = frame.progress;
    const pose = getPose();
    spell.mesh.position.copy(pose.base);
    orientFireJet(pose.base, pose.dir, getCamera().position, spell.mesh.quaternion);
  };

  return {
    playFire: (durationMs) => start(fire, durationMs),
    playWater: (durationMs) => start(water, durationMs),
    update: (nowMs) => {
      tick(fire, nowMs);
      tick(water, nowMs);
    },
    dispose: () => {
      for (const spell of [fire, water]) {
        scene.remove(spell.mesh);
        spell.mesh.geometry.dispose();
        spell.handle.material.dispose();
      }
    },
  };
}
