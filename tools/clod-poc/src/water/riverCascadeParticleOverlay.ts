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

interface CascadeParticleSignal {
  cascade: number;
  rapid: number;
  foam: number;
}

export interface RiverCascadeParticleStats {
  mist: number;
  splash: number;
  foam: number;
  lastEmitters: number;
  lastCascadeEmitters: number;
  lastRapidEmitters: number;
  lastMaxCascade: number;
  lastMaxRapid: number;
}

const EMIT_INTERVAL_S = 0.085;
const EMIT_GRID = 19;
const EMIT_SPACING_M = 4.75;
const MAX_MIST_PARTICLES = 180;
const MAX_SPLASH_PARTICLES = 150;
const MAX_FOAM_PARTICLES = 220;
const WATER_SURFACE_OFFSET_M = 0.08;
const EMIT_CELLS_PER_FRAME = 16;

interface EmitterScan {
  baseX: number;
  baseZ: number;
  centerX: number;
  centerZ: number;
  cursor: number;
}

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

export function cascadeParticleSignal(
  sample: WaterFieldResult,
  settings: RiverCascadeParticleSettings,
): CascadeParticleSignal {
  if (!settings.enabled || sample.depth <= 0.03 || sample.bodyMask <= 0.08) {
    return { cascade: 0, rapid: 0, foam: 0 };
  }
  const body = smooth01(sample.bodyMask);
  const shallowBoost = 1 - smooth01((sample.depth - 4.0) / 8.0);
  const depth = Math.max(0.25, shallowBoost);
  const cascade = smooth01((sample.flow.drop - settings.dropStart) / Math.max(0.05, settings.dropEnd - settings.dropStart))
    * body
    * depth;
  const rapid = smooth01((sample.flow.speed - settings.rapidSpeedStart) / Math.max(0.05, settings.rapidSpeedEnd - settings.rapidSpeedStart))
    * body
    * depth
    * (1 - cascade * 0.35);
  return {
    cascade: clamp01(cascade),
    rapid: clamp01(rapid),
    foam: clamp01(Math.max(rapid * 0.78, cascade)),
  };
}

function pushParticle(layer: ParticleLayer, particle: Particle): void {
  if (layer.particles.length >= layer.max) layer.particles.shift();
  layer.particles.push(particle);
}

