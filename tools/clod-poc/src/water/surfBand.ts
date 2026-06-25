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

function buildStaticSurfGrid(options: SurfBandOptions): THREE.BufferGeometry {
  const { bounds } = options.config.world;
  const maxWidth = Math.max(
    options.config.surf.beach_foam_width_m,
    options.config.surf.cliff_foam_width_m,
    options.config.surf.reef_foam_width_m,
  );
  const minX = bounds.min_x - maxWidth;
  const maxX = bounds.max_x + maxWidth;
  const minZ = bounds.min_z - maxWidth;
  const maxZ = bounds.max_z + maxWidth;
  const cellsX = Math.max(1, Math.ceil((maxX - minX) / options.cellSizeM));
  const cellsZ = Math.max(1, Math.ceil((maxZ - minZ) / options.cellSizeM));
  const sideX = cellsX + 1;
  const sideZ = cellsZ + 1;
  const positions = new Float32Array(sideX * sideZ * 3);
  const indices = new Uint32Array(cellsX * cellsZ * 6);

  for (let z = 0; z < sideZ; z += 1) {
    const worldZ = minZ + (z / cellsZ) * (maxZ - minZ);
    for (let x = 0; x < sideX; x += 1) {
      const worldX = minX + (x / cellsX) * (maxX - minX);
      const vertex = z * sideX + x;
      positions[vertex * 3] = worldX;
      positions[vertex * 3 + 1] = options.config.world.water_level + options.verticalOffsetM;
      positions[vertex * 3 + 2] = worldZ;
    }
  }

  let index = 0;
  for (let z = 0; z < cellsZ; z += 1) {
    for (let x = 0; x < cellsX; x += 1) {
      const a = z * sideX + x;
      const b = a + 1;
      const c = a + sideX;
      const d = c + 1;
      indices[index++] = a;
      indices[index++] = c;
      indices[index++] = b;
      indices[index++] = b;
      indices[index++] = c;
      indices[index++] = d;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}
