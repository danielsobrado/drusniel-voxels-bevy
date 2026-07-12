// WaterClipmap — camera-following clipmap ring of grid meshes.
//
// One reusable square grid geometry per level (cells_per_level+1 vertices per edge).
// Each level uses a different cell size from config; coarser levels always surround
// finer ones. Per frame, after camera movement, each level snaps its origin to
// `cell_size * snap_cells`. Vertex storage is TOROIDAL: world column c / row r lives at
// slot (c mod verts, r mod verts), so a snap only resamples the newly exposed columns
// and rows from the WaterField — the dominant cost is the per-vertex hydrology sample,
// and this bounds it by movement instead of ring area.
//
// Two per-level modes share that toroidal sampling:
// - STATIC topology (Phase 5b, materials that consume params.staticGrid — both TSL
//   WebGPU materials): samples land in two toroidal texel textures
//   (waterClipmapTexels.ts), the geometry (grid indices + full index buffer) never
//   changes, and a snap costs texel writes plus two origin uniforms. No index rebuild,
//   no attribute re-upload; dry areas resolve per fragment (depth<=0 discard plus the
//   shader-side wall guard in water_node_static_grid.ts).
// - LEGACY buffers (WebGL shader material): CPU vertex attributes; the index buffer is
//   rebuilt per snap (cheap, no field sampling) because slot connectivity crosses the
//   wrap seam, and conservative any-corner-wet quad emission happens at index time.
//
// The shader discards pixels inside the previous (finer) level's world rectangle so
// only the ring between levels is drawn, avoiding overdraw and seams.
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
import { WATER_SHORE_DISTANCE_UNKNOWN } from "./water_field_types.js";
import { createStaticWaterGridGeometry, WaterLevelTexelStore } from "./waterClipmapTexels.js";

export interface WaterRect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface WaterWorldBounds {
  cellsX: number;
  cellsZ: number;
}

export interface WaterClipmapOptions {
  scene: THREE.Scene;
  config: WaterConfig;
  field: WaterField;
  createMaterial: (params: WaterMaterialParams) => WaterMaterialHandle;
  sunDirection: THREE.Vector3;
  cameraPosition: THREE.Vector3;
  worldBounds: WaterWorldBounds;
  /** Offer static-topology resources to the material (config water.static_topology).
   *  Materials that ignore them (WebGL) keep the legacy per-snap index rebuild path. */
  staticTopology?: boolean;
}

const DEGENERATE_INNER: WaterRect = { minX: 1e30, minZ: 1e30, maxX: -1e30, maxZ: -1e30 };

/** Cumulative water-clipmap update-cost counters (shared across levels, reset never). */
export interface WaterClipmapUpdateStats {
  /** Origin snaps that triggered any refill work. */
  snaps: number;
  /** Refills that sampled every vertex (initialisation / teleports). */
  fullRefills: number;
  /** Refills that only sampled newly exposed rows/columns (normal movement). */
  partialRefills: number;
  columnsSampled: number;
  rowsSampled: number;
  /** Individual WaterField samples taken (the dominant CPU cost). */
  fieldSamples: number;
  /** Index-buffer rebuilds (legacy-mode levels only; static-topology levels never rebuild). */
  indexRebuilds: number;
  /** Snaps handled by static-topology levels (texel writes + origin uniforms only). */
  staticSnaps: number;
}

export function createWaterClipmapUpdateStats(): WaterClipmapUpdateStats {
  return {
    snaps: 0,
    fullRefills: 0,
    partialRefills: 0,
    columnsSampled: 0,
    rowsSampled: 0,
    fieldSamples: 0,
    indexRebuilds: 0,
    staticSnaps: 0,
  };
}

export function finiteWaterWorldBounds(worldBounds: WaterWorldBounds): boolean {
  return worldBounds.cellsX > 0 && worldBounds.cellsZ > 0;
}

function waterPointInBounds(x: number, z: number, worldBounds: WaterWorldBounds): boolean {
  if (!finiteWaterWorldBounds(worldBounds)) return true;
  return x >= 0 && x <= worldBounds.cellsX && z >= 0 && z <= worldBounds.cellsZ;
}

