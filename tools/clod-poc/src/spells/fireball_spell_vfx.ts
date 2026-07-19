import * as THREE from "three";
import type { FireballSpellVfxConfig, SpellColor } from "./spell_config.js";
import { createFireballNodeMaterial } from "./fireball_node_material.js";

const COLLISION_STEP_SECONDS = 0.05;
const TRAIL_SPACING_SECONDS = 0.028;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const TRAIL_AXIS = new THREE.Vector3(0, 0, 1);

export interface FireballSource {
  point: THREE.Vector3;
  direction: THREE.Vector3;
}

export interface FireballTerrainHit {
  point: THREE.Vector3;
  distance: number;
  normal?: THREE.Vector3;
}

export interface FireballSpellVfxDeps {
  scene: THREE.Scene;
  config: FireballSpellVfxConfig;
  getSource: () => FireballSource;
  raycastTerrain: (ray: THREE.Ray) => FireballTerrainHit | null;
  now?: () => number;
}

export interface FireballSpellVfx {
  play: (durationMs: number) => void;
  update: (nowMs: number) => void;
  dispose: () => void;
}

interface FireballState {
  phase: "idle" | "flight" | "impact";
  startMs: number;
  durationMs: number;
  previousElapsedSeconds: number;
  impactStartMs: number;
  origin: THREE.Vector3;
  velocity: THREE.Vector3;
}

interface SparkState {
  angle: number;
  speed: number;
  lift: number;
  spin: number;
  size: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function seeded01(index: number, salt: number): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function spellColor(color: SpellColor): THREE.Color {
  return new THREE.Color(color[0], color[1], color[2]);
}

function additiveMaterial(color: SpellColor, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: spellColor(color),
    transparent: true,
    opacity,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexColors: true,
  });
}

export function computeFireballPosition(
  origin: THREE.Vector3,
  velocity: THREE.Vector3,
  gravity: number,
  elapsedSeconds: number,
  target = new THREE.Vector3(),
): THREE.Vector3 {
  const t = Math.max(0, elapsedSeconds);
  return target.copy(origin)
    .addScaledVector(velocity, t)
    .addScaledVector(WORLD_UP, -0.5 * Math.max(0, gravity) * t * t);
}

export function findFireballTerrainImpact(
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  raycastTerrain: FireballSpellVfxDeps["raycastTerrain"],
): FireballTerrainHit | null {
  const delta = end.clone().sub(start);
  const distance = delta.length();
  if (distance <= 1e-6) return null;
  const ray = new THREE.Ray(
    start.clone().addScaledVector(WORLD_UP, -Math.max(0, radius)),
    delta.multiplyScalar(1 / distance),
  );
  const hit = raycastTerrain(ray);
  if (!hit || !Number.isFinite(hit.distance) || hit.distance < 0 || hit.distance > distance + 1e-4) return null;
  return hit;
}

function createSparkStates(count: number): SparkState[] {
  return Array.from({ length: count }, (_, index) => ({
    angle: index * 2.399963229728653 + seeded01(index, 1) * 0.5,
    speed: 3.4 + seeded01(index, 2) * 7.2,
    lift: 3.8 + seeded01(index, 3) * 6.5,
    spin: 2 + seeded01(index, 4) * 8,
    size: 0.045 + seeded01(index, 5) * 0.11,
  }));
}

