import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { positionGeometry } from "three/tsl";
import type { BorderCoastOceanConfig } from "../config/borderCoastOceanConfig.js";
import {
  createSurfMaskGpu,
  surfFoamColorNode,
  SURF_BAND_WGSL,
} from "./surfMask.js";

export { SURF_BAND_WGSL };

export interface SurfBandOptions {
  config: BorderCoastOceanConfig;
  seed: number;
  /** Static render-grid resolution; all surf evaluation remains on the GPU. */
  cellSizeM: number;
  /** Positive separation above the water plane to prevent coplanar z-fighting. */
  verticalOffsetM: number;
}

export interface SurfBandStats {
  vertices: number;
  triangles: number;
}

export class SurfBand {
  readonly object: THREE.Mesh<THREE.BufferGeometry, MeshBasicNodeMaterial>;
  readonly pageSourceKind = "surfFoam" as const;
  readonly collisionEnabled = false;
  readonly renderOnly = true;

  private readonly gpuMask: ReturnType<typeof createSurfMaskGpu>;
  private timeSeconds = 0;

  constructor(options: SurfBandOptions) {
    if (!Number.isFinite(options.cellSizeM) || options.cellSizeM <= 0) {
      throw new Error("Surf band: cellSizeM must be a positive finite number");
    }
    if (!Number.isFinite(options.verticalOffsetM) || options.verticalOffsetM <= 0) {
      throw new Error("Surf band: verticalOffsetM must be a positive finite number");
    }

    const geometry = buildStaticSurfGrid(options);
    this.gpuMask = createSurfMaskGpu(
      positionGeometry.xz,
      options.config,
      options.seed >>> 0,
    );
    const material = new MeshBasicNodeMaterial();
    material.name = "surf-band-gpu-render-only";
    material.colorNode = surfFoamColorNode(options.config).mul(this.gpuMask.tintNode);
    material.opacityNode = this.gpuMask.alphaNode;
    material.maskNode = this.gpuMask.alphaNode.greaterThan(0.001);
    material.transparent = true;
    material.depthTest = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -1;

    this.object = new THREE.Mesh(geometry, material);
    this.object.name = "surf-band-gpu-render-only";
    this.object.renderOrder = 11;
    this.object.frustumCulled = true;
    this.object.userData["pageSourceKind"] = this.pageSourceKind;
    this.object.userData["renderOnly"] = true;
    this.object.userData["collisionEnabled"] = false;
    this.object.userData["maskEvaluation"] = "gpu-wgsl";
    this.object.visible = options.config.surf.enabled;
  }

  update(deltaSeconds: number): void {
    if (!this.object.visible) return;
    this.timeSeconds += Math.max(0, deltaSeconds);
    this.gpuMask.setTime(this.timeSeconds);
  }

  setEnabled(enabled: boolean): void {
    this.object.visible = enabled;
  }

  stats(): SurfBandStats {
    return {
      vertices: this.object.geometry.getAttribute("position").count,
      triangles: (this.object.geometry.getIndex()?.count ?? 0) / 3,
    };
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.object.material.dispose();
  }
}

function appendGrid(
  positions: number[],
  indices: number[],
  xMin: number,
  xMax: number,
  zMin: number,
  zMax: number,
  cellSizeM: number,
  y: number,
  offset: { value: number },
): void {
  if (xMax <= xMin || zMax <= zMin) return;
  const cellsX = Math.max(1, Math.ceil((xMax - xMin) / cellSizeM));
  const cellsZ = Math.max(1, Math.ceil((zMax - zMin) / cellSizeM));
  const sideX = cellsX + 1;
  const base = offset.value;

  for (let z = 0; z <= cellsZ; z += 1) {
    const worldZ = zMin + (z / cellsZ) * (zMax - zMin);
    for (let x = 0; x <= cellsX; x += 1) {
      const worldX = xMin + (x / cellsX) * (xMax - xMin);
      positions.push(worldX, y, worldZ);
    }
  }

  for (let z = 0; z < cellsZ; z += 1) {
    for (let x = 0; x < cellsX; x += 1) {
      const a = base + z * sideX + x;
      const b = a + 1;
      const c = a + sideX;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  offset.value = base + (cellsZ + 1) * sideX;
}

function buildStaticSurfGrid(options: SurfBandOptions): THREE.BufferGeometry {
  const { bounds } = options.config.world;
  const maxWidth = Math.max(
    options.config.surf.beach_foam_width_m,
    options.config.surf.cliff_foam_width_m,
    options.config.surf.reef_foam_width_m,
  );
  const bandWidth = Math.max(maxWidth, options.cellSizeM);
  const minX = bounds.min_x;
  const maxX = bounds.max_x;
  const minZ = bounds.min_z;
  const maxZ = bounds.max_z;
  const y = options.config.world.water_level + options.verticalOffsetM;
  const positions: number[] = [];
  const indices: number[] = [];
  const offset = { value: 0 };

  appendGrid(positions, indices, minX - bandWidth, maxX + bandWidth, maxZ - bandWidth, maxZ + bandWidth, options.cellSizeM, y, offset);
  appendGrid(positions, indices, minX - bandWidth, maxX + bandWidth, minZ - bandWidth, minZ + bandWidth, options.cellSizeM, y, offset);
  appendGrid(positions, indices, minX - bandWidth, minX + bandWidth, minZ + bandWidth, maxZ - bandWidth, options.cellSizeM, y, offset);
  appendGrid(positions, indices, maxX - bandWidth, maxX + bandWidth, minZ + bandWidth, maxZ - bandWidth, options.cellSizeM, y, offset);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  geometry.computeBoundingSphere();
  return geometry;
}
