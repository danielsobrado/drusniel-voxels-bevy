import * as THREE from "three";
import type { EarthSpellVfxConfig, SpellColor } from "./spell_config.js";
import { createEarthNodeMaterial, type EarthNodeMaterialHandle } from "./earth_node_material.js";
import { createEarthDustNodeMaterial, type EarthDustNodeMaterialHandle } from "./earth_dust_node_material.js";
import { createEarthDustParticleSystem } from "./earth_dust_particles.js";

const EARTH_DECAL_Y_BIAS = 0.035;
const DUST_LAYER_MIN_COUNT = 8;
const DUST_LAYER_MAX_COUNT = 18;
const DUST_LAYER_DENSITY = 3.0;
const SHARD_GOLDEN_ANGLE = 2.399963229728653;
const SHARD_BASE_RADIUS_RATIO = 0.18;
const SHARD_OUT_RADIUS_RATIO = 0.82;
const SHARD_MIN_SCALE = 0.45;
const SHARD_MAX_SCALE = 1.25;

export interface EarthSpellTarget {
  point: THREE.Vector3;
  normal?: THREE.Vector3;
}

export interface EarthSpellVfxDeps {
  scene: THREE.Scene;
  config: EarthSpellVfxConfig;
  getTarget: () => EarthSpellTarget | null;
  getCamera?: () => THREE.Camera;
  now?: () => number;
}

export interface EarthSpellVfx {
  play: (durationMs: number) => boolean;
  update: (nowMs: number) => void;
  dispose: () => void;
}

interface ShardState {
  angle: number;
  startRadius: number;
  endRadius: number;
  height: number;
  scale: number;
  spin: number;
  tilt: number;
}

interface DustLayerState {
  mesh: THREE.Mesh;
  handle: EarthDustNodeMaterialHandle;
  angle: number;
  startRadius: number;
  endRadius: number;
  rise: number;
  size: number;
  yaw: number;
  wobble: number;
}

