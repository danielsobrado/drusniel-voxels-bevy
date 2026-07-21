import * as THREE from "three";
import type { EnvironmentQuery } from "../environment_query/types.js";
import type { WaterField } from "./waterField.js";
import {
  readRiverCascadeParticleSettings,
  type RiverCascadeParticleSettings,
} from "./riverCascadeParticlesRuntime.js";
import {
  RiverDressingSampleReader,
  type RiverDressingSample,
  type RiverDressingSamplingStats,
} from "./riverDressingSampleReader.js";

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

interface BallisticParticle {
  originX: number;
  originY: number;
  originZ: number;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
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

interface BallisticParticleLayer {
  readonly points: THREE.Points;
  readonly positions: Float32Array;
  readonly colors: Float32Array;
  readonly particles: BallisticParticle[];
  readonly max: number;
}

export interface CascadeParticleSignal {
  readonly cascade: number;
  readonly rapid: number;
  readonly foam: number;
}

export interface RiverCascadeParticleStats {
  readonly mist: number;
  readonly splash: number;
  readonly rapidDroplets: number;
  readonly foam: number;
  readonly lastEmitters: number;
  readonly lastCascadeEmitters: number;
  readonly lastRapidEmitters: number;
  readonly lastMaxCascade: number;
  readonly lastMaxRapid: number;
}

export interface RiverCascadeParticleOverlayOptions {
  readonly minimumSampleHintM?: number;
  readonly readEnvironmentQuery?: () => EnvironmentQuery | null;
}

const EMIT_INTERVAL_S = 0.085;
const EMIT_GRID = 19;
const EMIT_SPACING_M = 4.75;
const MAX_MIST_PARTICLES = 180;
const MAX_SPLASH_PARTICLES = 150;
const MAX_RAPID_DROPLETS = 180;
const MAX_FOAM_PARTICLES = 220;
const WATER_SURFACE_OFFSET_M = 0.08;
const EMIT_CELLS_PER_FRAME = 16;

interface EmitterScan {
  readonly baseX: number;
  readonly baseZ: number;
  readonly centerX: number;
  readonly centerZ: number;
  readonly tick: number;
  cursor: number;
}

export function cascadeParticleSignal(
  sample: RiverDressingSample,
  settings: RiverCascadeParticleSettings,
): CascadeParticleSignal {
  if (!settings.enabled || sample.depth <= 0.03 || sample.wetMask <= 0.08) {
    return { cascade: 0, rapid: 0, foam: 0 };
  }
  const body = smooth01(sample.wetMask);
  const shallowBoost = 1 - smooth01((sample.depth - 4.0) / 8.0);
  const depth = Math.max(0.25, shallowBoost);
  const cascade = smooth01(
    (sample.bedDrop - settings.dropStart)
    / Math.max(0.05, settings.dropEnd - settings.dropStart),
  ) * body * depth;
  const rapid = smooth01(
    (sample.flowStrength - settings.rapidSpeedStart)
    / Math.max(0.05, settings.rapidSpeedEnd - settings.rapidSpeedStart),
  ) * body * depth * (1 - cascade * 0.35);
  return {
    cascade: clamp01(cascade),
    rapid: clamp01(rapid),
    foam: clamp01(Math.max(rapid * 0.78, cascade)),
  };
}

export function rapidDropletSpawnSpecs(
  cellX: number,
  cellZ: number,
  emitTick: number,
  x: number,
  z: number,
  sample: RiverDressingSample,
  signal: CascadeParticleSignal,
  settings: RiverCascadeParticleSettings,
): readonly BallisticParticle[] {
  if (
    settings.rapidDropletStrength <= 0
    || signal.rapid < settings.rapidDropletThreshold
    || sample.depth <= 0.03
    || sample.wetMask <= 0.08
  ) {
    return [];
  }

  const flowLength = Math.hypot(sample.flowX, sample.flowZ);
  const directionX = flowLength > 0.001 ? sample.flowX / flowLength : 1;
  const directionZ = flowLength > 0.001 ? sample.flowZ / flowLength : 0;
  const sideX = -directionZ;
  const sideZ = directionX;
  const count = Math.max(
    1,
    Math.min(
      settings.rapidDropletsPerEmitter,
      Math.ceil(settings.rapidDropletsPerEmitter * clamp01(signal.rapid)),
    ),
  );
  const result: BallisticParticle[] = [];

  for (let index = 0; index < count; index += 1) {
    const channel = emitTick * 131 + index * 17;
    const originSide = signedHash(cellX, cellZ, channel + 1, 0.62);
    const originAlong = signedHash(cellX, cellZ, channel + 2, 0.34);
    const sideVelocity = signedHash(cellX, cellZ, channel + 3, 0.95);
    const forwardNoise = hash2(cellX, cellZ, channel + 4);
    const verticalNoise = hash2(cellX, cellZ, channel + 5);
    const lifeNoise = hash2(cellX, cellZ, channel + 6);
    const strengthNoise = hash2(cellX, cellZ, channel + 7);
    const forwardSpeed = 0.34 + sample.flowStrength * 0.52 + forwardNoise * 0.34;

    result.push({
      originX: x + sideX * originSide + directionX * originAlong,
      originY: sample.waterY + WATER_SURFACE_OFFSET_M + 0.06,
      originZ: z + sideZ * originSide + directionZ * originAlong,
      velocityX: directionX * forwardSpeed + sideX * sideVelocity,
      velocityY: 0.58 + verticalNoise * 1.22 + signal.rapid * 0.82,
      velocityZ: directionZ * forwardSpeed + sideZ * sideVelocity,
      age: 0,
      life: 0.34 + lifeNoise * 0.48,
      strength: signal.rapid * settings.rapidDropletStrength * (0.62 + strengthNoise * 0.38),
    });
  }

  return result;
}

export class RiverCascadeParticleOverlay {
  private readonly group = new THREE.Group();
  private readonly mist = makeLayer("river-cascade-mist", MAX_MIST_PARTICLES, 2.2, 0.36, 0.03);
  private readonly splash = makeLayer("river-cascade-splash", MAX_SPLASH_PARTICLES, 0.92, 0.76, -3.4);
  private readonly rapidDroplets = makeBallisticLayer("river-rapid-droplets", MAX_RAPID_DROPLETS, 0.48, 0.82);
  private readonly foam = makeLayer("river-cascade-foam-drift", MAX_FOAM_PARTICLES, 1.22, 0.58, 0.0);
  private readonly mistColor = new THREE.Color(0xdceff5);
  private readonly splashColor = new THREE.Color(0xf4fbff);
  private readonly rapidDropletColor = new THREE.Color(0xe9f7ff);
  private readonly foamColor = new THREE.Color(0xe4eee9);
  private readonly settings = readRiverCascadeParticleSettings();
  private readonly sampleReader: RiverDressingSampleReader;
  private emitTime = EMIT_INTERVAL_S;
  private emitTick = 0;
  private lastEmitters = 0;
  private lastCascadeEmitters = 0;
  private lastRapidEmitters = 0;
  private lastMaxCascade = 0;
  private lastMaxRapid = 0;
  private emitterScan: EmitterScan | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    field: WaterField,
    options: RiverCascadeParticleOverlayOptions = {},
  ) {
    this.sampleReader = new RiverDressingSampleReader(field, readerOptions(options));
    this.group.name = "river-cascade-particle-overlay";
    this.group.add(this.foam.points, this.mist.points, this.splash.points, this.rapidDroplets.points);
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
      rapidDroplets: this.rapidDroplets.particles.length,
      foam: this.foam.particles.length,
      lastEmitters: this.lastEmitters,
      lastCascadeEmitters: this.lastCascadeEmitters,
      lastRapidEmitters: this.lastRapidEmitters,
      lastMaxCascade: this.lastMaxCascade,
      lastMaxRapid: this.lastMaxRapid,
    };
  }

  getSamplingStats(): RiverDressingSamplingStats {
    return this.sampleReader.getStats();
  }

  update(deltaSeconds: number, cameraPosition: THREE.Vector3): void {
    if (!this.group.visible) return;
    advanceLayer(this.mist, deltaSeconds);
    advanceLayer(this.splash, deltaSeconds);
    advanceBallisticLayer(this.rapidDroplets, deltaSeconds);
    this.advanceFoam(deltaSeconds);
    this.emitTime += deltaSeconds;
    if (this.emitTime >= EMIT_INTERVAL_S && this.emitterScan === null) {
      this.emitTime = 0;
      this.beginEmit(cameraPosition);
    }
    this.stepEmit();
    writeLayer(this.mist, this.mistColor, 1.9);
    writeLayer(this.splash, this.splashColor, 1.15);
    writeBallisticLayer(
      this.rapidDroplets,
      this.rapidDropletColor,
      1.25,
      this.settings.rapidDropletGravity,
    );
    writeLayer(this.foam, this.foamColor, 1.5);
    publishRapidDropletCounters(this.rapidDroplets.particles.length, this.lastRapidEmitters);
  }

  dispose(): void {
    this.scene.remove(this.group);
    for (const layer of [this.mist, this.splash, this.rapidDroplets, this.foam]) {
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
    this.emitTick += 1;
    this.emitterScan = {
      baseX: Math.round(cameraPosition.x / EMIT_SPACING_M),
      baseZ: Math.round(cameraPosition.z / EMIT_SPACING_M),
      centerX: cameraPosition.x,
      centerZ: cameraPosition.z,
      tick: this.emitTick,
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
      const gridX = cursor % EMIT_GRID - half;
      const gridZ = Math.floor(cursor / EMIT_GRID) - half;
      const cellX = scan.baseX + gridX;
      const cellZ = scan.baseZ + gridZ;
      const x = (cellX + 0.5 + signedHash(cellX, cellZ, scan.tick * 11 + 1, 0.28)) * EMIT_SPACING_M;
      const z = (cellZ + 0.5 + signedHash(cellX, cellZ, scan.tick * 11 + 2, 0.28)) * EMIT_SPACING_M;
      if (Math.hypot(x - scan.centerX, z - scan.centerZ) > radius) continue;
      const sample = this.sampleReader.sampleRiver(x, z);
      if (!sample) continue;
      const signal = cascadeParticleSignal(sample, this.settings);
      this.lastMaxCascade = Math.max(this.lastMaxCascade, signal.cascade);
      this.lastMaxRapid = Math.max(this.lastMaxRapid, signal.rapid);
      if (signal.foam <= 0.08) continue;
      const chance = Math.min(0.92, signal.foam * 0.74 + hash2(cellX, cellZ, 19) * 0.10);
      if (hash2(cellX, cellZ, scan.tick * 29 + 7) > chance) continue;
      this.lastEmitters += 1;
      if (signal.cascade > 0.12) this.lastCascadeEmitters += 1;
      if (signal.rapid > 0.12) this.lastRapidEmitters += 1;
      this.spawnAt(cellX, cellZ, scan.tick, x, z, sample, signal);
    }
    if (scan.cursor >= totalCells || this.lastEmitters >= this.settings.maxEmittersPerTick) {
      this.emitterScan = null;
    }
  }

  private spawnAt(
    cellX: number,
    cellZ: number,
    emitTick: number,
    x: number,
    z: number,
    sample: RiverDressingSample,
    signal: CascadeParticleSignal,
  ): void {
    const flowX = Math.abs(sample.flowX) > 0.001 ? sample.flowX : randomSigned(1);
    const flowZ = Math.abs(sample.flowZ) > 0.001 ? sample.flowZ : randomSigned(1);
    const flowLength = Math.max(0.001, Math.hypot(flowX, flowZ));
    const directionX = flowX / flowLength;
    const directionZ = flowZ / flowLength;
    const sideX = -directionZ;
    const sideZ = directionX;
    const y = sample.waterY + WATER_SURFACE_OFFSET_M;

    for (const droplet of rapidDropletSpawnSpecs(
      cellX,
      cellZ,
      emitTick,
      x,
      z,
      sample,
      signal,
      this.settings,
    )) {
      pushBallisticParticle(this.rapidDroplets, droplet);
    }

    if (this.settings.foamDriftStrength > 0) {
      const strength = signal.foam * this.settings.foamDriftStrength;
      pushParticle(this.foam, {
        x: x + randomSigned(0.45),
        y: y + 0.04,
        z: z + randomSigned(0.45),
        vx: directionX * (0.46 + sample.flowStrength * 0.38) + sideX * randomSigned(0.18),
        vy: 0,
        vz: directionZ * (0.46 + sample.flowStrength * 0.38) + sideZ * randomSigned(0.18),
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
        vx: directionX * (0.14 + sample.flowStrength * 0.12) + randomSigned(0.18),
        vy: 0.22 + Math.random() * 0.44,
        vz: directionZ * (0.14 + sample.flowStrength * 0.12) + randomSigned(0.18),
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
        vx: directionX * (0.78 + sample.flowStrength * 0.50) + sideX * randomSigned(0.72),
        vy: 1.2 + Math.random() * 1.7 + signal.cascade * 0.78,
        vz: directionZ * (0.78 + sample.flowStrength * 0.50) + sideZ * randomSigned(0.72),
        age: 0,
        life: 0.42 + Math.random() * 0.58,
        strength,
      });
    }
  }

  private advanceFoam(deltaSeconds: number): void {
    let write = 0;
    for (let read = 0; read < this.foam.particles.length; read += 1) {
      const particle = this.foam.particles[read]!;
      particle.age += deltaSeconds;
      if (particle.age >= particle.life) continue;
      particle.x += particle.vx * deltaSeconds;
      particle.z += particle.vz * deltaSeconds;
      particle.vx *= 0.992;
      particle.vz *= 0.992;
      const water = this.sampleReader.sampleWater(particle.x, particle.z);
      if (!water || water.depth <= 0.02 || water.wetMask <= 0.04) continue;
      particle.y = water.waterY + 0.045;
      this.foam.particles[write] = particle;
      write += 1;
    }
    this.foam.particles.length = write;
  }
}

