import * as THREE from "three";
import type { EnvironmentQuery } from "../environment_query/types.js";
import {
  HYDROLOGY_BODY_LAKE,
  HYDROLOGY_BODY_MARSH,
  HYDROLOGY_BODY_POND,
  HYDROLOGY_BODY_RIVER,
} from "./hydrologyGrid.js";
import {
  readCalmWaterRiseRingSettings,
  type CalmWaterRiseRingSettings,
} from "./calmWaterRiseRingsRuntime.js";
import {
  RiverDressingSampleReader,
  type RiverDressingSample,
  type RiverDressingSamplingStats,
} from "./riverDressingSampleReader.js";
import type { WaterField } from "./waterField.js";

export interface CalmWaterRiseRingSignal {
  readonly value: number;
  readonly calmFlow: number;
  readonly calmBed: number;
  readonly shoreInterior: number;
}

export interface CalmWaterRiseRingSpec {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly life: number;
  readonly startRadius: number;
  readonly endRadius: number;
  readonly strength: number;
  readonly phase: number;
}

export interface CalmWaterRiseRingStats {
  readonly active: number;
  readonly lastEmitters: number;
  readonly lastMaxSignal: number;
  readonly lastScannedCells: number;
}

export interface CalmWaterRiseRingOverlayOptions {
  readonly minimumSampleHintM?: number;
  readonly readEnvironmentQuery?: () => EnvironmentQuery | null;
  readonly settings?: CalmWaterRiseRingSettings;
}

interface ActiveRing extends CalmWaterRiseRingSpec {
  age: number;
}

interface RingScan {
  readonly baseX: number;
  readonly baseZ: number;
  readonly centerX: number;
  readonly centerZ: number;
  readonly scanId: number;
  cursor: number;
}

const WATER_SURFACE_OFFSET_M = 0.045;
const RING_COLOR = new THREE.Color(0xd9f2f4);

export function calmWaterRiseRingSignal(
  sample: RiverDressingSample,
  settings: CalmWaterRiseRingSettings,
): CalmWaterRiseRingSignal {
  if (
    !settings.enabled
    || settings.strength <= 0
    || sample.wetMask <= 0.08
    || sample.depth < settings.minimumDepthM
    || sample.shoreDistanceM < settings.minimumShoreDistanceM
    || sample.flowStrength > settings.maximumFlowStrength
    || sample.bedDrop > settings.maximumBedDropM
    || !supportsCalmRiseRings(sample.bodyKind)
  ) {
    return { value: 0, calmFlow: 0, calmBed: 0, shoreInterior: 0 };
  }

  const calmFlow = 1 - smooth01(sample.flowStrength / Math.max(0.001, settings.maximumFlowStrength));
  const calmBed = 1 - smooth01(sample.bedDrop / Math.max(0.001, settings.maximumBedDropM));
  const shoreInterior = smooth01(
    (sample.shoreDistanceM - settings.minimumShoreDistanceM)
    / Math.max(1, settings.minimumShoreDistanceM),
  );
  const depthInterior = smooth01(
    (sample.depth - settings.minimumDepthM)
    / Math.max(0.5, settings.minimumDepthM * 2),
  );
  const bodyWeight = sample.bodyKind === HYDROLOGY_BODY_RIVER ? 0.72 : 1;
  const value = clamp01(
    smooth01(sample.wetMask)
    * Math.max(0.35, depthInterior)
    * Math.max(0.35, shoreInterior)
    * calmFlow
    * calmBed
    * bodyWeight,
  );
  return { value, calmFlow, calmBed, shoreInterior };
}

export function resolveCalmWaterRiseRingSpec(
  cellX: number,
  cellZ: number,
  scanId: number,
  x: number,
  z: number,
  sample: RiverDressingSample,
  settings: CalmWaterRiseRingSettings,
): CalmWaterRiseRingSpec | null {
  const signal = calmWaterRiseRingSignal(sample, settings);
  if (signal.value <= 0) return null;
  const chance = clamp01(signal.value * settings.strength * 0.32);
  if (hash2(cellX, cellZ, scanId * 97 + 11) >= chance) return null;

  const lifeT = hash2(cellX, cellZ, scanId * 97 + 19);
  const radiusT = hash2(cellX, cellZ, scanId * 97 + 23);
  const phase = hash2(cellX, cellZ, scanId * 97 + 29) * Math.PI * 2;
  return {
    x,
    y: sample.waterY + WATER_SURFACE_OFFSET_M,
    z,
    life: mix(settings.lifeMinS, settings.lifeMaxS, lifeT),
    startRadius: settings.startRadiusM * mix(0.82, 1.18, radiusT),
    endRadius: settings.endRadiusM * mix(0.78, 1.22, radiusT),
    strength: signal.value * settings.strength,
    phase,
  };
}

