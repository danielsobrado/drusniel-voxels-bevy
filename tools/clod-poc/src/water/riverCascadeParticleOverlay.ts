import * as THREE from "three";
import type { WaterField, WaterFieldResult } from "./waterField.js";
import {
  readRiverCascadeParticleSettings,
  type RiverCascadeParticleSettings,
} from "./riverCascadeParticlesRuntime.js";

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  strength: number;
}

interface ParticleLayer {
  readonly points: THREE.Points;
  readonly positions: Float32Array;
  readonly colors: Float32Array;
  readonly particles: Particle[];
  readonly max: number;
  readonly gravity: number;
}

export interface RiverCascadeParticleStats {
  mist: number;
  splash: number;
  foam: number;
  lastEmitters: number;
}

const EMIT_INTERVAL_S = 0.085;
const EMIT_GRID = 19;
const EMIT_SPACING_M = 4.75;
const MAX_EMITTERS_PER_TICK = 28;
const MAX_MIST_PARTICLES = 180;
const MAX_SPLASH_PARTICLES = 150;
const MAX_FOAM_PARTICLES = 220;
const WATER_SURFACE_OFFSET_M = 0.08;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smooth01(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function hash2(x: number, z: number, seed: number): number {
  const v = Math.sin(x * 41.3 + z * 289.1 + seed * 17.17) * 43758.5453;
  return v - Math.floor(v);
}

function randomSigned(scale: number): number {
  return (Math.random() * 2 - 1) * scale;
}

function makeLayer(name: string, max: number, size: number, opacity: number, gravity: number): ParticleLayer {
  const positions = new Float32Array(max * 3);
  const colors = new Float32Array(max * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setDrawRange(0, 0);
  const material = new THREE.PointsMaterial({
    size,
    transparent: true,
    opacity,
    vertexColors: true,
    depthWrite: false,
    depthTest: true,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geometry, material);
  points.name = name;
  points.frustumCulled = false;
  return { points, positions, colors, particles: [], max, gravity };
}

function cascadeIntensity(sample: WaterFieldResult, settings: RiverCascadeParticleSettings): number {
  if (!settings.enabled || sample.depth <= 0.03 || sample.bodyMask <= 0.08) return 0;
  const drop = smooth01((sample.flow.drop - settings.dropStart) / Math.max(0.05, settings.dropEnd - settings.dropStart));
  const speed = smooth01(sample.flow.speed / 0.85);
  const body = smooth01(sample.bodyMask);
  const depth = 1 - smooth01((sample.depth - 4.0) / 8.0);
  return clamp01(Math.max(drop, speed * 0.58) * body * Math.max(0.25, depth));
}

function pushParticle(layer: ParticleLayer, particle: Particle): void {
  if (layer.particles.length >= layer.max) layer.particles.shift();
  layer.particles.push(particle);
}

function writeLayer(layer: ParticleLayer, color: THREE.Color, fadePower: number): void {
  const count = layer.particles.length;
  for (let i = 0; i < count; i += 1) {
    const p = layer.particles[i];
    const fade = Math.pow(1 - clamp01(p.age / Math.max(0.001, p.life)), fadePower) * p.strength;
    const vi = i * 3;
    layer.positions[vi + 0] = p.x;
    layer.positions[vi + 1] = p.y;
    layer.positions[vi + 2] = p.z;
    layer.colors[vi + 0] = color.r * fade;
    layer.colors[vi + 1] = color.g * fade;
    layer.colors[vi + 2] = color.b * fade;
  }
  layer.points.geometry.setDrawRange(0, count);
  const position = layer.points.geometry.getAttribute("position") as THREE.BufferAttribute;
  const colorAttr = layer.points.geometry.getAttribute("color") as THREE.BufferAttribute;
  position.needsUpdate = true;
  colorAttr.needsUpdate = true;
}

function advanceLayer(layer: ParticleLayer, deltaSeconds: number): void {
  let write = 0;
  for (let read = 0; read < layer.particles.length; read += 1) {
    const p = layer.particles[read];
    p.age += deltaSeconds;
    if (p.age >= p.life) continue;
    p.vy += layer.gravity * deltaSeconds;
    p.x += p.vx * deltaSeconds;
    p.y += p.vy * deltaSeconds;
    p.z += p.vz * deltaSeconds;
    p.vx *= 0.986;
    p.vz *= 0.986;
    layer.particles[write] = p;
    write += 1;
  }
  layer.particles.length = write;
}

export class RiverCascadeParticleOverlay {
  private readonly group = new THREE.Group();
  private readonly mist = makeLayer("river-cascade-mist", MAX_MIST_PARTICLES, 1.8, 0.42, 0.05);
  private readonly splash = makeLayer("river-cascade-splash", MAX_SPLASH_PARTICLES, 1.05, 0.72, -3.2);
  private readonly foam = makeLayer("river-cascade-foam-drift", MAX_FOAM_PARTICLES, 1.28, 0.58, 0.0);
  private readonly mistColor = new THREE.Color(0xdceff5);
  private readonly splashColor = new THREE.Color(0xf4fbff);
  private readonly foamColor = new THREE.Color(0xe4eee9);
  private readonly settings = readRiverCascadeParticleSettings();
  private emitTime = EMIT_INTERVAL_S;
  private lastEmitters = 0;

  constructor(private readonly scene: THREE.Scene, private readonly field: WaterField) {
    this.group.name = "river-cascade-particle-overlay";
    this.group.add(this.foam.points, this.mist.points, this.splash.points);
    this.scene.add(this.group);
    this.group.visible = this.settings.enabled;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible && this.settings.enabled;
  }

  getStats(): RiverCascadeParticleStats {
    return {
      mist: this.mist.particles.length,
      splash: this.splash.particles.length,
      foam: this.foam.particles.length,
      lastEmitters: this.lastEmitters,
    };
  }

  update(deltaSeconds: number, cameraPosition: THREE.Vector3): void {
    if (!this.group.visible) return;
    advanceLayer(this.mist, deltaSeconds);
    advanceLayer(this.splash, deltaSeconds);
    this.advanceFoam(deltaSeconds);
    this.emitTime += deltaSeconds;
    if (this.emitTime >= EMIT_INTERVAL_S) {
      this.emitTime = 0;
      this.emit(cameraPosition);
    }
    writeLayer(this.mist, this.mistColor, 1.8);
    writeLayer(this.splash, this.splashColor, 1.2);
    writeLayer(this.foam, this.foamColor, 1.5);
  }

  dispose(): void {
    this.scene.remove(this.group);
    for (const layer of [this.mist, this.splash, this.foam]) {
      layer.points.geometry.dispose();
      (layer.points.material as THREE.Material).dispose();
    }
  }

  private emit(cameraPosition: THREE.Vector3): void {
    this.lastEmitters = 0;
    const radius = this.settings.spawnRadiusM;
    const half = Math.floor(EMIT_GRID / 2);
    const baseX = Math.round(cameraPosition.x / EMIT_SPACING_M);
    const baseZ = Math.round(cameraPosition.z / EMIT_SPACING_M);
    for (let gz = -half; gz <= half; gz += 1) {
      for (let gx = -half; gx <= half; gx += 1) {
        if (this.lastEmitters >= MAX_EMITTERS_PER_TICK) return;
        const cellX = baseX + gx;
        const cellZ = baseZ + gz;
        const x = (cellX + 0.5 + randomSigned(0.28)) * EMIT_SPACING_M;
        const z = (cellZ + 0.5 + randomSigned(0.28)) * EMIT_SPACING_M;
        if (Math.hypot(x - cameraPosition.x, z - cameraPosition.z) > radius) continue;
        const sample = this.field.sample(x, z);
        const intensity = cascadeIntensity(sample, this.settings);
        if (intensity <= 0.08) continue;
        const chance = Math.min(0.92, intensity * 0.72 + hash2(cellX, cellZ, 19) * 0.12);
        if (Math.random() > chance) continue;
        this.lastEmitters += 1;
        this.spawnAt(x, z, sample, intensity);
      }
    }
  }

  private spawnAt(x: number, z: number, sample: WaterFieldResult, intensity: number): void {
    const flowX = Math.abs(sample.flow.x) > 0.001 ? sample.flow.x : randomSigned(1);
    const flowZ = Math.abs(sample.flow.z) > 0.001 ? sample.flow.z : randomSigned(1);
    const flowLen = Math.max(0.001, Math.hypot(flowX, flowZ));
    const dirX = flowX / flowLen;
    const dirZ = flowZ / flowLen;
    const sideX = -dirZ;
    const sideZ = dirX;
    const y = sample.waterY + WATER_SURFACE_OFFSET_M;

    if (this.settings.foamDriftStrength > 0) {
      const strength = intensity * this.settings.foamDriftStrength;
      pushParticle(this.foam, {
        x: x + randomSigned(0.45),
        y: y + 0.04,
        z: z + randomSigned(0.45),
        vx: dirX * (0.55 + sample.flow.speed * 0.42) + sideX * randomSigned(0.18),
        vy: 0,
        vz: dirZ * (0.55 + sample.flow.speed * 0.42) + sideZ * randomSigned(0.18),
        age: 0,
        life: 1.2 + Math.random() * 1.7,
        strength,
      });
    }

    if (this.settings.mistStrength > 0 && intensity > 0.16) {
      const strength = intensity * this.settings.mistStrength;
      pushParticle(this.mist, {
        x: x + sideX * randomSigned(0.95),
        y: y + 0.28 + Math.random() * 0.45,
        z: z + sideZ * randomSigned(0.95),
        vx: dirX * (0.18 + sample.flow.speed * 0.18) + randomSigned(0.16),
        vy: 0.28 + Math.random() * 0.52,
        vz: dirZ * (0.18 + sample.flow.speed * 0.18) + randomSigned(0.16),
        age: 0,
        life: 1.7 + Math.random() * 1.6,
        strength,
      });
    }

    if (this.settings.splashStrength > 0 && intensity > 0.20) {
      const strength = intensity * this.settings.splashStrength;
      pushParticle(this.splash, {
        x: x + sideX * randomSigned(0.55),
        y: y + 0.14,
        z: z + sideZ * randomSigned(0.55),
        vx: dirX * (0.65 + sample.flow.speed * 0.55) + sideX * randomSigned(0.65),
        vy: 1.0 + Math.random() * 1.5 + intensity * 0.55,
        vz: dirZ * (0.65 + sample.flow.speed * 0.55) + sideZ * randomSigned(0.65),
        age: 0,
        life: 0.45 + Math.random() * 0.55,
        strength,
      });
    }
  }

  private advanceFoam(deltaSeconds: number): void {
    let write = 0;
    for (let read = 0; read < this.foam.particles.length; read += 1) {
      const p = this.foam.particles[read];
      p.age += deltaSeconds;
      if (p.age >= p.life) continue;
      p.x += p.vx * deltaSeconds;
      p.z += p.vz * deltaSeconds;
      p.vx *= 0.992;
      p.vz *= 0.992;
      const sample = this.field.sample(p.x, p.z);
      if (sample.depth <= 0.02 || sample.bodyMask <= 0.04) continue;
      p.y = sample.waterY + 0.045;
      this.foam.particles[write] = p;
      write += 1;
    }
    this.foam.particles.length = write;
  }
}