function readerOptions(options: RiverCascadeParticleOverlayOptions): {
  sampleHintM?: number;
  readEnvironmentQuery?: () => EnvironmentQuery | null;
} {
  return {
    ...(options.minimumSampleHintM !== undefined
      ? { sampleHintM: options.minimumSampleHintM }
      : {}),
    ...(options.readEnvironmentQuery
      ? { readEnvironmentQuery: options.readEnvironmentQuery }
      : {}),
  };
}

function makeLayer(
  name: string,
  max: number,
  size: number,
  opacity: number,
  gravity: number,
): ParticleLayer {
  const shared = makePoints(name, max, size, opacity);
  return { ...shared, particles: [], max, gravity };
}

function makeBallisticLayer(
  name: string,
  max: number,
  size: number,
  opacity: number,
): BallisticParticleLayer {
  const shared = makePoints(name, max, size, opacity);
  return { ...shared, particles: [], max };
}

function makePoints(
  name: string,
  max: number,
  size: number,
  opacity: number,
): {
  points: THREE.Points;
  positions: Float32Array;
  colors: Float32Array;
} {
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
  return { points, positions, colors };
}

function pushParticle(layer: ParticleLayer, particle: Particle): void {
  if (layer.particles.length >= layer.max) layer.particles.shift();
  layer.particles.push(particle);
}

