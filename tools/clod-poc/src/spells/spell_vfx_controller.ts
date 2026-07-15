import * as THREE from "three";
import { createPropBillboardGeometry } from "../props/prop_billboard.js";
import { createFireNodeMaterial, type SpellNodeMaterialHandle } from "./fire_node_material.js";
import { createWaterNodeMaterial } from "./water_node_material.js";
import { createAirNodeMaterial } from "./air_node_material.js";
import { createEarthSpellVfx, type EarthSpellTarget } from "./earth_spell_vfx.js";
import { createLightningSpellVfx, type LightningSpellTarget } from "./lightning_spell_vfx.js";
import { createFireballSpellVfx, type FireballTerrainHit } from "./fireball_spell_vfx.js";
import type {
  EarthSpellVfxConfig,
  FireballSpellVfxConfig,
  FireSpellVfxConfig,
  LightningSpellVfxConfig,
  SpellColor,
} from "./spell_config.js";

const SPELL_LIGHT_ENVELOPE = {
  castInEnd: 0.12,
  castOutStart: 0.72,
  pulseStrength: 0.08,
  pulseCycles: 8.0,
} as const;

const SPELL_VISIBLE_PROGRESS_FLOOR = 0.035;
const SPELL_SELF_TICK_PAD_MS = 120;
const FALLBACK_BASE_OPACITY = 0.72;
const ENABLE_VISIBLE_FALLBACK = false;

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

export function createSpellPoseResolver(deps: SpellPoseDeps): () => SpellPose {
  const scratch = createPoseScratch();
  return () => resolveSpellPose(deps.camera, deps.vfx, scratch);
}

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
  getCamera: () => THREE.Camera;
  fire: SpellVfxMeshConfig;
  water: SpellVfxMeshConfig;
  air: SpellVfxMeshConfig;
  earth: EarthSpellVfxConfig;
  getEarthTarget: () => EarthSpellTarget | null;
  lightning?: LightningSpellVfxConfig;
  getLightningTarget?: () => LightningSpellTarget | null;
  fireball?: FireballSpellVfxConfig;
  raycastFireballTerrain?: (ray: THREE.Ray) => FireballTerrainHit | null;
  now?: () => number;
}

export interface SpellVfxController {
  playFire: (durationMs: number) => void;
  playWater: (durationMs: number) => void;
  playAir: (durationMs: number) => void;
  playEarth: (durationMs: number) => void;
  playLightning: (durationMs: number) => void;
  playFireball: (durationMs: number) => void;
  update: (nowMs?: number) => void;
  dispose: () => void;
}

interface SpellState {
  mesh: THREE.Mesh;
  fallbackMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  light: THREE.PointLight;
  baseLightIntensity: number;
  handle: SpellNodeMaterialHandle;
  config: SpellVfxMeshConfig;
  poseScratch: SpellPoseScratch;
  startMs: number;
  durationMs: number;
  active: boolean;
}

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

function createFallbackSpellMaterial(color: SpellColor): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    name: "spell-visible-fallback",
    color: spellLightColor(color),
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}

