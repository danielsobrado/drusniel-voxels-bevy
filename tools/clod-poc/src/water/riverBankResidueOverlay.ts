import * as THREE from "three";
import type { WaterField } from "./waterField.js";
import { readRiverMaterialSettings } from "./riverMaterialRuntime.js";

interface ResidueSample {
  x: number;
  y: number;
  z: number;
  wet: number;
  foam: number;
  drop: number;
  radius: number;
  angle: number;
  slopeFade: number;
}

const SAMPLE_GRID = 25;
const SAMPLE_SPACING_M = 3.25;
const MAX_WET_DECALS = 360;
const MAX_FOAM_DECALS = 180;
const UPDATE_INTERVAL_S = 0.28;
const MIN_CAMERA_MOVE_M = 2.5;
const NORMAL_SAMPLE_STEP_M = 1.2;
const DECAL_SURFACE_OFFSET_M = 0.055;

function hash2(x: number, z: number, seed: number): number {
  const v = Math.sin(x * 41.3 + z * 289.1 + seed * 17.17) * 43758.5453;
  return v - Math.floor(v);
}

function smooth01(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

function groundNormalY(field: WaterField, x: number, z: number): number {
  const hL = field.sample(x - NORMAL_SAMPLE_STEP_M, z).terrainY;
  const hR = field.sample(x + NORMAL_SAMPLE_STEP_M, z).terrainY;
  const hD = field.sample(x, z - NORMAL_SAMPLE_STEP_M).terrainY;
  const hU = field.sample(x, z + NORMAL_SAMPLE_STEP_M).terrainY;
  return new THREE.Vector3(hL - hR, NORMAL_SAMPLE_STEP_M * 2, hD - hU).normalize().y;
}

function slopeFadeForGround(field: WaterField, x: number, z: number): number {
  return smooth01((groundNormalY(field, x, z) - 0.35) / 0.45);
}

function makeDecalMesh(name: string, opacity: number): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(3), 3));
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity,
    vertexColors: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.frustumCulled = false;
  return mesh;
}

function replaceDecals(field: WaterField, mesh: THREE.Mesh, samples: ResidueSample[], kind: "wet" | "foam"): void {
  const vertexCount = Math.max(1, samples.length * 6);
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const strength = (kind === "wet" ? Math.max(s.wet, s.drop) : s.foam) * s.slopeFade;
    const rx = s.radius * (kind === "wet" ? 1.45 : 1.10);
    const rz = s.radius * (kind === "wet" ? 0.82 : 0.48);
    const ca = Math.cos(s.angle);
    const sa = Math.sin(s.angle);
    const corners = [
      [-rx, -rz], [rx, -rz], [rx, rz],
      [-rx, -rz], [rx, rz], [-rx, rz],
    ];
    for (let c = 0; c < 6; c++) {
      const [lx, lz] = corners[c];
      const px = s.x + lx * ca - lz * sa;
      const pz = s.z + lx * sa + lz * ca;
      const vi = i * 18 + c * 3;
      positions[vi + 0] = px;
      positions[vi + 1] = field.sample(px, pz).terrainY + DECAL_SURFACE_OFFSET_M;
      positions[vi + 2] = pz;
      if (kind === "wet") {
        const dropTint = s.drop * 0.05;
        colors[vi + 0] = 0.030 + strength * 0.030 + dropTint;
        colors[vi + 1] = 0.040 + strength * 0.045 + dropTint;
        colors[vi + 2] = 0.034 + strength * 0.048 + dropTint;
      } else {
        colors[vi + 0] = 0.68 + strength * 0.22;
        colors[vi + 1] = 0.76 + strength * 0.18;
        colors[vi + 2] = 0.72 + strength * 0.18;
      }
    }
  }
  mesh.geometry.dispose();
  mesh.geometry = new THREE.BufferGeometry();
  mesh.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  mesh.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  mesh.geometry.setDrawRange(0, samples.length * 6);
}

