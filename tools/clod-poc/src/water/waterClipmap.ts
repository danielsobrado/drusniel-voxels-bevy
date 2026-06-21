// WaterClipmap — Fable5-style clipmap ring of grid meshes that follow the camera.
//
// One reusable square grid geometry per level (cells_per_level+1 vertices per edge).
// Each level uses a different cell size from config; coarser levels always surround
// finer ones. Per frame, after camera movement, each level snaps its origin to
// `cell_size * snap_cells` and refills vertex positions/attributes from the
// WaterField. The shader discards pixels inside the previous (finer) level's world
// rectangle so only the ring between levels is drawn, avoiding overdraw and seams.
//
// Water meshes are a separate render layer: frustumCulled is disabled (the grid
// follows the camera; a conservative bound would need updating each origin change),
// renderOrder is high so transparent water blends over terrain and submerged props,
// and the geometry/material never touch the CLOD page source path.
import * as THREE from "three";
import type { WaterConfig } from "./waterConfig.js";
import { WATER_DEBUG_MODES, type WaterDebugModeId, type WaterVisualConfig } from "./waterConfig.js";
import type { WaterField } from "./waterField.js";
import type { WaterMaterialHandle, WaterMaterialParams } from "./waterMaterial.js";

export interface WaterRect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface WaterClipmapOptions {
  scene: THREE.Scene;
  config: WaterConfig;
  field: WaterField;
  createMaterial: (params: WaterMaterialParams) => WaterMaterialHandle;
  sunDirection: THREE.Vector3;
  cameraPosition: THREE.Vector3;
}

const DEGENERATE_INNER: WaterRect = { minX: 1e30, minZ: 1e30, maxX: -1e30, maxZ: -1e30 };

class WaterLevel {
  readonly index: number;
  readonly cellSize: number;
  private readonly snap: number;
  private readonly cellsPerLevel: number;
  private readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  private readonly handle: WaterMaterialHandle;
  private readonly field: WaterField;
  private readonly positions: Float32Array;
  private readonly terrainY: Float32Array;
  private readonly bodyMask: Float32Array;
  private readonly flow: Float32Array;
  private readonly levelAttr: Float32Array;
  private originX = Number.NaN;
  private originZ = Number.NaN;
  private rect: WaterRect = { ...DEGENERATE_INNER };
  private initialized = false;

  constructor(
    index: number,
    cellSize: number,
    snapCells: number,
    cellsPerLevel: number,
    field: WaterField,
    handle: WaterMaterialHandle,
  ) {
    this.index = index;
    this.cellSize = cellSize;
    this.snap = cellSize * snapCells;
    this.cellsPerLevel = cellsPerLevel;
    this.field = field;
    this.handle = handle;

    const vertsPerEdge = cellsPerLevel + 1;
    const vertexCount = vertsPerEdge * vertsPerEdge;
    this.positions = new Float32Array(vertexCount * 3);
    this.terrainY = new Float32Array(vertexCount);
    this.bodyMask = new Float32Array(vertexCount);
    this.flow = new Float32Array(vertexCount * 3);
    this.levelAttr = new Float32Array(vertexCount);
    this.levelAttr.fill(index);

    const indices = buildGridIndices(cellsPerLevel);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute("aTerrainY", new THREE.BufferAttribute(this.terrainY, 1));
    geometry.setAttribute("aBodyMask", new THREE.BufferAttribute(this.bodyMask, 1));
    geometry.setAttribute("aFlow", new THREE.BufferAttribute(this.flow, 3));
    geometry.setAttribute("aLevel", new THREE.BufferAttribute(this.levelAttr, 1));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Number.MAX_VALUE);

    this.mesh = new THREE.Mesh(geometry, handle.material);
    this.mesh.name = `water-clipmap-L${index}`;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  get object(): THREE.Object3D { return this.mesh; }
  get currentRect(): WaterRect { return this.rect; }
  get materialHandle(): WaterMaterialHandle { return this.handle; }

  updateOrigin(cameraX: number, cameraZ: number, finerRect: WaterRect): void {
    const originX = Math.floor(cameraX / this.snap) * this.snap;
    const originZ = Math.floor(cameraZ / this.snap) * this.snap;
    this.handle.setInnerRect(finerRect.minX, finerRect.minZ, finerRect.maxX, finerRect.maxZ);
    if (this.initialized && originX === this.originX && originZ === this.originZ) return;
    this.originX = originX;
    this.originZ = originZ;
    this.initialized = true;
    this.refillVertices(originX, originZ);
    this.rect = {
      minX: originX,
      minZ: originZ,
      maxX: originX + this.cellsPerLevel * this.cellSize,
      maxZ: originZ + this.cellsPerLevel * this.cellSize,
    };
  }