class WaterLevel {
  readonly index: number;
  readonly cellSize: number;
  private readonly snap: number;
  private readonly cellsPerLevel: number;
  private readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  private readonly handle: WaterMaterialHandle;
  private readonly field: WaterField;
  private readonly worldBounds: WaterWorldBounds;
  private readonly stats: WaterClipmapUpdateStats;
  /** Static-topology texel storage; null selects the legacy vertex-buffer path. */
  private readonly texels: WaterLevelTexelStore | null;
  private readonly positions: Float32Array | null;
  private readonly terrainY: Float32Array | null;
  private readonly bodyMask: Float32Array | null;
  private readonly bodyKind: Float32Array | null;
  private readonly flow: Float32Array | null;
  private readonly shoreDistance: Float32Array | null;
  private readonly indices: Uint32Array | null;
  // Toroidal slot mapping: world column c lives at slot (c mod vertsPerEdge); these
  // record which world column/row each slot currently holds so a snap can resample
  // only slots whose mapping changed.
  private readonly slotCol: Float64Array;
  private readonly slotRow: Float64Array;
  private readonly dirtyCol: Uint8Array;
  private readonly dirtyRow: Uint8Array;
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
    worldBounds: WaterWorldBounds,
    stats: WaterClipmapUpdateStats,
    texels: WaterLevelTexelStore | null,
  ) {
    this.index = index;
    this.cellSize = cellSize;
    this.snap = cellSize * snapCells;
    this.cellsPerLevel = cellsPerLevel;
    this.field = field;
    this.handle = handle;
    this.worldBounds = worldBounds;
    this.stats = stats;
    this.texels = handle.staticGrid ? texels : null;

    const vertsPerEdge = cellsPerLevel + 1;
    this.slotCol = new Float64Array(vertsPerEdge).fill(Number.NaN);
    this.slotRow = new Float64Array(vertsPerEdge).fill(Number.NaN);
    this.dirtyCol = new Uint8Array(vertsPerEdge);
    this.dirtyRow = new Uint8Array(vertsPerEdge);

    let geometry: THREE.BufferGeometry;
    if (this.texels) {
      this.positions = null;
      this.terrainY = null;
      this.bodyMask = null;
      this.bodyKind = null;
      this.flow = null;
      this.shoreDistance = null;
      this.indices = null;
      geometry = createStaticWaterGridGeometry(cellsPerLevel, index);
    } else {
      const vertexCount = vertsPerEdge * vertsPerEdge;
      this.positions = new Float32Array(vertexCount * 3);
      this.terrainY = new Float32Array(vertexCount);
      this.bodyMask = new Float32Array(vertexCount);
      this.bodyKind = new Float32Array(vertexCount);
      this.flow = new Float32Array(vertexCount * 4);
      this.shoreDistance = new Float32Array(vertexCount);
      const levelAttr = new Float32Array(vertexCount);
      levelAttr.fill(index);
      this.indices = new Uint32Array(cellsPerLevel * cellsPerLevel * 6);
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
      geometry.setAttribute("aTerrainY", new THREE.BufferAttribute(this.terrainY, 1));
      geometry.setAttribute("aBodyMask", new THREE.BufferAttribute(this.bodyMask, 1));
      geometry.setAttribute("aBodyKind", new THREE.BufferAttribute(this.bodyKind, 1));
      geometry.setAttribute("aFlow", new THREE.BufferAttribute(this.flow, 4));
      geometry.setAttribute("aShoreDistance", new THREE.BufferAttribute(this.shoreDistance, 1));
      geometry.setAttribute("aLevel", new THREE.BufferAttribute(levelAttr, 1));
      geometry.setIndex(new THREE.BufferAttribute(this.indices, 1));
      geometry.setDrawRange(0, 0);
      geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Number.MAX_VALUE);
    }

    this.mesh = new THREE.Mesh(geometry, handle.material);
    this.mesh.name = `water-clipmap-L${index}`;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
  }

  get object(): THREE.Object3D { return this.mesh; }
  get currentRect(): WaterRect { return this.rect; }
  get materialHandle(): WaterMaterialHandle { return this.handle; }
  get staticTopology(): boolean { return this.texels !== null; }

  disposeResources(): void {
    this.texels?.dispose();
    this.mesh.geometry.dispose();
  }

  updateOrigin(cameraX: number, cameraZ: number, finerRect: WaterRect): void {
    const originX = Math.floor(cameraX / this.snap) * this.snap;
    const originZ = Math.floor(cameraZ / this.snap) * this.snap;
    this.handle.setInnerRect(finerRect.minX, finerRect.minZ, finerRect.maxX, finerRect.maxZ);
    if (this.initialized && originX === this.originX && originZ === this.originZ) return;
    this.originX = originX;
    this.originZ = originZ;
    this.initialized = true;
    const half = this.cellsPerLevel * this.cellSize * 0.5;
    // World-integer column/row of the ring's min corner. half is an integer multiple of
    // cellSize (cellsPerLevel/2 cells) and origin snaps to whole cells, so this is exact.
    const baseCol = Math.round((originX - half) / this.cellSize);
    const baseRow = Math.round((originZ - half) / this.cellSize);
    this.refill(baseCol, baseRow);
    this.rect = {
      minX: originX - half,
      minZ: originZ - half,
      maxX: originX + half,
      maxZ: originZ + half,
    };
  }

  /** Resample only slots whose world column/row mapping changed. Static levels write
   *  texels + origin uniforms; legacy levels write vertex buffers + rebuild indices. */
  private refill(baseCol: number, baseRow: number): void {
    const { cellsPerLevel, stats } = this;
    const vertsPerEdge = cellsPerLevel + 1;
    this.dirtyCol.fill(0);
    this.dirtyRow.fill(0);
    let dirtyCols = 0;
    let dirtyRows = 0;
    for (let i = 0; i < vertsPerEdge; i++) {
      const c = baseCol + i;
      const sx = torusSlot(c, vertsPerEdge);
      if (this.slotCol[sx] !== c) {
        this.slotCol[sx] = c;
        this.dirtyCol[sx] = 1;
        dirtyCols++;
      }
      const r = baseRow + i;
      const sz = torusSlot(r, vertsPerEdge);
      if (this.slotRow[sz] !== r) {
        this.slotRow[sz] = r;
        this.dirtyRow[sz] = 1;
        dirtyRows++;
      }
    }
    stats.snaps++;
    if (dirtyCols > 0 || dirtyRows > 0) {
      if (dirtyCols === vertsPerEdge && dirtyRows === vertsPerEdge) stats.fullRefills++;
      else stats.partialRefills++;
      stats.columnsSampled += dirtyCols;
      stats.rowsSampled += dirtyRows;
    }
    if (this.texels) this.refillStatic(baseCol, baseRow, dirtyCols + dirtyRows > 0);
    else this.refillLegacy(baseCol, baseRow, dirtyCols + dirtyRows > 0);
  }

  private refillStatic(baseCol: number, baseRow: number, anyDirty: boolean): void {
    const { cellsPerLevel, field, cellSize, worldBounds, stats } = this;
    const texels = this.texels!;
    const vertsPerEdge = cellsPerLevel + 1;
    if (anyDirty) {
      for (let sz = 0; sz < vertsPerEdge; sz++) {
        const rowDirty = this.dirtyRow[sz] === 1;
        const worldZ = this.slotRow[sz] * cellSize;
        for (let sx = 0; sx < vertsPerEdge; sx++) {
          if (!rowDirty && this.dirtyCol[sx] === 0) continue;
          const worldX = this.slotCol[sx] * cellSize;
          const slot = sz * vertsPerEdge + sx;
          stats.fieldSamples++;
          if (waterPointInBounds(worldX, worldZ, worldBounds)) {
            texels.writeSample(slot, field.sampleForCellSize(worldX, worldZ, cellSize));
          } else {
            texels.writeDry(slot);
          }
        }
      }
      texels.commit();
    }
    stats.staticSnaps++;
    this.handle.staticGrid!.setOrigin(
      baseCol * cellSize,
      baseRow * cellSize,
      torusSlot(baseCol, vertsPerEdge),
      torusSlot(baseRow, vertsPerEdge),
    );
    this.mesh.visible = texels.wetVertexCount > 0;
  }

  private refillLegacy(baseCol: number, baseRow: number, anyDirty: boolean): void {
    const { cellsPerLevel, field, cellSize, worldBounds, stats } = this;
    const positions = this.positions!;
    const terrainY = this.terrainY!;
    const bodyMask = this.bodyMask!;
    const bodyKind = this.bodyKind!;
    const flow = this.flow!;
    const shoreDistance = this.shoreDistance!;
    const vertsPerEdge = cellsPerLevel + 1;
    if (anyDirty) {
      for (let sz = 0; sz < vertsPerEdge; sz++) {
        const rowDirty = this.dirtyRow[sz] === 1;
        const worldZ = this.slotRow[sz] * cellSize;
        for (let sx = 0; sx < vertsPerEdge; sx++) {
          if (!rowDirty && this.dirtyCol[sx] === 0) continue;
          const worldX = this.slotCol[sx] * cellSize;
          const slot = sz * vertsPerEdge + sx;
          const vi = slot * 3;
          const fi = slot * 4;
          stats.fieldSamples++;
          if (waterPointInBounds(worldX, worldZ, worldBounds)) {
            const sample = field.sampleForCellSize(worldX, worldZ, cellSize);
            positions[vi] = worldX;
            positions[vi + 1] = sample.waterY;
            positions[vi + 2] = worldZ;
            terrainY[slot] = sample.terrainY;
            bodyMask[slot] = sample.bodyMask;
            bodyKind[slot] = sample.bodyKind;
            flow[fi] = sample.flow.x;
            flow[fi + 1] = sample.flow.z;
            flow[fi + 2] = sample.flow.speed;
            flow[fi + 3] = sample.flow.drop;
            shoreDistance[slot] = sample.shoreDistance;
          } else {
            positions[vi] = worldX;
            positions[vi + 1] = 0;
            positions[vi + 2] = worldZ;
            terrainY[slot] = 0;
            bodyMask[slot] = 0;
            bodyKind[slot] = 0;
            flow[fi] = 0;
            flow[fi + 1] = 0;
            flow[fi + 2] = 0;
            flow[fi + 3] = 0;
            shoreDistance[slot] = WATER_SHORE_DISTANCE_UNKNOWN;
          }
        }
      }
      const geo = this.mesh.geometry;
      (geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      (geo.getAttribute("aTerrainY") as THREE.BufferAttribute).needsUpdate = true;
      (geo.getAttribute("aBodyMask") as THREE.BufferAttribute).needsUpdate = true;
      (geo.getAttribute("aBodyKind") as THREE.BufferAttribute).needsUpdate = true;
      (geo.getAttribute("aFlow") as THREE.BufferAttribute).needsUpdate = true;
      (geo.getAttribute("aShoreDistance") as THREE.BufferAttribute).needsUpdate = true;
    }
    const indexCount = this.refillIndices(baseCol, baseRow);
    const geo = this.mesh.geometry;
    (geo.getIndex() as THREE.BufferAttribute).needsUpdate = true;
    geo.setDrawRange(0, indexCount);
    this.mesh.visible = indexCount > 0;
  }

  /**
   * Rebuild the index buffer over world quads (legacy mode only). Slot connectivity
   * crosses the toroidal wrap seam, so indices cannot be static — but this pass takes
   * no field samples and is bounded CPU per snap.
   */
  private refillIndices(baseCol: number, baseRow: number): number {
    const { cellsPerLevel, worldBounds } = this;
    const positions = this.positions!;
    const terrainY = this.terrainY!;
    const bodyMask = this.bodyMask!;
    const flow = this.flow!;
    const indices = this.indices!;
    const vertsPerEdge = cellsPerLevel + 1;
    const maskEpsilon = 1e-4;
    let p = 0;
    for (let qj = 0; qj < cellsPerLevel; qj++) {
      const sza = torusSlot(baseRow + qj, vertsPerEdge);
      const szb = torusSlot(baseRow + qj + 1, vertsPerEdge);
      for (let qi = 0; qi < cellsPerLevel; qi++) {
        const sxa = torusSlot(baseCol + qi, vertsPerEdge);
        const sxb = torusSlot(baseCol + qi + 1, vertsPerEdge);
        const a = sza * vertsPerEdge + sxa;
        const b = sza * vertsPerEdge + sxb;
        const c = szb * vertsPerEdge + sxa;
        const d = szb * vertsPerEdge + sxb;
        if (!waterQuadRenderable([a, b, c, d], positions, terrainY, bodyMask, flow, worldBounds, maskEpsilon)) continue;
        indices[p++] = a; indices[p++] = c; indices[p++] = b;
        indices[p++] = b; indices[p++] = c; indices[p++] = d;
      }
    }
    this.stats.indexRebuilds++;
    return p;
  }
}

