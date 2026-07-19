import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  clamp,
  float,
  Fn,
  length,
  mix,
  smoothstep,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { EarthSpellVfxConfig } from "./spell_config.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const PARTICLE_COUNT_MIN = 64;
const PARTICLE_COUNT_MAX = 160;
const PARTICLE_DENSITY_PER_METER = 24;
const PARTICLE_GRAVITY_MPS2 = -2.2;
const PARTICLE_DRAG = 0.68;
const PARTICLE_MIN_LIFETIME_S = 0.62;
const PARTICLE_MAX_LIFETIME_S = 1.22;
const GOLDEN_ANGLE = 2.399963229728653;
const ZERO_SCALE = new THREE.Vector3(0, 0, 0);

export interface EarthDustParticleSystemDeps {
  scene: THREE.Scene;
  config: Pick<EarthSpellVfxConfig, "dustRadius" | "impactRadius">;
  getCamera?: () => THREE.Camera;
}

export interface EarthDustParticleSystem {
  readonly particleCount: number;
  spawn: (center: THREE.Vector3, normal: THREE.Vector3) => void;
  update: (timeSeconds: number, progress: number) => void;
  hide: () => void;
  dispose: () => void;
}

interface ParticleSeed {
  origin: THREE.Vector3;
  velocity: THREE.Vector3;
  sideDrift: THREE.Vector3;
  delayS: number;
  lifetimeS: number;
  sizeM: number;
  spinRps: number;
  phase: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstepCpu(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function seeded01(index: number, salt: number): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453123;
  return value - Math.floor(value);
}

function particleCount(config: Pick<EarthSpellVfxConfig, "dustRadius">): number {
  return Math.min(
    PARTICLE_COUNT_MAX,
    Math.max(PARTICLE_COUNT_MIN, Math.round(config.dustRadius * PARTICLE_DENSITY_PER_METER)),
  );
}

function tangentBasis(normal: THREE.Vector3): { tangent: THREE.Vector3; bitangent: THREE.Vector3 } {
  const helper = Math.abs(normal.y) < 0.96 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const tangent = new THREE.Vector3().crossVectors(helper, normal).normalize();
  const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
  return { tangent, bitangent };
}

function createParticleMaterial(): MeshBasicNodeMaterial {
  const fragment = Fn(() => {
    const p: TslNode = uv().sub(vec2(0.5, 0.5));
    const r: TslNode = length(p).mul(2.0);
    const disc: TslNode = float(1).sub(smoothstep(0.42, 1.0, r));
    const core: TslNode = float(1).sub(smoothstep(0.0, 0.26, r));
    const edgeBreakup: TslNode = float(1).sub(smoothstep(0.22, 0.92, r)).mul(0.55).add(0.28);
    const alpha: TslNode = clamp(disc.mul(edgeBreakup).add(core.mul(0.12)), 0.0, 0.42);
    const darkDust: TslNode = vec3(0.34, 0.24, 0.15);
    const warmDust: TslNode = vec3(0.66, 0.52, 0.36);
    const color: TslNode = mix(darkDust, warmDust, core.mul(0.25).add(disc.mul(0.55)));
    return vec4(color, alpha);
  })();

  const material = new MeshBasicNodeMaterial();
  material.name = "earth-spell-dust-particle-node";
  material.colorNode = fragment.xyz;
  material.opacityNode = fragment.w;
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = THREE.FrontSide;
  material.blending = THREE.NormalBlending;
  material.toneMapped = false;
  return material;
}

function resetInstance(mesh: THREE.InstancedMesh, index: number, matrix: THREE.Matrix4): void {
  matrix.compose(new THREE.Vector3(0, -100000, 0), new THREE.Quaternion(), ZERO_SCALE);
  mesh.setMatrixAt(index, matrix);
}

export function createEarthDustParticleSystem(deps: EarthDustParticleSystemDeps): EarthDustParticleSystem {
  const count = particleCount(deps.config);
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = createParticleMaterial();
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = "earth-spell-dust-particles";
  mesh.frustumCulled = false;
  mesh.renderOrder = 4300;
  mesh.visible = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  deps.scene.add(mesh);

  const seeds: ParticleSeed[] = [];
  const center = new THREE.Vector3();
  const normal = new THREE.Vector3(0, 1, 0);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const roll = new THREE.Quaternion();
  let active = false;

  for (let i = 0; i < count; i++) resetInstance(mesh, i, matrix);
  mesh.instanceMatrix.needsUpdate = true;

  const buildSeeds = (): void => {
    seeds.length = 0;
    const { tangent, bitangent } = tangentBasis(normal);
    for (let i = 0; i < count; i++) {
      const rndA = seeded01(i, 10);
      const rndB = seeded01(i, 11);
      const rndC = seeded01(i, 12);
      const angle = i * GOLDEN_ANGLE + rndA * 0.65;
      const radial = tangent.clone().multiplyScalar(Math.cos(angle)).addScaledVector(bitangent, Math.sin(angle)).normalize();
      const startRadius = deps.config.impactRadius * (0.10 + rndB * 0.38);
      const outwardSpeed = 2.2 + rndA * 5.8;
      const upwardSpeed = 0.9 + rndB * 3.2;
      const sideDrift = tangent.clone().multiplyScalar((rndC - 0.5) * 0.65).addScaledVector(bitangent, (rndA - 0.5) * 0.65);
      seeds.push({
        origin: center.clone().addScaledVector(radial, startRadius).addScaledVector(normal, 0.16 + rndC * 0.28),
        velocity: radial.multiplyScalar(outwardSpeed).addScaledVector(normal, upwardSpeed),
        sideDrift,
        delayS: rndC * 0.16,
        lifetimeS: PARTICLE_MIN_LIFETIME_S + (PARTICLE_MAX_LIFETIME_S - PARTICLE_MIN_LIFETIME_S) * rndB,
        sizeM: deps.config.dustRadius * (0.060 + rndA * 0.095),
        spinRps: -2.8 + rndC * 5.6,
        phase: rndA * Math.PI * 2,
      });
    }
  };

  const setParticleMatrix = (index: number, seed: ParticleSeed, ageS: number, lifeT: number, timeSeconds: number): void => {
    const dragTravel = (1 - Math.exp(-PARTICLE_DRAG * ageS)) / PARTICLE_DRAG;
    const gravityFall = 0.5 * PARTICLE_GRAVITY_MPS2 * ageS * ageS;
    const turbulence = Math.sin(seed.phase + timeSeconds * 5.1) * 0.18 + Math.sin(seed.phase * 0.7 + timeSeconds * 2.3) * 0.11;
    position.copy(seed.origin)
      .addScaledVector(seed.velocity, dragTravel)
      .addScaledVector(normal, gravityFall)
      .addScaledVector(seed.sideDrift, turbulence);

    const fade = smoothstepCpu(0.0, 0.12, lifeT) * (1 - smoothstepCpu(0.58, 1.0, lifeT));
    const grow = 0.48 + smoothstepCpu(0.0, 0.65, lifeT) * 1.75;
    const size = seed.sizeM * grow * Math.max(0.001, fade);
    scale.set(size, size * (0.72 + lifeT * 0.55), 1);

    const camera = deps.getCamera?.();
    if (camera) {
      rotation.copy(camera.quaternion);
    } else {
      rotation.setFromAxisAngle(normal, seed.phase);
    }
    roll.setFromAxisAngle(new THREE.Vector3(0, 0, 1), seed.phase + ageS * seed.spinRps);
    rotation.multiply(roll);
    matrix.compose(position, rotation, scale);
    mesh.setMatrixAt(index, matrix);
  };

  return {
    particleCount: count,
    spawn: (spawnCenter, spawnNormal) => {
      center.copy(spawnCenter);
      normal.copy(spawnNormal).normalize();
      buildSeeds();
      active = true;
      mesh.visible = true;
      for (let i = 0; i < count; i++) resetInstance(mesh, i, matrix);
      mesh.instanceMatrix.needsUpdate = true;
    },
    update: (timeSeconds, progress) => {
      if (!active) return;
      if (progress >= 1) {
        active = false;
        mesh.visible = false;
        return;
      }
      for (let i = 0; i < count; i++) {
        const seed = seeds[i]!;
        const ageS = timeSeconds - seed.delayS;
        if (ageS <= 0 || ageS >= seed.lifetimeS) {
          resetInstance(mesh, i, matrix);
          continue;
        }
        setParticleMatrix(i, seed, ageS, ageS / seed.lifetimeS, timeSeconds);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    hide: () => {
      active = false;
      mesh.visible = false;
    },
    dispose: () => {
      deps.scene.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}