function pushBallisticParticle(layer: BallisticParticleLayer, particle: BallisticParticle): void {
  if (layer.particles.length >= layer.max) layer.particles.shift();
  layer.particles.push(particle);
}

function writeLayer(layer: ParticleLayer, color: THREE.Color, fadePower: number): void {
  const count = layer.particles.length;
  for (let index = 0; index < count; index += 1) {
    const particle = layer.particles[index]!;
    const fade = particleFade(particle.age, particle.life, particle.strength, fadePower);
    const vertex = index * 3;
    layer.positions[vertex] = particle.x;
    layer.positions[vertex + 1] = particle.y;
    layer.positions[vertex + 2] = particle.z;
    layer.colors[vertex] = color.r * fade;
    layer.colors[vertex + 1] = color.g * fade;
    layer.colors[vertex + 2] = color.b * fade;
  }
  finishLayerWrite(layer.points, count);
}

function writeBallisticLayer(
  layer: BallisticParticleLayer,
  color: THREE.Color,
  fadePower: number,
  gravity: number,
): void {
  const count = layer.particles.length;
  const gravityMagnitude = Math.max(0, gravity);
  for (let index = 0; index < count; index += 1) {
    const particle = layer.particles[index]!;
    const t = particle.age;
    const fade = particleFade(particle.age, particle.life, particle.strength, fadePower);
    const vertex = index * 3;
    layer.positions[vertex] = particle.originX + particle.velocityX * t;
    layer.positions[vertex + 1] = particle.originY + particle.velocityY * t - 0.5 * gravityMagnitude * t * t;
    layer.positions[vertex + 2] = particle.originZ + particle.velocityZ * t;
    layer.colors[vertex] = color.r * fade;
    layer.colors[vertex + 1] = color.g * fade;
    layer.colors[vertex + 2] = color.b * fade;
  }
  finishLayerWrite(layer.points, count);
}