function torusSlot(worldIndex: number, vertsPerEdge: number): number {
  return ((worldIndex % vertsPerEdge) + vertsPerEdge) % vertsPerEdge;
}

/**
 * Conservative coverage: a quad renders when ANY corner is wet (mask above epsilon and
 * water above terrain). Requiring all four corners wet erodes thin rivers at coarse
 * rings. Dry corners carry a below-terrain sentinel waterY, so the interpolated surface
 * crosses the terrain near the true waterline and every water material discards
 * `depth <= 0` fragments — the shoreline stays correct without extra quad culling.
 * The height-discontinuity guard applies across wet corners only.
 */
export function waterQuadRenderable(
  corners: readonly [number, number, number, number],
  positions: Float32Array,
  terrainY: Float32Array,
  bodyMask: Float32Array,
  flow: Float32Array,
  worldBounds: WaterWorldBounds,
  maskEpsilon = 1e-4,
): boolean {
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxFlow = 0;
  let wetCorners = 0;
  for (const vi of corners) {
    const px = positions[vi * 3];
    const py = positions[vi * 3 + 1];
    const pz = positions[vi * 3 + 2];
    if (!waterPointInBounds(px, pz, worldBounds)) return false;
    if (bodyMask[vi] <= maskEpsilon || py - terrainY[vi] <= 0) continue;
    wetCorners++;
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
    maxFlow = Math.max(maxFlow, flow[vi * 4 + 2]);
  }
  if (wetCorners === 0) return false;
  const threshold = maxFlow > 0.02 ? 1.25 : 0.45;
  return maxY - minY <= threshold;
}