export function createFireballSpellVfx(deps: FireballSpellVfxDeps): FireballSpellVfx {
  const { scene, config } = deps;
  const now = deps.now ?? (() => performance.now());
  const projectile = new THREE.Group();
  projectile.name = "fireball-spell-projectile";
  projectile.visible = false;
  scene.add(projectile);

  const sphereGeometry = new THREE.IcosahedronGeometry(1, 3);
  const coreMaterial = additiveMaterial(config.coreColor, 0.96);
  coreMaterial.vertexColors = false;
  const core = new THREE.Mesh(sphereGeometry, coreMaterial);
  core.name = "fireball-spell-core";
  core.scale.setScalar(config.projectileRadius * 0.72);
  core.renderOrder = 4200;
  projectile.add(core);

  const shellHandle = createFireballNodeMaterial(config.coreColor, config.glowColor);
  const shell = new THREE.Mesh(sphereGeometry, shellHandle.material);
  shell.name = "fireball-spell-shell";
  shell.scale.setScalar(config.projectileRadius * 1.16);
  shell.renderOrder = 4201;
  projectile.add(shell);

  const projectileLight = new THREE.PointLight(
    spellColor(config.glowColor),
    config.glowIntensity,
    config.glowDistance,
    config.glowDecay,
  );
  projectileLight.name = "fireball-spell-projectile-light";
  projectile.add(projectileLight);

  const trailCapacity = Math.max(1, Math.floor(config.trailCount));
  const trailGeometry = new THREE.OctahedronGeometry(1, 0);
  const trailMaterial = additiveMaterial(config.glowColor, 0.76);
  const trail = new THREE.InstancedMesh(trailGeometry, trailMaterial, trailCapacity);
  trail.name = "fireball-spell-trail";
  trail.count = Math.max(0, Math.floor(config.trailCount));
  trail.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  trail.frustumCulled = false;
  trail.renderOrder = 4199;
  trail.visible = false;
  for (let index = 0; index < trail.count; index++) {
    const mix = trail.count <= 1 ? 0 : index / (trail.count - 1);
    trail.setColorAt(index, spellColor(config.coreColor).lerp(spellColor(config.glowColor), mix));
  }
  if (trail.instanceColor) trail.instanceColor.needsUpdate = true;
  scene.add(trail);

  const impact = new THREE.Group();
  impact.name = "fireball-spell-impact";
  impact.visible = false;
  scene.add(impact);

  const flashGeometry = new THREE.IcosahedronGeometry(1, 2);
  const flashMaterial = additiveMaterial(config.coreColor, 0);
  flashMaterial.vertexColors = false;
  const flash = new THREE.Mesh(flashGeometry, flashMaterial);
  flash.name = "fireball-spell-impact-flash";
  flash.renderOrder = 4302;
  impact.add(flash);

  const ringGeometry = new THREE.RingGeometry(0.62, 1, 48);
  const ringMaterial = additiveMaterial(config.glowColor, 0);
  ringMaterial.vertexColors = false;
  ringMaterial.side = THREE.FrontSide;
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.name = "fireball-spell-impact-ring";
  ring.renderOrder = 4300;
  impact.add(ring);

  const sparkCapacity = Math.max(1, Math.floor(config.sparkCount));
  const sparkGeometry = new THREE.OctahedronGeometry(1, 0);
  const sparkMaterial = additiveMaterial(config.coreColor, 0);
  sparkMaterial.vertexColors = false;
  const sparks = new THREE.InstancedMesh(sparkGeometry, sparkMaterial, sparkCapacity);
  sparks.name = "fireball-spell-impact-sparks";
  sparks.count = Math.max(0, Math.floor(config.sparkCount));
  sparks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  sparks.frustumCulled = false;
  sparks.renderOrder = 4301;
  impact.add(sparks);

  const impactLight = new THREE.PointLight(
    spellColor(config.glowColor),
    0,
    config.glowDistance * 1.35,
    config.glowDecay,
  );
  impactLight.name = "fireball-spell-impact-light";
  impactLight.position.y = 0.7;
  impactLight.visible = false;
  impact.add(impactLight);

  const sparkStates = createSparkStates(sparks.count);
  const state: FireballState = {
    phase: "idle",
    startMs: 0,
    durationMs: 1,
    previousElapsedSeconds: 0,
    impactStartMs: 0,
    origin: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
  };
  const previousPosition = new THREE.Vector3();
  const nextPosition = new THREE.Vector3();
  const trailPosition = new THREE.Vector3();
  const trailDirection = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const sparkPosition = new THREE.Vector3();
  const ringNormal = new THREE.Vector3(0, 0, 1);

  const hide = (): void => {
    state.phase = "idle";
    projectile.visible = false;
    projectileLight.visible = false;
    projectileLight.intensity = 0;
    trail.visible = false;
    impact.visible = false;
    impactLight.visible = false;
    impactLight.intensity = 0;
  };

  const updateTrail = (elapsedSeconds: number): void => {
    const available = Math.min(
      Math.floor(config.trailCount),
      Math.max(1, Math.floor(elapsedSeconds / TRAIL_SPACING_SECONDS) + 1),
    );
    trail.count = Math.max(0, available);
    trail.visible = trail.count > 0;
    for (let index = 0; index < trail.count; index++) {
      const sampleTime = Math.max(0, elapsedSeconds - index * TRAIL_SPACING_SECONDS);
      computeFireballPosition(state.origin, state.velocity, config.gravity, sampleTime, trailPosition);
      const tail = trail.count <= 1 ? 0 : index / (trail.count - 1);
      const jitter = 0.84 + seeded01(index, Math.floor(elapsedSeconds * 24)) * 0.32;
      const size = config.projectileRadius * (0.27 - tail * 0.2) * jitter;
      trailDirection.copy(state.velocity).addScaledVector(WORLD_UP, -config.gravity * sampleTime).normalize();
      rotation.setFromUnitVectors(TRAIL_AXIS, trailDirection);
      scale.set(
        Math.max(0.018, size * 0.56),
        Math.max(0.018, size * 0.56),
        Math.max(0.04, size * 2.15),
      );
      matrix.compose(trailPosition, rotation, scale);
      trail.setMatrixAt(index, matrix);
    }
    trail.instanceMatrix.needsUpdate = true;
  };

  const beginImpact = (hit: FireballTerrainHit, impactAtMs: number): void => {
    state.phase = "impact";
    state.impactStartMs = impactAtMs;
    projectile.visible = false;
    projectileLight.visible = false;
    projectileLight.intensity = 0;
    trail.visible = false;
    impact.position.copy(hit.point);
    const normal = hit.normal?.clone().normalize() ?? WORLD_UP;
    ring.quaternion.setFromUnitVectors(ringNormal, normal);
    impact.visible = true;
    impactLight.visible = true;
  };

  const updateImpact = (nowMs: number): void => {
    const elapsedMs = Math.max(0, nowMs - state.impactStartMs);
    const progress = elapsedMs / Math.max(1, config.impactDurationMs);
    if (progress >= 1) {
      hide();
      return;
    }
    const p = clamp01(progress);
    const burst = 1 - smoothstep(0.02, 0.52, p);
    const fade = 1 - smoothstep(0.42, 1, p);
    flashMaterial.opacity = burst * 0.92;
    flash.scale.setScalar(config.impactRadius * (0.12 + smoothstep(0, 0.48, p) * 0.42));
    ringMaterial.opacity = fade * 0.78;
    ring.scale.setScalar(config.impactRadius * (0.32 + smoothstep(0, 0.82, p) * 0.9));
    sparkMaterial.opacity = 1 - smoothstep(0.56, 1, p);
    impactLight.intensity = config.glowIntensity * 1.65 * (1 - smoothstep(0.04, 0.88, p));

    const seconds = elapsedMs / 1000;
    for (let index = 0; index < sparkStates.length; index++) {
      const spark = sparkStates[index]!;
      sparkPosition.set(
        Math.cos(spark.angle) * spark.speed * seconds,
        Math.max(0.04, 0.12 + spark.lift * seconds - 0.5 * config.gravity * seconds * seconds),
        Math.sin(spark.angle) * spark.speed * seconds,
      );
      rotation.setFromAxisAngle(WORLD_UP, spark.angle + spark.spin * seconds);
      scale.setScalar(spark.size * Math.max(0.08, fade));
      matrix.compose(sparkPosition, rotation, scale);
      sparks.setMatrixAt(index, matrix);
    }
    sparks.instanceMatrix.needsUpdate = true;
  };

  const updateFlight = (nowMs: number): void => {
    const maxFlightSeconds = Math.max(0.001, (state.durationMs - config.impactDurationMs) / 1000);
    const elapsedSeconds = Math.min(maxFlightSeconds, Math.max(0, (nowMs - state.startMs) / 1000));
    let stepStart = state.previousElapsedSeconds;
    computeFireballPosition(state.origin, state.velocity, config.gravity, stepStart, previousPosition);
    while (stepStart < elapsedSeconds - 1e-8) {
      const stepEnd = Math.min(elapsedSeconds, stepStart + COLLISION_STEP_SECONDS);
      computeFireballPosition(state.origin, state.velocity, config.gravity, stepEnd, nextPosition);
      const hit = findFireballTerrainImpact(
        previousPosition,
        nextPosition,
        config.projectileRadius,
        deps.raycastTerrain,
      );
      if (hit) {
        const segmentLength = previousPosition.distanceTo(nextPosition);
        const fraction = segmentLength > 1e-6 ? clamp01(hit.distance / segmentLength) : 0;
        const impactAtMs = state.startMs + (stepStart + (stepEnd - stepStart) * fraction) * 1000;
        beginImpact(hit, impactAtMs);
        updateImpact(nowMs);
        return;
      }
      previousPosition.copy(nextPosition);
      stepStart = stepEnd;
    }
    state.previousElapsedSeconds = elapsedSeconds;
    projectile.position.copy(previousPosition);
    projectile.rotation.set(elapsedSeconds * 1.7, elapsedSeconds * 2.3, elapsedSeconds * 1.2);
    const pulse = 1 + Math.sin(elapsedSeconds * 19) * 0.045;
    projectile.scale.setScalar(pulse);
    shellHandle.uTime.value = elapsedSeconds;
    shellHandle.uOpacity.value = 0.96;
    projectileLight.intensity = config.glowIntensity * (0.9 + Math.sin(elapsedSeconds * 23) * 0.1);
    updateTrail(elapsedSeconds);
    if (elapsedSeconds >= maxFlightSeconds) hide();
  };

  hide();

  return {
    play: (durationMs) => {
      const source = deps.getSource();
      const direction = source.direction.clone();
      if (direction.lengthSq() < 1e-8) direction.set(0, 0, -1);
      direction.normalize();
      state.startMs = now();
      state.durationMs = Math.max(config.impactDurationMs + 1, durationMs);
      state.previousElapsedSeconds = 0;
      state.origin.copy(source.point);
      state.velocity.copy(direction).multiplyScalar(config.launchSpeed).addScaledVector(WORLD_UP, config.liftSpeed);
      state.phase = "flight";
      projectile.position.copy(state.origin);
      projectile.rotation.set(0, 0, 0);
      projectile.scale.setScalar(1);
      projectile.visible = true;
      projectileLight.visible = true;
      projectileLight.intensity = config.glowIntensity;
      trail.visible = config.trailCount > 0;
      impact.visible = false;
      impactLight.visible = false;
      impactLight.intensity = 0;
      shellHandle.uTime.value = 0;
      shellHandle.uOpacity.value = 0.96;
    },
    update: (nowMs) => {
      if (state.phase === "flight") updateFlight(nowMs);
      else if (state.phase === "impact") updateImpact(nowMs);
    },
    dispose: () => {
      scene.remove(projectile);
      scene.remove(trail);
      scene.remove(impact);
      sphereGeometry.dispose();
      coreMaterial.dispose();
      shellHandle.material.dispose();
      trailGeometry.dispose();
      trailMaterial.dispose();
      flashGeometry.dispose();
      flashMaterial.dispose();
      ringGeometry.dispose();
      ringMaterial.dispose();
      sparkGeometry.dispose();
      sparkMaterial.dispose();
    },
  };
}
