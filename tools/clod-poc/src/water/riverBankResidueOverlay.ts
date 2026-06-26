import * as THREE from "three";
import type { WaterField } from "./waterField.js";
import { readRiverMaterialSettings } from "./riverMaterialRuntime.js";

interface ResidueSample {
  x: number;
  y: number;
  z: number;
  wet: number;
  foam: number;
}

const SAMPLE_GRID = 23;
const SAMPLE_SPACING_M = 3.5;
const MAX_WET_POINTS = 420;
const MAX_FOAM_POINTS = 220;
const UPDATE_INTERVAL_S = 0.28;
const MIN_CAMERA_MOVE_M = 2.5;

function hash2(x: number, z: number, seed: number): number {
  const v = Math.sin(x * 41.3 + z * 289.1 + seed * 17.17) * 43758.5453;
  return v - Math.floor(v);
}

function smooth01(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

function makePoints(name: string, color: THREE.Color, size: number, opacity: number): THREE.Points {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(3), 3));
  const material = new THREE.PointsMaterial({
    size,
    sizeAttenuation: true,
    transparent: true,
    opacity,
    vertexColors: true,
    depthWrite: false,
    depthTest: true,
    color,
  });
  const points = new THREE.Points(geometry, material);
  points.name = name;
  points.frustumCulled = false;
  return points;
}

function replacePoints(points: THREE.Points, samples: ResidueSample[], kind: "wet" | "foam"): void {
  const positions = new Float32Array(Math.max(1, samples.length) * 3);
  const colors = new Float32Array(Math.max(1, samples.length) * 3);
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const strength = kind === "wet" ? s.wet : s.foam;
    positions[i * 3 + 0] = s.x;
    positions[i * 3 + 1] = s.y;
    positions[i * 3 + 2] = s.z;
    if (kind === "wet") {
      colors[i * 3 + 0] = 0.055 + strength * 0.020;
      colors[i * 3 + 1] = 0.070 + strength * 0.035;
      colors[i * 3 + 2] = 0.060 + strength * 0.035;
    } else {
      colors[i * 3 + 0] = 0.78 + strength * 0.18;
      colors[i * 3 + 1] = 0.84 + strength * 0.14;
      colors[i * 3 + 2] = 0.82 + strength * 0.14;
    }
  }
  points.geometry.dispose();
  points.geometry = new THREE.BufferGeometry();
  points.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  points.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  points.geometry.setDrawRange(0, samples.length);
}

export class RiverBankResidueOverlay {
  private readonly group = new THREE.Group();
  private readonly wetPoints = makePoints("river-bank-wetness-decals", new THREE.Color(0x1b241d), 1.15, 0.55);
  private readonly foamPoints = makePoints("river-bank-foam-residue", new THREE.Color(0xdce8e4), 0.85, 0.62);
  private readonly settings = readRiverMaterialSettings();
  private elapsed = UPDATE_INTERVAL_S;
  private lastCenter = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, Number.POSITIVE_INFINITY);

  constructor(private readonly scene: THREE.Scene, private readonly field: WaterField) {
    this.group.name = "river-bank-residue-overlay";
    this.group.add(this.wetPoints, this.foamPoints);
    this.scene.add(this.group);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  update(deltaSeconds: number, cameraPosition: THREE.Vector3): void {
    this.elapsed += deltaSeconds;
    const moved = Math.hypot(cameraPosition.x - this.lastCenter.x, cameraPosition.z - this.lastCenter.z);
    if (this.elapsed < UPDATE_INTERVAL_S && moved < MIN_CAMERA_MOVE_M) return;
    this.elapsed = 0;
    this.lastCenter.copy(cameraPosition);
    this.rebuild(cameraPosition.x, cameraPosition.z);
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.wetPoints.geometry.dispose();
    this.foamPoints.geometry.dispose();
    (this.wetPoints.material as THREE.Material).dispose();
    (this.foamPoints.material as THREE.Material).dispose();
  }

  private rebuild(centerX: number, centerZ: number): void {
    if (this.settings.wetBankStrength <= 0 && this.settings.foamResidueStrength <= 0) {
      replacePoints(this.wetPoints, [], "wet");
      replacePoints(this.foamPoints, [], "foam");
      return;
    }

    const wet: ResidueSample[] = [];
    const foam: ResidueSample[] = [];
    const half = Math.floor(SAMPLE_GRID / 2);
    const distM = Math.max(0.5, this.settings.wetBankDistanceM);
    const offsets = [
      [distM, 0], [-distM, 0], [0, distM], [0, -distM],
      [distM * 0.7, distM * 0.7], [-distM * 0.7, distM * 0.7],
      [distM * 0.7, -distM * 0.7], [-distM * 0.7, -distM * 0.7],
    ] as const;

    for (let gz = -half; gz <= half; gz++) {
      for (let gx = -half; gx <= half; gx++) {
        const cellX = Math.round(centerX / SAMPLE_SPACING_M) + gx;
        const cellZ = Math.round(centerZ / SAMPLE_SPACING_M) + gz;
        const jx = hash2(cellX, cellZ, 11) - 0.5;
        const jz = hash2(cellX, cellZ, 23) - 0.5;
        const x = (cellX + 0.5 + jx * 0.45) * SAMPLE_SPACING_M;
        const z = (cellZ + 0.5 + jz * 0.45) * SAMPLE_SPACING_M;
        const here = this.field.sample(x, z);
        if (here.depth > 0.04) continue;

        let bestWet = 0;
        let bestFoam = 0;
        for (const [ox, oz] of offsets) {
          const s = this.field.sample(x + ox, z + oz);
          if (s.depth <= 0 || s.bodyMask <= 0.05) continue;
          const distanceFade = 1 - Math.min(1, Math.hypot(ox, oz) / Math.max(0.01, distM * 1.2));
          const river = smooth01(s.flow.speed / 0.12);
          const wetSignal = distanceFade * Math.max(s.bodyMask, river * 0.8);
          const dropFoam = smooth01((s.flow.drop - this.settings.foamResidueDropStart) / Math.max(0.1, this.settings.foamResidueDropStart + 0.8));
          const speedFoam = smooth01(s.flow.speed / 0.85);
          bestWet = Math.max(bestWet, wetSignal);
          bestFoam = Math.max(bestFoam, wetSignal * Math.max(dropFoam, speedFoam * 0.42));
        }

        const noise = hash2(cellX, cellZ, 37);
        const wetStrength = bestWet * this.settings.wetBankStrength;
        const foamStrength = bestFoam * this.settings.foamResidueStrength;
        if (wet.length < MAX_WET_POINTS && wetStrength > 0.08 && noise < Math.min(0.95, wetStrength)) {
          wet.push({ x, y: here.terrainY + 0.055, z, wet: Math.min(1, wetStrength), foam: 0 });
        }
        if (foam.length < MAX_FOAM_POINTS && foamStrength > 0.10 && hash2(cellX, cellZ, 41) < Math.min(0.82, foamStrength)) {
          foam.push({ x, y: here.terrainY + 0.075, z, wet: 0, foam: Math.min(1, foamStrength) });
        }
      }
    }

    replacePoints(this.wetPoints, wet, "wet");
    replacePoints(this.foamPoints, foam, "foam");
  }
}