export class WaterClipmap {
  private readonly scene: THREE.Scene;
  private readonly root = new THREE.Group();
  private readonly levels: WaterLevel[];
  private readonly updateCost = createWaterClipmapUpdateStats();
  private readonly field: WaterField;
  private readonly sunDirection: THREE.Vector3;
  private readonly cameraPosition: THREE.Vector3;
  private time = 0;
  private debugMode: WaterDebugModeId;
  private visual: WaterVisualConfig;
  private visible: boolean;
  private clipmapTint: boolean;
  private wireframe: boolean;
  private warnedMissingCamera = false;

  constructor(opts: WaterClipmapOptions) {
    this.scene = opts.scene;
    this.field = opts.field;
    this.sunDirection = opts.sunDirection.clone().normalize();
    this.cameraPosition = opts.cameraPosition.clone();
    this.debugMode = opts.config.debug.mode;
    this.visual = opts.config.visual;
    this.visible = opts.config.enabled;
    this.clipmapTint = opts.config.debug.clipmapTint;
    this.wireframe = opts.config.debug.wireframe;
    this.root.name = "water-clipmap-root";
    this.scene.add(this.root);

    this.levels = opts.config.cellSizes.map((cellSize, index) => {
      const texels = opts.staticTopology !== false
        ? new WaterLevelTexelStore(opts.config.cellsPerLevel + 1, cellSize)
        : null;
      const handle = opts.createMaterial({
        visual: this.visual,
        debugMode: this.debugMode,
        sunDirection: this.sunDirection,
        cameraPosition: this.cameraPosition,
        worldBounds: opts.worldBounds,
        caustics: opts.config.caustics,
        ...(texels ? { staticGrid: texels.materialParams() } : {}),
      });
      if (texels && !handle.staticGrid) texels.dispose();
      const level = new WaterLevel(
        index,
        cellSize,
        opts.config.snapCells,
        opts.config.cellsPerLevel,
        this.field,
        handle,
        opts.worldBounds,
        this.updateCost,
        handle.staticGrid ? texels : null,
      );
      handle.setDebugMode(this.debugMode);
      handle.setClipmapTint(this.clipmapTint);
      handle.setWireframe(this.wireframe);
      handle.setInnerRect(DEGENERATE_INNER.minX, DEGENERATE_INNER.minZ, DEGENERATE_INNER.maxX, DEGENERATE_INNER.maxZ);
      this.root.add(level.object);
      return level;
    });

    this.root.visible = this.visible;
  }