interface EarthSpellState {
  active: boolean;
  startMs: number;
  durationMs: number;
  center: THREE.Vector3;
  normal: THREE.Vector3;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function computeEarthSpellFrame(
  startMs: number,
  durationMs: number,
  nowMs: number,
): { active: boolean; progress: number; timeSeconds: number } {
  const elapsed = nowMs - startMs;
  const progress = elapsed / Math.max(1, durationMs);
  return { active: progress < 1, progress, timeSeconds: elapsed / 1000 };
}

export function computeEarthLightEnvelope(progress: number): number {
  const p = clamp01(progress);
  return smoothstep(0.0, 0.12, p) * (1 - smoothstep(0.62, 1.0, p));
}

function spellColor(color: SpellColor): THREE.Color {
  return new THREE.Color(color[0], color[1], color[2]);
}

function makeGroundQuat(normal: THREE.Vector3): THREE.Quaternion {
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
}

function seeded01(index: number, salt: number): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function makeShardStates(config: EarthSpellVfxConfig): ShardState[] {
  const count = Math.max(0, Math.floor(config.shardCount));
  const span = Math.max(0, config.shardMaxHeight - config.shardMinHeight);
  return Array.from({ length: count }, (_, i) => {
    const n = count <= 1 ? 0 : i / (count - 1);
    const rnd = seeded01(i, 0.0);
    return {
      angle: i * SHARD_GOLDEN_ANGLE + rnd * 0.35,
      startRadius: config.impactRadius * (SHARD_BASE_RADIUS_RATIO + rnd * 0.24),
      endRadius: config.impactRadius * (SHARD_OUT_RADIUS_RATIO + rnd * 0.38),
      height: config.shardMinHeight + span * (0.25 + 0.75 * ((n + rnd) % 1)),
      scale: SHARD_MIN_SCALE + (SHARD_MAX_SCALE - SHARD_MIN_SCALE) * rnd,
      spin: 1.5 + rnd * 4.5,
      tilt: 0.25 + rnd * 0.65,
    };
  });
}

function makeDustLayers(scene: THREE.Scene, config: EarthSpellVfxConfig, geometry: THREE.PlaneGeometry): DustLayerState[] {
  const count = Math.min(DUST_LAYER_MAX_COUNT, Math.max(DUST_LAYER_MIN_COUNT, Math.round(config.dustRadius * DUST_LAYER_DENSITY)));
  return Array.from({ length: count }, (_, i) => {
    const rndA = seeded01(i, 1.0);
    const rndB = seeded01(i, 2.0);
    const rndC = seeded01(i, 3.0);
    const handle = createEarthDustNodeMaterial({ seed: i * 17.17 + 3.1, opacity: 0.40 + rndC * 0.24 });
    const mesh = new THREE.Mesh(geometry, handle.material);
    mesh.name = `earth-spell-dust-${i}`;
    mesh.frustumCulled = false;
    mesh.renderOrder = 4100 + i;
    mesh.visible = false;
    scene.add(mesh);
    return {
      mesh,
      handle,
      angle: i * SHARD_GOLDEN_ANGLE + rndA * 0.55,
      startRadius: config.impactRadius * (0.15 + rndA * 0.20),
      endRadius: config.dustRadius * (0.55 + rndB * 0.50),
      rise: 0.75 + rndC * 1.85,
      size: config.dustRadius * (0.34 + rndB * 0.42),
      yaw: i * SHARD_GOLDEN_ANGLE + rndC * Math.PI,
      wobble: 0.18 + rndA * 0.42,
    };
  });
}

export function createEarthSpellVfx(deps: EarthSpellVfxDeps): EarthSpellVfx {
  const { scene, config } = deps;
  const now = deps.now ?? (() => performance.now());
  const materialHandle: EarthNodeMaterialHandle = createEarthNodeMaterial();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), materialHandle.material);
  ground.name = "earth-spell-ground";
  ground.frustumCulled = false;
  ground.renderOrder = 3900;
  ground.visible = false;
  ground.scale.set(config.crackRadius * 2, config.crackRadius * 2, 1);
  scene.add(ground);

  const dustGeometry = new THREE.PlaneGeometry(1, 1);
  const dustLayers = makeDustLayers(scene, config, dustGeometry);
  const dustParticles = createEarthDustParticleSystem({ scene, config, getCamera: deps.getCamera });

  const shardGeometry = new THREE.ConeGeometry(0.18, 0.72, 5, 1);
  const shardMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.28, 0.19, 0.12),
    roughness: 0.92,
    metalness: 0.0,
    transparent: true,
    opacity: 1.0,
  });
  const shards = new THREE.InstancedMesh(shardGeometry, shardMaterial, Math.max(0, Math.floor(config.shardCount)));
  shards.name = "earth-spell-shards";
  shards.frustumCulled = false;
  shards.visible = false;
  scene.add(shards);

  const light = new THREE.PointLight(spellColor(config.glowColor), 0, config.glowDistance, config.glowDecay);
  light.name = "earth-spell-glow";
  light.visible = false;
  scene.add(light);

  const shardStates = makeShardStates(config);
  const state: EarthSpellState = {
    active: false,
    startMs: 0,
    durationMs: 1,
    center: new THREE.Vector3(),
    normal: new THREE.Vector3(0, 1, 0),
  };
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const axis = new THREE.Vector3();

  const hide = (): void => {
    state.active = false;
    ground.visible = false;
    shards.visible = false;
    for (const dust of dustLayers) dust.mesh.visible = false;
    dustParticles.hide();
    light.visible = false;
    light.intensity = 0;
  };

  const updateDust = (progress: number, timeSeconds: number): void => {
    const dustProgress = clamp01(progress * 1.18);
    const travel = smoothstep(0.0, 0.78, dustProgress);
    const fade = 1 - smoothstep(0.60, 1.0, dustProgress);
    const lift = smoothstep(0.0, 0.58, dustProgress);
    for (const dust of dustLayers) {
      const radius = THREE.MathUtils.lerp(dust.startRadius, dust.endRadius, travel);
      const wobble = Math.sin(timeSeconds * 3.2 + dust.angle * 2.7) * dust.wobble;
      dust.mesh.position.set(
        state.center.x + Math.cos(dust.angle) * (radius + wobble),
        state.center.y + 0.38 + lift * dust.rise,
        state.center.z + Math.sin(dust.angle) * (radius + wobble),
      );
      dust.mesh.rotation.set(0.04 * Math.sin(timeSeconds + dust.angle), dust.yaw + timeSeconds * 0.18, 0.10 * Math.cos(timeSeconds * 0.8 + dust.angle));
      const width = dust.size * (0.72 + travel * 0.62);
      const height = dust.size * (0.48 + lift * 0.72);
      dust.mesh.scale.set(width, height, 1);
      dust.mesh.visible = fade > 0.015;
      dust.handle.uTime.value = timeSeconds;
      dust.handle.uProgress.value = progress;
    }
  };

  const updateShards = (progress: number): void => {
    const shardProgress = clamp01(progress * state.durationMs / Math.max(1, config.shardLifetimeMs));
    const lift = Math.sin(shardProgress * Math.PI);
    const travel = smoothstep(0.0, 0.86, shardProgress);
    const fade = 1 - smoothstep(0.68, 1.0, shardProgress);
    shardMaterial.opacity = fade;
    shards.visible = fade > 0.01 && shardStates.length > 0;

    for (let i = 0; i < shardStates.length; i++) {
      const shard = shardStates[i]!;
      const radius = THREE.MathUtils.lerp(shard.startRadius, shard.endRadius, travel);
      position.set(
        state.center.x + Math.cos(shard.angle) * radius,
        state.center.y + EARTH_DECAL_Y_BIAS + lift * shard.height,
        state.center.z + Math.sin(shard.angle) * radius,
      );
      axis.set(Math.cos(shard.angle + Math.PI * 0.5), 0, Math.sin(shard.angle + Math.PI * 0.5)).normalize();
      rotation.setFromAxisAngle(axis, shard.tilt + shard.spin * shardProgress);
      scale.setScalar(shard.scale * (0.75 + 0.25 * fade));
      matrix.compose(position, rotation, scale);
      shards.setMatrixAt(i, matrix);
    }
    shards.instanceMatrix.needsUpdate = true;
  };

  return {
    play: (durationMs) => {
      const target = deps.getTarget();
      if (!target) return false;
      state.center.copy(target.point);
      state.normal.copy(target.normal ?? new THREE.Vector3(0, 1, 0)).normalize();
      state.startMs = now();
      state.durationMs = Math.max(1, durationMs);
      state.active = true;
      materialHandle.uTime.value = 0;
      materialHandle.uProgress.value = 0;

      ground.position.copy(state.center).addScaledVector(state.normal, EARTH_DECAL_Y_BIAS);
      ground.quaternion.copy(makeGroundQuat(state.normal));
      ground.visible = true;
      for (const dust of dustLayers) dust.mesh.visible = true;
      dustParticles.spawn(state.center, state.normal);
      light.position.copy(state.center).addScaledVector(state.normal, 1.2);
      light.visible = true;
      shards.visible = shardStates.length > 0;
      return true;
    },
    update: (nowMs) => {
      if (!state.active) return;
      const frame = computeEarthSpellFrame(state.startMs, state.durationMs, nowMs);
      if (!frame.active) {
        hide();
        return;
      }
      materialHandle.uTime.value = frame.timeSeconds;
      materialHandle.uProgress.value = frame.progress;
      light.intensity = config.glowIntensity * computeEarthLightEnvelope(frame.progress);
      updateDust(frame.progress, frame.timeSeconds);
      dustParticles.update(frame.timeSeconds, frame.progress);
      updateShards(frame.progress);
    },
    dispose: () => {
      scene.remove(ground);
      scene.remove(shards);
      scene.remove(light);
      for (const dust of dustLayers) {
        scene.remove(dust.mesh);
        dust.handle.material.dispose();
      }
      dustParticles.dispose();
      ground.geometry.dispose();
      materialHandle.material.dispose();
      dustGeometry.dispose();
      shardGeometry.dispose();
      shardMaterial.dispose();
    },
  };
}