export class CalmWaterRiseRingOverlay {
  private readonly settings: CalmWaterRiseRingSettings;
  private readonly sampleReader: RiverDressingSampleReader;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material = new THREE.LineBasicMaterial({
    transparent: true,
    opacity: 0.72,
    vertexColors: true,
    depthWrite: false,
    depthTest: true,
  });
  private readonly lines: THREE.LineSegments;
  private readonly rings: ActiveRing[] = [];
  private scan: RingScan | null = null;
  private scanId = 0;
  private scanTimer = 0;
  private lastEmitters = 0;
  private lastMaxSignal = 0;
  private lastScannedCells = 0;

  constructor(
    private readonly scene: THREE.Scene,
    field: WaterField,
    options: CalmWaterRiseRingOverlayOptions = {},
  ) {
    this.settings = options.settings ?? readCalmWaterRiseRingSettings();
    this.sampleReader = new RiverDressingSampleReader(field, readerOptions(options));
    const vertices = this.settings.maxRings * this.settings.segmentsPerRing * 2;
    this.positions = new Float32Array(vertices * 3);
    this.colors = new Float32Array(vertices * 3);
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setDrawRange(0, 0);
    this.lines = new THREE.LineSegments(this.geometry, this.material);
    this.lines.name = "calm-water-rise-rings";
    this.lines.frustumCulled = false;
    this.lines.visible = this.settings.enabled;
    this.scene.add(this.lines);
  }

  setVisible(visible: boolean): void {
    this.lines.visible = visible && this.settings.enabled;
  }

  update(deltaSeconds: number, cameraPosition: THREE.Vector3): void {
    if (!this.lines.visible) return;
    this.advance(deltaSeconds);
    if (!this.scan) {
      this.scanTimer += Math.max(0, deltaSeconds);
      if (this.scanTimer >= this.settings.scanIntervalS) {
        this.scanTimer = 0;
        this.beginScan(cameraPosition);
      }
    }
    this.stepScan();
    this.writeGeometry();
    publishCounters(this.getStats());
  }

  getStats(): CalmWaterRiseRingStats {
    return {
      active: this.rings.length,
      lastEmitters: this.lastEmitters,
      lastMaxSignal: this.lastMaxSignal,
      lastScannedCells: this.lastScannedCells,
    };
  }

  getSamplingStats(): RiverDressingSamplingStats {
    return this.sampleReader.getStats();
  }

  dispose(): void {
    this.scene.remove(this.lines);
    this.geometry.dispose();
    this.material.dispose();
  }

  private beginScan(cameraPosition: THREE.Vector3): void {
    this.scanId += 1;
    this.lastEmitters = 0;
    this.lastMaxSignal = 0;
    this.lastScannedCells = 0;
    this.scan = {
      baseX: Math.round(cameraPosition.x / this.settings.cellSpacingM),
      baseZ: Math.round(cameraPosition.z / this.settings.cellSpacingM),
      centerX: cameraPosition.x,
      centerZ: cameraPosition.z,
      scanId: this.scanId,
      cursor: 0,
    };
  }

  private stepScan(): void {
    const scan = this.scan;
    if (!scan) return;
    const grid = this.settings.scanGrid;
    const half = Math.floor(grid / 2);
    const total = grid * grid;
    const end = Math.min(total, scan.cursor + this.settings.cellsPerFrame);
    while (scan.cursor < end && this.lastEmitters < this.settings.maxEmittersPerScan) {
      const cursor = scan.cursor++;
      this.lastScannedCells += 1;
      const gridX = cursor % grid - half;
      const gridZ = Math.floor(cursor / grid) - half;
      const cellX = scan.baseX + gridX;
      const cellZ = scan.baseZ + gridZ;
      const jitterX = signedHash(cellX, cellZ, scan.scanId * 43 + 3, 0.32);
      const jitterZ = signedHash(cellX, cellZ, scan.scanId * 43 + 5, 0.32);
      const x = (cellX + 0.5 + jitterX) * this.settings.cellSpacingM;
      const z = (cellZ + 0.5 + jitterZ) * this.settings.cellSpacingM;
      if (Math.hypot(x - scan.centerX, z - scan.centerZ) > this.settings.spawnRadiusM) continue;
      const sample = this.sampleReader.sampleRiver(x, z);
      if (!sample) continue;
      const signal = calmWaterRiseRingSignal(sample, this.settings);
      this.lastMaxSignal = Math.max(this.lastMaxSignal, signal.value);
      const spec = resolveCalmWaterRiseRingSpec(
        cellX,
        cellZ,
        scan.scanId,
        x,
        z,
        sample,
        this.settings,
      );
      if (!spec) continue;
      this.push(spec);
      this.lastEmitters += 1;
    }
    if (scan.cursor >= total || this.lastEmitters >= this.settings.maxEmittersPerScan) {
      this.scan = null;
    }
  }