export function createSpellVfxController(deps: SpellVfxControllerDeps): SpellVfxController {
  const { scene, getCamera } = deps;
  const now = deps.now ?? (() => performance.now());
  let rafId = 0;
  let selfTickUntilMs = 0;
  let disposed = false;

  const buildSpell = (
    name: string,
    handle: SpellNodeMaterialHandle,
    config: SpellVfxMeshConfig,
  ): SpellState => {
    const geometry = createPropBillboardGeometry(config.worldWidth * config.flameScale, config.worldHeight * config.flameScale);
    handle.material.transparent = true;
    handle.material.depthWrite = false;
    handle.material.depthTest = false;
    handle.material.side = THREE.DoubleSide;
    handle.material.toneMapped = false;

    const mesh = new THREE.Mesh(geometry, handle.material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.renderOrder = 4000;
    mesh.visible = false;

    const fallbackMaterial = createFallbackSpellMaterial(config.glowColor);
    const fallbackMesh = new THREE.Mesh(geometry, fallbackMaterial);
    fallbackMesh.name = `${name}-fallback`;
    fallbackMesh.frustumCulled = false;
    fallbackMesh.renderOrder = 4001;
    fallbackMesh.visible = false;

    const light = new THREE.PointLight(spellLightColor(config.glowColor), 0, config.glowDistance, config.glowDecay);
    light.name = `${name}-glow`;
    light.position.set(0, config.worldHeight * config.flameScale * config.glowLocalYRatio, 0);
    light.visible = false;
    mesh.add(light);

    scene.add(mesh);
    scene.add(fallbackMesh);
    return {
      mesh,
      fallbackMesh,
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
  const earth = createEarthSpellVfx({ scene, config: deps.earth, getTarget: deps.getEarthTarget, getCamera, now });
  const lightningConfig = deps.lightning;
  const lightningPoseScratch = createPoseScratch();
  const lightning = lightningConfig ? createLightningSpellVfx({
    scene,
    config: lightningConfig,
    getCamera,
    getSource: () => {
      const pose = resolveSpellPose(getCamera(), lightningConfig, lightningPoseScratch);
      return { point: pose.base, direction: pose.dir };
    },
    getTarget: deps.getLightningTarget ?? (() => null),
    now,
  }) : null;
  const fireballConfig = deps.fireball;
  const fireballPoseScratch = createPoseScratch();
  const fireball = fireballConfig && deps.raycastFireballTerrain ? createFireballSpellVfx({
    scene,
    config: fireballConfig,
    getSource: () => {
      const pose = resolveSpellPose(getCamera(), fireballConfig, fireballPoseScratch);
      return { point: pose.base, direction: pose.dir };
    },
    raycastTerrain: deps.raycastFireballTerrain,
    now,
  }) : null;
  const spells = [fire, water, air];

  const hasActiveSpells = (): boolean => spells.some((spell) => spell.active) || now() < selfTickUntilMs;

  const tick = (spell: SpellState, nowMs: number): void => {
    if (!spell.active) return;
    const frame = computeSpellFrame(spell.startMs, spell.durationMs, nowMs);
    if (!frame.active) {
      spell.active = false;
      spell.light.intensity = 0;
      spell.light.visible = false;
      spell.mesh.visible = false;
      spell.fallbackMesh.visible = false;
      spell.fallbackMesh.material.opacity = 0;
      return;
    }

    const visibleProgress = Math.max(frame.progress, SPELL_VISIBLE_PROGRESS_FLOOR);
    spell.handle.uTime.value = frame.timeSeconds;
    spell.handle.uProgress.value = visibleProgress;
    spell.light.intensity = spell.baseLightIntensity * computeSpellLightEnvelope(visibleProgress);

    const camera = getCamera();
    const pose = resolveSpellPose(camera, spell.config, spell.poseScratch);
    spell.mesh.position.copy(pose.base);
    orientFireJet(pose.base, pose.dir, camera.position, spell.mesh.quaternion);

    if (ENABLE_VISIBLE_FALLBACK) {
      spell.fallbackMesh.visible = true;
      spell.fallbackMesh.material.opacity = FALLBACK_BASE_OPACITY * computeSpellLightEnvelope(visibleProgress);
      spell.fallbackMesh.scale.setScalar(1 + Math.sin(frame.timeSeconds * 12) * 0.04);
      spell.fallbackMesh.position.copy(pose.base);
      spell.fallbackMesh.quaternion.copy(spell.mesh.quaternion);
    } else {
      spell.fallbackMesh.visible = false;
      spell.fallbackMesh.material.opacity = 0;
    }
  };

  const updateAll = (frameNow: number): void => {
    if (disposed) return;
    for (const spell of spells) tick(spell, frameNow);
    earth.update(frameNow);
    lightning?.update(frameNow);
    fireball?.update(frameNow);
  };

  const requestSelfTick = (): void => {
    if (disposed || rafId !== 0 || typeof requestAnimationFrame !== "function") return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      updateAll(now());
      if (hasActiveSpells()) requestSelfTick();
    });
  };

  const start = (spell: SpellState, durationMs: number): void => {
    const startMs = now();
    spell.startMs = startMs;
    spell.durationMs = Math.max(1, durationMs);
    spell.active = true;
    spell.handle.uTime.value = 0;
    spell.handle.uProgress.value = SPELL_VISIBLE_PROGRESS_FLOOR;
    spell.light.intensity = spell.baseLightIntensity * computeSpellLightEnvelope(SPELL_VISIBLE_PROGRESS_FLOOR);
    spell.light.visible = true;
    spell.mesh.visible = true;
    if (ENABLE_VISIBLE_FALLBACK) {
      spell.fallbackMesh.visible = true;
      spell.fallbackMesh.material.opacity = FALLBACK_BASE_OPACITY;
      spell.fallbackMesh.scale.setScalar(1);
    } else {
      spell.fallbackMesh.visible = false;
      spell.fallbackMesh.material.opacity = 0;
    }
    tick(spell, startMs + 16);
    selfTickUntilMs = Math.max(selfTickUntilMs, startMs + spell.durationMs + SPELL_SELF_TICK_PAD_MS);
    requestSelfTick();
  };

  const playStandalone = (play: (durationMs: number) => void, durationMs: number): void => {
    const startMs = now();
    play(durationMs);
    selfTickUntilMs = Math.max(selfTickUntilMs, startMs + Math.max(1, durationMs) + SPELL_SELF_TICK_PAD_MS);
    requestSelfTick();
  };

  return {
    playFire: (durationMs) => start(fire, durationMs),
    playWater: (durationMs) => start(water, durationMs),
    playAir: (durationMs) => start(air, durationMs),
    playEarth: (durationMs) => playStandalone(earth.play, durationMs),
    playLightning: (durationMs) => {
      if (lightning) playStandalone(lightning.play, durationMs);
    },
    playFireball: (durationMs) => {
      if (fireball) playStandalone(fireball.play, durationMs);
    },
    update: (nowMs) => updateAll(typeof nowMs === "number" && nowMs > 1000 ? nowMs : now()),
    dispose: () => {
      disposed = true;
      if (rafId !== 0 && typeof cancelAnimationFrame === "function") cancelAnimationFrame(rafId);
      rafId = 0;
      for (const spell of spells) {
        scene.remove(spell.mesh);
        scene.remove(spell.fallbackMesh);
        spell.mesh.geometry.dispose();
        spell.handle.material.dispose();
        spell.fallbackMesh.material.dispose();
      }
      earth.dispose();
      lightning?.dispose();
      fireball?.dispose();
    },
  };
}