  private refillVertices(originX: number, originZ: number): void {
    const { cellsPerLevel, cellSize, field, positions, terrainY, bodyMask, flow } = this;
    const vertsPerEdge = cellsPerLevel + 1;
    let vi = 0;
    let fi = 0;
    for (let iz = 0; iz < vertsPerEdge; iz++) {
      const worldZ = originZ + iz * cellSize;
      for (let ix = 0; ix < vertsPerEdge; ix++) {
        const worldX = originX + ix * cellSize;
        const sample = field.sample(worldX, worldZ);
        positions[vi] = worldX;
        positions[vi + 1] = sample.waterY;
        positions[vi + 2] = worldZ;
        terrainY[vi / 3] = sample.terrainY;
        bodyMask[vi / 3] = sample.bodyMask;
        flow[fi] = sample.flow.x;
        flow[fi + 1] = sample.flow.z;
        flow[fi + 2] = sample.flow.speed;
        vi += 3;
        fi += 3;
      }
    }
    const geo = this.mesh.geometry;
    (geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute("aTerrainY") as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute("aBodyMask") as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute("aFlow") as THREE.BufferAttribute).needsUpdate = true;
  }
}

function buildGridIndices(cellsPerLevel: number): Uint32Array {
  const vertsPerEdge = cellsPerLevel + 1;
  const quadCount = cellsPerLevel * cellsPerLevel;
  const indices = new Uint32Array(quadCount * 6);
  let p = 0;
  for (let iz = 0; iz < cellsPerLevel; iz++) {
    for (let ix = 0; ix < cellsPerLevel; ix++) {
      const a = iz * vertsPerEdge + ix;
      const b = a + 1;
      const c = a + vertsPerEdge;
      const d = c + 1;
      indices[p++] = a; indices[p++] = c; indices[p++] = b;
      indices[p++] = b; indices[p++] = c; indices[p++] = d;
    }
  }
  return indices;
}

export class WaterClipmap {
  private readonly scene: THREE.Scene;
  private readonly root = new THREE.Group();
  private readonly levels: WaterLevel[];
  private readonly field: WaterField;
  private readonly sunDirection: THREE.Vector3;
  private readonly cameraPosition: THREE.Vector3;
  private time = 0;
  private debugMode: WaterDebugModeId;
  private visual: WaterVisualConfig;
  private visible: boolean;

  constructor(opts: WaterClipmapOptions) {
    this.scene = opts.scene;
    this.field = opts.field;
    this.sunDirection = opts.sunDirection.clone().normalize();
    this.cameraPosition = opts.cameraPosition.clone();
    this.debugMode = opts.config.debug.mode;
    this.visual = opts.config.visual;
    this.visible = opts.config.enabled;
    this.root.name = "water-clipmap-root";
    this.scene.add(this.root);

    this.levels = opts.config.cellSizes.map((cellSize, index) => {
      const handle = opts.createMaterial({
        visual: this.visual,
        debugMode: this.debugMode,
        sunDirection: this.sunDirection,
        cameraPosition: this.cameraPosition,
      });
      const level = new WaterLevel(
        index,
        cellSize,
        opts.config.snapCells,
        opts.config.cellsPerLevel,
        this.field,
        handle,
      );
      handle.setDebugMode(this.debugMode);
      handle.setInnerRect(DEGENERATE_INNER.minX, DEGENERATE_INNER.minZ, DEGENERATE_INNER.maxX, DEGENERATE_INNER.maxZ);
      this.root.add(level.object);
      return level;
    });

    this.root.visible = this.visible;
  }

  /** Advance animation and snap every level to the camera. Call after camera move. */
  update(deltaSeconds: number, cameraPosition: THREE.Vector3): void {
    if (!this.visible) return;
    this.time += deltaSeconds;
    this.cameraPosition.copy(cameraPosition);
    const cx = cameraPosition.x;
    const cz = cameraPosition.z;
    for (let i = 0; i < this.levels.length; i++) {
      const finer = i > 0 ? this.levels[i - 1].currentRect : DEGENERATE_INNER;
      this.levels[i].updateOrigin(cx, cz, finer);
      const handle = this.levels[i].materialHandle;
      handle.setTime(this.time);
      handle.updateCamera(this.cameraPosition);
    }
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.root.visible = visible;
  }

  setDebugMode(mode: WaterDebugModeId): void {
    this.debugMode = mode;
    for (const level of this.levels) level.materialHandle.setDebugMode(mode);
  }

  updateVisual(visual: WaterVisualConfig): void {
    this.visual = visual;
    for (const level of this.levels) level.materialHandle.updateVisual(visual);
  }

  updateSunDirection(dir: THREE.Vector3): void {
    this.sunDirection.copy(dir).normalize();
    for (const level of this.levels) level.materialHandle.updateSunDirection(this.sunDirection);
  }

  get debugModeId(): WaterDebugModeId { return this.debugMode; }
  get levelCount(): number { return this.levels.length; }
  get isEnabled(): boolean { return this.visible; }

  dispose(): void {
    for (const level of this.levels) {
      level.materialHandle.dispose();
      (level.object as THREE.Mesh).geometry.dispose();
    }
    this.root.clear();
    this.scene.remove(this.root);
  }
}

export { WATER_DEBUG_MODES as WATER_CLIPMAP_DEBUG_MODES };