  private push(spec: CalmWaterRiseRingSpec): void {
    if (this.rings.length >= this.settings.maxRings) this.rings.shift();
    this.rings.push({ ...spec, age: 0 });
  }

  private advance(deltaSeconds: number): void {
    let write = 0;
    for (let read = 0; read < this.rings.length; read += 1) {
      const ring = this.rings[read]!;
      ring.age += Math.max(0, deltaSeconds);
      if (ring.age >= ring.life) continue;
      this.rings[write] = ring;
      write += 1;
    }
    this.rings.length = write;
  }

  private writeGeometry(): void {
    const segments = this.settings.segmentsPerRing;
    let vertex = 0;
    for (const ring of this.rings) {
      const t = clamp01(ring.age / Math.max(0.001, ring.life));
      const eased = 1 - (1 - t) * (1 - t);
      const radius = mix(ring.startRadius, ring.endRadius, eased);
      const fade = Math.sin(Math.PI * t) * ring.strength;
      for (let segment = 0; segment < segments; segment += 1) {
        const angle0 = ring.phase + (segment / segments) * Math.PI * 2;
        const angle1 = ring.phase + ((segment + 1) / segments) * Math.PI * 2;
        vertex = writeVertex(this.positions, this.colors, vertex, ring, radius, angle0, fade);
        vertex = writeVertex(this.positions, this.colors, vertex, ring, radius, angle1, fade);
      }
    }
    this.geometry.setDrawRange(0, vertex);
    (this.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
  }
}

function writeVertex(
  positions: Float32Array,
  colors: Float32Array,
  vertex: number,
  ring: ActiveRing,
  radius: number,
  angle: number,
  fade: number,
): number {
  const offset = vertex * 3;
  positions[offset] = ring.x + Math.cos(angle) * radius;
  positions[offset + 1] = ring.y;
  positions[offset + 2] = ring.z + Math.sin(angle) * radius;
  colors[offset] = RING_COLOR.r * fade;
  colors[offset + 1] = RING_COLOR.g * fade;
  colors[offset + 2] = RING_COLOR.b * fade;
  return vertex + 1;
}

function supportsCalmRiseRings(bodyKind: number): boolean {
  return bodyKind === HYDROLOGY_BODY_LAKE
    || bodyKind === HYDROLOGY_BODY_RIVER
    || bodyKind === HYDROLOGY_BODY_POND
    || bodyKind === HYDROLOGY_BODY_MARSH;
}

function readerOptions(options: CalmWaterRiseRingOverlayOptions): {
  sampleHintM?: number;
  readEnvironmentQuery?: () => EnvironmentQuery | null;
} {
  return {
    ...(options.minimumSampleHintM !== undefined ? { sampleHintM: options.minimumSampleHintM } : {}),
    ...(options.readEnvironmentQuery ? { readEnvironmentQuery: options.readEnvironmentQuery } : {}),
  };
}

function publishCounters(stats: CalmWaterRiseRingStats): void {
  const counters = (globalThis as typeof globalThis & {
    window?: { __drusnielClod?: { stats?: { counters?: Record<string, number> } } };
  }).window?.__drusnielClod?.stats?.counters;
  if (!counters) return;
  counters["calm_water_rise_rings_active"] = stats.active;
  counters["calm_water_rise_ring_emitters"] = stats.lastEmitters;
  counters["calm_water_rise_ring_scanned_cells"] = stats.lastScannedCells;
  counters["calm_water_rise_ring_readbacks"] = 0;
}

function hash2(x: number, z: number, seed: number): number {
  const value = Math.sin(x * 41.3 + z * 289.1 + seed * 17.17) * 43758.5453;
  return value - Math.floor(value);
}

function signedHash(x: number, z: number, seed: number, scale: number): number {
  return (hash2(x, z, seed) * 2 - 1) * scale;
}

function smooth01(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
