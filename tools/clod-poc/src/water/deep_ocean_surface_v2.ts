import * as THREE from "three";
import type { DeepOceanRenderConfig } from "../terrain/border_coast_config.js";
import { deepOceanGpuWaves, deepOceanWaveVerticalBounds } from "./deep_ocean_waves.js";

export interface DeepOceanSurface {
  mesh: THREE.Mesh;
  update(timeSeconds: number): void;
  dispose(): void;
}

export interface DeepOceanSurfaceOptions {
  mode?: "finite-border" | "camera-relative";
  getCenter?: () => THREE.Vector3;
  rebaseSnapM?: number;
  innerRadiusM?: number;
  outerRadiusM?: number;
}

interface BandSpec {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  sx: number;
  sz: number;
  radialAxis: "x" | "z";
  radialSign: -1 | 1;
  curve: boolean;
}

interface Layout {
  outerMin: number;
  outerMax: number;
  holeMin: number;
  holeMax: number;
}

const MIN_SEGMENTS = 1;
const DEFAULT_CAMERA_RELATIVE_SNAP_M = 128;

function clampSegments(value: number): number {
  return Math.max(MIN_SEGMENTS, Math.floor(value));
}

function layout(worldCells: number, config: DeepOceanRenderConfig): Layout {
  const extent = Math.max(1, config.extendCells);
  const start = Math.min(Math.max(0, config.startOutsideBorderM), extent - 1);
  return {
    outerMin: -extent,
    outerMax: worldCells + extent,
    holeMin: -start,
    holeMax: worldCells + start,
  };
}

function curved(t: number, sign: -1 | 1, enabled: boolean): number {
  if (!enabled) return t;
  return sign > 0 ? t * t : 1 - (1 - t) * (1 - t);
}

export function deepOceanBandSpecs(worldCells: number, config: DeepOceanRenderConfig): BandSpec[] {
  const l = layout(worldCells, config);
  const innerWidth = Math.max(1, Math.min(config.ringInnerBandM, Math.abs(l.outerMin - l.holeMin), Math.abs(l.outerMax - l.holeMax)));
  const inner = clampSegments(config.ringInnerRadialSegments);
  const outer = clampSegments(config.ringOuterRadialSegments);
  const tangent = clampSegments(config.ringTangentialSegments);
  const northMid = l.holeMax + innerWidth;
  const southMid = l.holeMin - innerWidth;
  const eastMid = l.holeMax + innerWidth;
  const westMid = l.holeMin - innerWidth;
  return [
    { x0: l.outerMin, x1: l.outerMax, z0: l.holeMax, z1: northMid, sx: tangent, sz: inner, radialAxis: "z", radialSign: 1, curve: false },
    { x0: l.outerMin, x1: l.outerMax, z0: northMid, z1: l.outerMax, sx: tangent, sz: outer, radialAxis: "z", radialSign: 1, curve: true },
    { x0: l.outerMin, x1: l.outerMax, z0: southMid, z1: l.holeMin, sx: tangent, sz: inner, radialAxis: "z", radialSign: -1, curve: false },
    { x0: l.outerMin, x1: l.outerMax, z0: l.outerMin, z1: southMid, sx: tangent, sz: outer, radialAxis: "z", radialSign: -1, curve: true },
    { x0: l.holeMax, x1: eastMid, z0: l.holeMin, z1: l.holeMax, sx: inner, sz: tangent, radialAxis: "x", radialSign: 1, curve: false },
    { x0: eastMid, x1: l.outerMax, z0: l.holeMin, z1: l.holeMax, sx: outer, sz: tangent, radialAxis: "x", radialSign: 1, curve: true },
    { x0: westMid, x1: l.holeMin, z0: l.holeMin, z1: l.holeMax, sx: inner, sz: tangent, radialAxis: "x", radialSign: -1, curve: false },
    { x0: l.outerMin, x1: westMid, z0: l.holeMin, z1: l.holeMax, sx: outer, sz: tangent, radialAxis: "x", radialSign: -1, curve: true },
  ];
}

function pushBand(positions: number[], indices: number[], spec: BandSpec, y: number, offset: { value: number }): void {
  if (spec.x1 <= spec.x0 || spec.z1 <= spec.z0) return;
  const cols = clampSegments(spec.sx);
  const rows = clampSegments(spec.sz);
  const base = offset.value;
  for (let row = 0; row <= rows; row++) {
    const rowT = row / rows;
    for (let col = 0; col <= cols; col++) {
      const colT = col / cols;
      const radialT = spec.radialAxis === "x" ? colT : rowT;
      const tangentT = spec.radialAxis === "x" ? rowT : colT;
      const rt = curved(radialT, spec.radialSign, spec.curve);
      const tx = spec.radialAxis === "x" ? rt : tangentT;
      const tz = spec.radialAxis === "z" ? rt : tangentT;
      positions.push(spec.x0 + (spec.x1 - spec.x0) * tx, y, spec.z0 + (spec.z1 - spec.z0) * tz);
    }
  }
  const stride = cols + 1;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const a = base + row * stride + col;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  offset.value = base + (rows + 1) * (cols + 1);
}

function visitBand(spec: BandSpec, visit: (x: number, z: number) => void): void {
  const cols = clampSegments(spec.sx);
  const rows = clampSegments(spec.sz);
  for (let row = 0; row <= rows; row++) {
    const z = spec.z0 + (spec.z1 - spec.z0) * (row / rows);
    for (let col = 0; col <= cols; col++) {
      const x = spec.x0 + (spec.x1 - spec.x0) * (col / cols);
      visit(x, z);
    }
  }
}

function vertexCount(spec: BandSpec): number {
  return spec.x1 <= spec.x0 || spec.z1 <= spec.z0 ? 0 : (clampSegments(spec.sx) + 1) * (clampSegments(spec.sz) + 1);
}

