import * as THREE from "three";
import { readActiveBiomeVisualState } from "../environment/biome_visual_state_runtime.js";
import type { BiomeVisualState } from "../environment/biome_visual_state.js";
import type { WaterField, WaterFieldResult } from "./waterField.js";
import { RiverMistParticlePool } from "./riverMistParticlePool.js";
import {
  riverMistSignal,
  type RiverMistRuntimeSettings,
} from "./riverMistRuntime.js";

export interface RiverMistOverlayStats {
  readonly enabled: boolean;
  readonly particles: number;
  readonly scanPending: boolean;
  readonly lastSampledCells: number;
  readonly lastEmitters: number;
  readonly lastMaxSignal: number;
}

export interface RiverMistOverlayOptions {
  readonly settings: RiverMistRuntimeSettings;
  readonly readBiomeState?: () => BiomeVisualState | null;
}

export class RiverMistOverlay {
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.PointsMaterial;
  private readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly pool: RiverMistParticlePool;
  private readonly readBiomeState: () => BiomeVisualState | null;
  private readonly halfGrid: number;
  private readonly gridSide: number;
  private readonly sampleHintM: number;
  private emitTimeS: number;
  private visible = true;
  private scanActive = false;
  private scanBaseX = 0;
  private scanBaseZ = 0;
  private scanCenterX = 0;
  private scanCenterZ = 0;
  private scanCursor = 0;
  private scanGeneration = 0;
  private lastSampledCells = 0;
  private lastEmitters = 0;
  private lastMaxSignal = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly field: WaterField,
    private readonly options: RiverMistOverlayOptions,
  ) {
    const particles = options.settings.mask.particles;
    this.pool = new RiverMistParticlePool(particles.maxParticles);
    this.positions = new Float32Array(particles.maxParticles * 3);
    this.colors = new Float32Array(particles.maxParticles * 3);
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.PointsMaterial({
      size: particles.pointSizeM,
      transparent: true,
      opacity: particles.opacity,
      vertexColors: true,
      depthWrite: false,
      depthTest: true,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = "river-mist-overlay";
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.readBiomeState = options.readBiomeState ?? readActiveBiomeVisualState;
    this.halfGrid = Math.ceil(particles.spawnRadiusM / particles.spacingM);
    this.gridSide = this.halfGrid * 2 + 1;
    this.sampleHintM = Math.max(particles.spacingM, particles.sampleHintM);
    this.emitTimeS = particles.emitIntervalS;
    this.scene.add(this.points);
    this.applyVisibility();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (!visible) this.clearParticles();
    this.applyVisibility();
  }

  getStats(): RiverMistOverlayStats {
    return {
      enabled: this.points.visible,
      particles: this.pool.count,
      scanPending: this.scanActive,
      lastSampledCells: this.lastSampledCells,
      lastEmitters: this.lastEmitters,
      lastMaxSignal: this.lastMaxSignal,
    };
  }

  update(deltaSeconds: number, cameraPosition: THREE.Vector3): void {
    if (!this.points.visible) return;
    const safeDeltaSeconds = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    this.pool.advance(safeDeltaSeconds);
    const biome = this.readBiomeState();
    if (!biome?.enabled || biome.morningMist <= 0.001) {
      this.clearParticles();
      return;
    }

    const particles = this.options.settings.mask.particles;
    this.emitTimeS += safeDeltaSeconds;
    if (!this.scanActive && this.emitTimeS >= particles.emitIntervalS) {
      this.emitTimeS = 0;
      this.beginScan(cameraPosition);
    }
    if (this.scanActive) this.stepScan(biome);
    this.writeParticles();
  }

  dispose(): void {
    this.scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
    this.pool.clear();
  }

  private applyVisibility(): void {
    this.points.visible = this.visible && this.options.settings.enabled;
  }

  private clearParticles(): void {
    this.scanActive = false;
    this.pool.clear();
    this.geometry.setDrawRange(0, 0);
  }

  private beginScan(cameraPosition: THREE.Vector3): void {
    const spacing = this.options.settings.mask.particles.spacingM;
    this.scanBaseX = Math.round(cameraPosition.x / spacing);
    this.scanBaseZ = Math.round(cameraPosition.z / spacing);
    this.scanCenterX = cameraPosition.x;
    this.scanCenterZ = cameraPosition.z;
    this.scanCursor = 0;
    this.scanGeneration += 1;
    this.lastSampledCells = 0;
    this.lastEmitters = 0;
    this.lastMaxSignal = 0;
    this.scanActive = true;
  }

  private stepScan(biome: BiomeVisualState): void {
    const particles = this.options.settings.mask.particles;
    const totalCells = this.gridSide * this.gridSide;
    const end = Math.min(totalCells, this.scanCursor + particles.scanCellsPerFrame);
    while (this.scanCursor < end && this.lastEmitters < particles.maxEmittersPerTick) {
      const cursor = this.scanCursor++;
      const gridX = cursor % this.gridSide - this.halfGrid;
      const gridZ = Math.floor(cursor / this.gridSide) - this.halfGrid;
      const cellX = this.scanBaseX + gridX;
      const cellZ = this.scanBaseZ + gridZ;
      const jitterX = hashSigned(cellX, cellZ, this.scanGeneration * 7 + 1) * 0.28;
      const jitterZ = hashSigned(cellX, cellZ, this.scanGeneration * 7 + 2) * 0.28;
      const x = (cellX + 0.5 + jitterX) * particles.spacingM;
      const z = (cellZ + 0.5 + jitterZ) * particles.spacingM;
      if (Math.hypot(x - this.scanCenterX, z - this.scanCenterZ) > particles.spawnRadiusM) continue;

      const sample = this.field.sampleForCellSize(x, z, this.sampleHintM);
      this.lastSampledCells += 1;
      const signal = riverMistSignal(sample, biome, this.options.settings);
      this.lastMaxSignal = Math.max(this.lastMaxSignal, signal);
      if (signal <= 0.01) continue;
      const chance = Math.min(1, signal * particles.spawnProbability);
      if (hash01(cellX, cellZ, this.scanGeneration * 11 + 3) > chance) continue;
      this.spawnParticle(x, z, cellX, cellZ, sample, signal);
      this.lastEmitters += 1;
    }
    if (this.scanCursor >= totalCells || this.lastEmitters >= particles.maxEmittersPerTick) {
      this.scanActive = false;
    }
  }

  private spawnParticle(
    x: number,
    z: number,
    cellX: number,
    cellZ: number,
    sample: WaterFieldResult,
    signal: number,
  ): void {
    const particles = this.options.settings.mask.particles;
    const flowLength = Math.hypot(sample.flow.x, sample.flow.z);
    const fallbackAngle = hash01(cellX, cellZ, this.scanGeneration * 13 + 4) * Math.PI * 2;
    const directionX = flowLength > 0.001 ? sample.flow.x / flowLength : Math.cos(fallbackAngle);
    const directionZ = flowLength > 0.001 ? sample.flow.z / flowLength : Math.sin(fallbackAngle);
    const sideX = -directionZ;
    const sideZ = directionX;
    const side = hashSigned(cellX, cellZ, this.scanGeneration * 13 + 5);
    const forward = 0.55 + hash01(cellX, cellZ, this.scanGeneration * 13 + 6) * 0.55;
    const lifeT = hash01(cellX, cellZ, this.scanGeneration * 13 + 7);
    const heightT = hash01(cellX, cellZ, this.scanGeneration * 13 + 8);
    const drift = particles.driftSpeedMps * (0.7 + Math.min(1, sample.flow.speed) * 0.45);

    this.pool.spawn({
      x: x + sideX * side * particles.spacingM * 0.28,
      y: sample.waterY + particles.surfaceOffsetM + heightT * particles.surfaceOffsetM * 0.5,
      z: z + sideZ * side * particles.spacingM * 0.28,
      vx: directionX * drift * forward + sideX * side * drift * 0.45,
      vy: particles.riseSpeedMps * (0.75 + heightT * 0.5),
      vz: directionZ * drift * forward + sideZ * side * drift * 0.45,
      lifeS: lerp(particles.minLifetimeS, particles.maxLifetimeS, lifeT),
      strength: signal * (0.7 + heightT * 0.3),
    });
  }

  private writeParticles(): void {
    const count = this.pool.write(
      this.positions,
      this.colors,
      this.options.settings.mask.particles.colorRgb,
    );
    this.geometry.setDrawRange(0, count);
    (this.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
  }
}

function hash01(x: number, z: number, seed: number): number {
  const value = Math.sin(x * 41.3 + z * 289.1 + seed * 17.17) * 43758.5453;
  return value - Math.floor(value);
}

function hashSigned(x: number, z: number, seed: number): number {
  return hash01(x, z, seed) * 2 - 1;
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}