function writeLayer(layer: ParticleLayer, color: THREE.Color, fadePower: number): void {
  const count = layer.particles.length;
  for (let i = 0; i < count; i += 1) {
    const p = layer.particles[i]!;
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
    const p = layer.particles[read]!;
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
  private readonly mist = makeLayer("river-cascade-mist", MAX_MIST_PARTICLES, 2.2, 0.36, 0.03);
  private readonly splash = makeLayer("river-cascade-splash", MAX_SPLASH_PARTICLES, 0.92, 0.76, -3.4);
  private readonly foam = makeLayer("river-cascade-foam-drift", MAX_FOAM_PARTICLES, 1.22, 0.58, 0.0);
  private readonly mistColor = new THREE.Color(0xdceff5);
  private readonly splashColor = new THREE.Color(0xf4fbff);
  private readonly foamColor = new THREE.Color(0xe4eee9);
  private readonly settings = readRiverCascadeParticleSettings();
  private emitTime = EMIT_INTERVAL_S;
  private lastEmitters = 0;
  private lastCascadeEmitters = 0;
  private lastRapidEmitters = 0;
  private lastMaxCascade = 0;
  private lastMaxRapid = 0;
  private emitterScan: EmitterScan | null = null;

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
      lastCascadeEmitters: this.lastCascadeEmitters,
      lastRapidEmitters: this.lastRapidEmitters,
      lastMaxCascade: this.lastMaxCascade,
      lastMaxRapid: this.lastMaxRapid,
    };
  }

  update(deltaSeconds: number, cameraPosition: THREE.Vector3): void {
    if (!this.group.visible) return;
    advanceLayer(this.mist, deltaSeconds);
    advanceLayer(this.splash, deltaSeconds);
    this.advanceFoam(deltaSeconds);
    this.emitTime += deltaSeconds;
    if (this.emitTime >= EMIT_INTERVAL_S && this.emitterScan === null) {
      this.emitTime = 0;
      this.beginEmit(cameraPosition);
    }
    this.stepEmit();
    writeLayer(this.mist, this.mistColor, 1.9);
    writeLayer(this.splash, this.splashColor, 1.15);
    writeLayer(this.foam, this.foamColor, 1.5);
  }

  dispose(): void {
    this.scene.remove(this.group);
    for (const layer of [this.mist, this.splash, this.foam]) {
      layer.points.geometry.dispose();
      (layer.points.material as THREE.Material).dispose();
    }
  }

  private beginEmit(cameraPosition: THREE.Vector3): void {
    this.lastEmitters = 0;
    this.lastCascadeEmitters = 0;
    this.lastRapidEmitters = 0;
    this.lastMaxCascade = 0;
    this.lastMaxRapid = 0;
    this.emitterScan = {
      baseX: Math.round(cameraPosition.x / EMIT_SPACING_M),
      baseZ: Math.round(cameraPosition.z / EMIT_SPACING_M),
      centerX: cameraPosition.x,
      centerZ: cameraPosition.z,
      cursor: 0,
    };
  }

  private stepEmit(): void {
    const scan = this.emitterScan;
    if (!scan) return;
    const radius = this.settings.spawnRadiusM;
    const half = Math.floor(EMIT_GRID / 2);
    const totalCells = EMIT_GRID * EMIT_GRID;
    const end = Math.min(totalCells, scan.cursor + EMIT_CELLS_PER_FRAME);
    while (scan.cursor < end && this.lastEmitters < this.settings.maxEmittersPerTick) {
      const cursor = scan.cursor++;
      const gx = cursor % EMIT_GRID - half;
      const gz = Math.floor(cursor / EMIT_GRID) - half;
      const cellX = scan.baseX + gx;
      const cellZ = scan.baseZ + gz;
      const x = (cellX + 0.5 + randomSigned(0.28)) * EMIT_SPACING_M;
      const z = (cellZ + 0.5 + randomSigned(0.28)) * EMIT_SPACING_M;
      if (Math.hypot(x - scan.centerX, z - scan.centerZ) > radius) continue;
      const sample = this.field.sample(x, z);
      const signal = cascadeParticleSignal(sample, this.settings);
      this.lastMaxCascade = Math.max(this.lastMaxCascade, signal.cascade);
      this.lastMaxRapid = Math.max(this.lastMaxRapid, signal.rapid);
      if (signal.foam <= 0.08) continue;
      const chance = Math.min(0.92, signal.foam * 0.74 + hash2(cellX, cellZ, 19) * 0.10);
      if (Math.random() > chance) continue;
      this.lastEmitters += 1;
      if (signal.cascade > 0.12) this.lastCascadeEmitters += 1;
      if (signal.rapid > 0.12) this.lastRapidEmitters += 1;
      this.spawnAt(x, z, sample, signal);
    }
    if (scan.cursor >= totalCells || this.lastEmitters >= this.settings.maxEmittersPerTick) {
      this.emitterScan = null;
    }
  }

  private spawnAt(x: number, z: number, sample: WaterFieldResult, signal: CascadeParticleSignal): void {
    const flowX = Math.abs(sample.flow.x) > 0.001 ? sample.flow.x : randomSigned(1);
    const flowZ = Math.abs(sample.flow.z) > 0.001 ? sample.flow.z : randomSigned(1);
    const flowLen = Math.max(0.001, Math.hypot(flowX, flowZ));
    const dirX = flowX / flowLen;
    const dirZ = flowZ / flowLen;
    const sideX = -dirZ;
    const sideZ = dirX;
    const y = sample.waterY + WATER_SURFACE_OFFSET_M;

    if (this.settings.foamDriftStrength > 0) {
      const strength = signal.foam * this.settings.foamDriftStrength;
      pushParticle(this.foam, {
        x: x + randomSigned(0.45),
        y: y + 0.04,
        z: z + randomSigned(0.45),
        vx: dirX * (0.46 + sample.flow.speed * 0.38) + sideX * randomSigned(0.18),
        vy: 0,
        vz: dirZ * (0.46 + sample.flow.speed * 0.38) + sideZ * randomSigned(0.18),
        age: 0,
        life: 1.25 + Math.random() * 1.8,
        strength,
      });
    }

    if (this.settings.mistStrength > 0 && signal.cascade > 0.24) {
      const strength = signal.cascade * this.settings.mistStrength;
      pushParticle(this.mist, {
        x: x + sideX * randomSigned(0.95),
        y: y + 0.34 + Math.random() * 0.52,
        z: z + sideZ * randomSigned(0.95),
        vx: dirX * (0.14 + sample.flow.speed * 0.12) + randomSigned(0.18),
        vy: 0.22 + Math.random() * 0.44,
        vz: dirZ * (0.14 + sample.flow.speed * 0.12) + randomSigned(0.18),
        age: 0,
        life: 1.85 + Math.random() * 1.85,
        strength,
      });
    }

    if (this.settings.splashStrength > 0 && signal.cascade > 0.18) {
      const strength = signal.cascade * this.settings.splashStrength;
      pushParticle(this.splash, {
        x: x + sideX * randomSigned(0.55),
        y: y + 0.14,
        z: z + sideZ * randomSigned(0.55),
        vx: dirX * (0.78 + sample.flow.speed * 0.50) + sideX * randomSigned(0.72),
        vy: 1.2 + Math.random() * 1.7 + signal.cascade * 0.78,
        vz: dirZ * (0.78 + sample.flow.speed * 0.50) + sideZ * randomSigned(0.72),
        age: 0,
        life: 0.42 + Math.random() * 0.58,
        strength,
      });
    }
  }

  private advanceFoam(deltaSeconds: number): void {
    let write = 0;
    for (let read = 0; read < this.foam.particles.length; read += 1) {
      const p = this.foam.particles[read]!;
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