function triangleCount(spec: BandSpec): number {
  return spec.x1 <= spec.x0 || spec.z1 <= spec.z0 ? 0 : clampSegments(spec.sx) * clampSegments(spec.sz) * 2;
}

function inClosedRect(x: number, z: number, min: number, max: number): boolean {
  return x >= min && x <= max && z >= min && z <= max;
}

function inOpenRect(x: number, z: number, min: number, max: number): boolean {
  return x > min && x < max && z > min && z < max;
}

export function isInDeepOceanTransitionGap(x: number, z: number, worldCells: number, startOutsideBorderM: number): boolean {
  const start = Math.max(0, startOutsideBorderM);
  if (inClosedRect(x, z, 0, worldCells)) return false;
  return inOpenRect(x, z, -start, worldCells + start);
}

export function countDeepOceanTransitionGapVertices(worldCells: number, config: DeepOceanRenderConfig): number {
  if (!config.enabled || worldCells <= 0) return 0;
  let count = 0;
  for (const spec of deepOceanBandSpecs(worldCells, config)) {
    visitBand(spec, (x, z) => {
      if (isInDeepOceanTransitionGap(x, z, worldCells, config.startOutsideBorderM)) count += 1;
    });
  }
  return count;
}

function snap(value: number, snapM: number): number {
  return Math.round(value / snapM) * snapM;
}

function buildCameraRelativeGeometry(config: DeepOceanRenderConfig, options: DeepOceanSurfaceOptions): THREE.BufferGeometry {
  const innerRadius = Math.max(0, options.innerRadiusM ?? config.ringInnerBandM);
  const outerRadius = Math.max(innerRadius + 1, options.outerRadiusM ?? config.extendCells);
  const radialSegments = clampSegments(config.ringInnerRadialSegments + config.ringOuterRadialSegments);
  const angularSegments = clampSegments(config.ringTangentialSegments);
  const positions: number[] = [];
  const indices: number[] = [];

  for (let ri = 0; ri <= radialSegments; ri++) {
    const r = innerRadius + (outerRadius - innerRadius) * (ri / radialSegments);
    for (let ai = 0; ai <= angularSegments; ai++) {
      const theta = (ai / angularSegments) * Math.PI * 2;
      positions.push(r * Math.cos(theta), config.surfaceY, r * Math.sin(theta));
    }
  }

  const stride = angularSegments + 1;
  for (let ri = 0; ri < radialSegments; ri++) {
    for (let ai = 0; ai < angularSegments; ai++) {
      const a = ri * stride + ai;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const bounds = deepOceanWaveVerticalBounds(deepOceanGpuWaves(config.wave));
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(-outerRadius - bounds, config.surfaceY - bounds, -outerRadius - bounds),
    new THREE.Vector3(outerRadius + bounds, config.surfaceY + bounds, outerRadius + bounds),
  );
  return geometry;
}

function createCameraRelativeDeepOceanSurface(config: DeepOceanRenderConfig, material: THREE.Material, options: DeepOceanSurfaceOptions): DeepOceanSurface | null {
  if (!config.enabled) return null;
  const geometry = buildCameraRelativeGeometry(config, options);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "deep-ocean-surface-camera-relative";
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;
  const snapM = Math.max(1, options.rebaseSnapM ?? DEFAULT_CAMERA_RELATIVE_SNAP_M);

  const syncToCenter = () => {
    const center = options.getCenter?.();
    if (!center) return;
    mesh.position.set(snap(center.x, snapM), 0, snap(center.z, snapM));
  };
  syncToCenter();

  return {
    mesh,
    update(_timeSeconds: number) { syncToCenter(); },
    dispose() {
      geometry.dispose();
      mesh.removeFromParent();
    },
  };
}

function createFiniteBorderDeepOceanSurface(worldCells: number, config: DeepOceanRenderConfig, material: THREE.Material): DeepOceanSurface | null {
  if (!config.enabled || worldCells <= 0) return null;
  const positions: number[] = [];
  const indices: number[] = [];
  const offset = { value: 0 };
  for (const spec of deepOceanBandSpecs(worldCells, config)) pushBand(positions, indices, spec, config.surfaceY, offset);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const bounds = deepOceanWaveVerticalBounds(deepOceanGpuWaves(config.wave));
  const l = layout(worldCells, config);
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(l.outerMin - bounds, config.surfaceY - bounds, l.outerMin - bounds),
    new THREE.Vector3(l.outerMax + bounds, config.surfaceY + bounds, l.outerMax + bounds),
  );
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "deep-ocean-surface";
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;
  return {
    mesh,
    update(_timeSeconds: number) {},
    dispose() {
      geometry.dispose();
      mesh.removeFromParent();
    },
  };
}

export function createDeepOceanSurface(
  worldCells: number,
  config: DeepOceanRenderConfig,
  material: THREE.Material,
  options: DeepOceanSurfaceOptions = {},
): DeepOceanSurface | null {
  if (options.mode === "camera-relative") return createCameraRelativeDeepOceanSurface(config, material, options);
  return createFiniteBorderDeepOceanSurface(worldCells, config, material);
}

export function deepOceanSurfaceVertexCount(worldCells: number, config: DeepOceanRenderConfig): number {
  if (!config.enabled || worldCells <= 0) return 0;
  return deepOceanBandSpecs(worldCells, config).reduce((total, spec) => total + vertexCount(spec), 0);
}

export function deepOceanSurfaceTriangleCount(worldCells: number, config: DeepOceanRenderConfig): number {
  if (!config.enabled || worldCells <= 0) return 0;
  return deepOceanBandSpecs(worldCells, config).reduce((total, spec) => total + triangleCount(spec), 0);
}