function finishLayerWrite(points: THREE.Points, count: number): void {
  points.geometry.setDrawRange(0, count);
  const position = points.geometry.getAttribute("position") as THREE.BufferAttribute;
  const colorAttribute = points.geometry.getAttribute("color") as THREE.BufferAttribute;
  position.needsUpdate = true;
  colorAttribute.needsUpdate = true;
}

function particleFade(age: number, life: number, strength: number, fadePower: number): number {
  return Math.pow(
    1 - clamp01(age / Math.max(0.001, life)),
    fadePower,
  ) * strength;
}

function advanceLayer(layer: ParticleLayer, deltaSeconds: number): void {
  let write = 0;
  for (let read = 0; read < layer.particles.length; read += 1) {
    const particle = layer.particles[read]!;
    particle.age += deltaSeconds;
    if (particle.age >= particle.life) continue;
    particle.vy += layer.gravity * deltaSeconds;
    particle.x += particle.vx * deltaSeconds;
    particle.y += particle.vy * deltaSeconds;
    particle.z += particle.vz * deltaSeconds;
    particle.vx *= 0.986;
    particle.vz *= 0.986;
    layer.particles[write] = particle;
    write += 1;
  }
  layer.particles.length = write;
}

function advanceBallisticLayer(layer: BallisticParticleLayer, deltaSeconds: number): void {
  let write = 0;
  for (let read = 0; read < layer.particles.length; read += 1) {
    const particle = layer.particles[read]!;
    particle.age += deltaSeconds;
    if (particle.age >= particle.life) continue;
    layer.particles[write] = particle;
    write += 1;
  }
  layer.particles.length = write;
}

function publishRapidDropletCounters(active: number, emitters: number): void {
  const counters = (globalThis as typeof globalThis & {
    window?: { __drusnielClod?: { stats?: { counters?: Record<string, number> } } };
  }).window?.__drusnielClod?.stats?.counters;
  if (!counters) return;
  counters["river_rapid_droplets_active"] = active;
  counters["river_rapid_droplet_emitters"] = emitters;
  counters["river_rapid_droplet_readbacks"] = 0;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smooth01(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function hash2(x: number, z: number, seed: number): number {
  const value = Math.sin(x * 41.3 + z * 289.1 + seed * 17.17) * 43758.5453;
  return value - Math.floor(value);
}

function signedHash(x: number, z: number, seed: number, scale: number): number {
  return (hash2(x, z, seed) * 2 - 1) * scale;
}

function randomSigned(scale: number): number {
  return (Math.random() * 2 - 1) * scale;
}