export class RiverBankResidueOverlay {
  private readonly group = new THREE.Group();
  private readonly wetDecals = makeDecalMesh("river-bank-wetness-decals", 0.48);
  private readonly foamDecals = makeDecalMesh("river-bank-foam-residue", 0.58);
  private readonly settings = readRiverMaterialSettings();
  private elapsed = UPDATE_INTERVAL_S;
  private lastCenter = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, Number.POSITIVE_INFINITY);

  constructor(private readonly scene: THREE.Scene, private readonly field: WaterField) {
    this.group.name = "river-bank-residue-overlay";
    this.group.add(this.wetDecals, this.foamDecals);
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
    this.wetDecals.geometry.dispose();
    this.foamDecals.geometry.dispose();
    (this.wetDecals.material as THREE.Material).dispose();
    (this.foamDecals.material as THREE.Material).dispose();
  }

  private rebuild(centerX: number, centerZ: number): void {
    if (this.settings.wetBankStrength <= 0 && this.settings.foamResidueStrength <= 0) {
      replaceDecals(this.field, this.wetDecals, [], "wet");
      replaceDecals(this.field, this.foamDecals, [], "foam");
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
      [distM * 0.45, distM * 0.2], [-distM * 0.45, -distM * 0.2],
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
        const slopeFade = slopeFadeForGround(this.field, x, z);
        if (slopeFade <= 0.02) continue;

        let bestWet = 0;
        let bestFoam = 0;
        let bestDirX = 1;
        let bestDirZ = 0;
        for (const [ox, oz] of offsets) {
          const s = this.field.sample(x + ox, z + oz);
          if (s.depth <= 0 || s.bodyMask <= 0.05) continue;
          const distanceFade = 1 - Math.min(1, Math.hypot(ox, oz) / Math.max(0.01, distM * 1.2));
          const river = smooth01(s.flow.speed / 0.12);
          const wetSignal = distanceFade * Math.max(s.bodyMask, river * 0.8);
          const dropFoam = smooth01((s.flow.drop - this.settings.foamResidueDropStart) / Math.max(0.1, this.settings.foamResidueDropStart + 0.8));
          const speedFoam = smooth01(s.flow.speed / 0.85);
          if (wetSignal > bestWet) {
            bestWet = wetSignal;
            bestDirX = s.flow.x || ox;
            bestDirZ = s.flow.z || oz;
          }
          bestFoam = Math.max(bestFoam, wetSignal * Math.max(dropFoam, speedFoam * 0.42));
        }

        const patchNoise = hash2(cellX, cellZ, 37);
        const puddleNoise = hash2(Math.floor(cellX / 2), Math.floor(cellZ / 2), 53);
        const wetStrength = bestWet * this.settings.wetBankStrength * slopeFade;
        const foamStrength = bestFoam * this.settings.foamResidueStrength * slopeFade;
        const dropPatch = smooth01((patchNoise * 0.62 + puddleNoise * 0.38 - 0.48) / 0.46) * wetStrength;
        const angle = Math.atan2(bestDirZ, bestDirX) + (hash2(cellX, cellZ, 61) - 0.5) * 0.75;
        const radius = 0.55 + hash2(cellX, cellZ, 71) * 1.65;
        if (wet.length < MAX_WET_DECALS && wetStrength > 0.08 && patchNoise < Math.min(0.95, wetStrength + dropPatch * 0.35)) {
          wet.push({ x, y: here.terrainY + 0.045, z, wet: Math.min(1, wetStrength), foam: 0, drop: Math.min(1, dropPatch), radius, angle, slopeFade });
        }
        if (foam.length < MAX_FOAM_DECALS && foamStrength > 0.10 && hash2(cellX, cellZ, 41) < Math.min(0.82, foamStrength)) {
          foam.push({ x, y: here.terrainY + 0.065, z, wet: 0, foam: Math.min(1, foamStrength), drop: 0, radius: radius * 0.78, angle, slopeFade });
        }
      }
    }

    replaceDecals(this.field, this.wetDecals, wet, "wet");
    replaceDecals(this.field, this.foamDecals, foam, "foam");
  }
}