  update(deltaSeconds: number, cameraPosition: THREE.Vector3): void {
    if (!this.visible) return;
    if (
      !cameraPosition ||
      !Number.isFinite(cameraPosition.x) ||
      !Number.isFinite(cameraPosition.y) ||
      !Number.isFinite(cameraPosition.z)
    ) {
      if (!this.warnedMissingCamera) {
        console.warn("[water] clipmap update skipped: camera position is missing or invalid");
        this.warnedMissingCamera = true;
      }
      return;
    }
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

  setClipmapTint(enabled: boolean): void {
    this.clipmapTint = enabled;
    for (const level of this.levels) level.materialHandle.setClipmapTint(enabled);
  }

  setWireframe(enabled: boolean): void {
    this.wireframe = enabled;
    for (const level of this.levels) level.materialHandle.setWireframe(enabled);
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
  get updateCostStats(): WaterClipmapUpdateStats { return { ...this.updateCost }; }
  getLevelRect(index: number): WaterRect | null {
    if (index >= 0 && index < this.levels.length) {
      return this.levels[index].currentRect;
    }
    return null;
  }
  get isEnabled(): boolean { return this.visible; }

  dispose(): void {
    for (const level of this.levels) {
      level.materialHandle.dispose();
      level.disposeResources();
    }
    this.root.clear();
    this.scene.remove(this.root);
  }
}

export { WATER_DEBUG_MODES as WATER_CLIPMAP_DEBUG_MODES };
