import { PageMesh } from "../types.js";
import { ClodPagesConfig } from "../config.js";
import { surfaceHeight, type WorldBounds } from "./terrain_surface.js";
import { density } from "./terrain_density.js";
import { paintMaterialAt, terrainWeights } from "./terrain_paint.js";
import { editIndex, editIds, editHeight, editCellKey, DIG_INFLUENCE_MARGIN, CELL_SIZE } from "./terrain_edits.js";
import type { DigEdit } from "./terrain_edits.js";

const Y_CELLS = 128;

const QUAD_CELLS: Record<"x" | "y" | "z", [number, number, number][]> = {
  x: [[0, -1, -1], [0, 0, -1], [0, 0, 0], [0, -1, 0]],
  y: [[-1, 0, -1], [-1, 0, 0], [0, 0, 0], [0, 0, -1]],
  z: [[-1, -1, 0], [0, -1, 0], [0, 0, 0], [-1, 0, 0]],
};

interface VertBuf {
  pos: number[];
  nrm: number[];
  mat: number[];
  index: Map<string, number>;
  /** Quantized world position -> vertex index; merges SN cells that land on the same point. */
  posIndex: Map<string, number>;
  mergeCount: number[];
}

function cellKeySN(ci: number, cj: number, ck: number): string {
  return `${ci},${cj},${ck}`;
}

function finiteBounds(world: WorldBounds): boolean {
  return world.finite !== false;
}

function cellInsideWorld(ci: number, ck: number, world: WorldBounds): boolean {
  return !finiteBounds(world) || (ci >= 0 && ci < world.cellsX && ck >= 0 && ck < world.cellsZ);
}

function positionKey(px: number, py: number, pz: number, inv: number): string {
  return `${Math.round(px * inv)},${Math.round(py * inv)},${Math.round(pz * inv)}`;
}

function cellVertex(ci: number, cj: number, ck: number): [number, number, number] | null {
  const d: number[] = [];
  let neg = 0;
  for (let c = 0; c < 8; c++) {
    const x = ci + (c & 1);
    const y = cj + ((c >> 1) & 1);
    const z = ck + ((c >> 2) & 1);
    const v = density(x, y, z);
    d.push(v);
    if (v < 0) neg++;
  }
  if (neg === 0 || neg === 8) return null;

  const EDGES: [number, number][] = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (const [a, b] of EDGES) {
    const da = d[a], db = d[b];
    if (da < 0 === db < 0) continue;
    const t = da / (da - db);
    const ax = ci + (a & 1), ay = cj + ((a >> 1) & 1), az = ck + ((a >> 2) & 1);
    const bx = ci + (b & 1), by = cj + ((b >> 1) & 1), bz = ck + ((b >> 2) & 1);
    sx += ax + (bx - ax) * t;
    sy += ay + (by - ay) * t;
    sz += az + (bz - az) * t;
    n++;
  }
  return n > 0 ? [sx / n, sy / n, sz / n] : null;
}

function getOrAddVertex(buf: VertBuf, ci: number, cj: number, ck: number, posInv: number): number | null {
  const key = cellKeySN(ci, cj, ck);
  const existing = buf.index.get(key);
  if (existing !== undefined) return existing;
  const p = cellVertex(ci, cj, ck);
  if (p === null) return null;
  const [px, py, pz] = p;
  const [nx, ny, nz] = gradient(px, py, pz);
  const pk = positionKey(px, py, pz, posInv);
  const posExisting = buf.posIndex.get(pk);
  if (posExisting !== undefined) {
    const mc = buf.mergeCount[posExisting];
    const next = mc + 1;
    let ax = buf.nrm[posExisting * 3] * mc + nx;
    let ay = buf.nrm[posExisting * 3 + 1] * mc + ny;
    let az = buf.nrm[posExisting * 3 + 2] * mc + nz;
    const len = Math.hypot(ax, ay, az) || 1;
    buf.nrm[posExisting * 3] = ax / len;
    buf.nrm[posExisting * 3 + 1] = ay / len;
    buf.nrm[posExisting * 3 + 2] = az / len;
    buf.mergeCount[posExisting] = next;
    buf.index.set(key, posExisting);
    return posExisting;
  }
  const paint = paintMaterialAt(px, py, pz);
  const idx = buf.pos.length / 3;
  buf.pos.push(px, py, pz);
  buf.nrm.push(nx, ny, nz);
  buf.mat.push(paint);
  buf.index.set(key, idx);
  buf.posIndex.set(pk, idx);
  buf.mergeCount.push(1);
  return idx;
}

function gradient(x: number, y: number, z: number): [number, number, number] {
  const e = 0.5;
  const gx = density(x + e, y, z) - density(x - e, y, z);
  const gy = density(x, y + e, z) - density(x, y - e, z);
  const gz = density(x, y, z + e) - density(x, y, z - e);
  const nx = -gx, ny = -gy, nz = -gz;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function emitAxis(
  axis: "x" | "y" | "z", i: number, j: number, k: number,
  buf: VertBuf, indices: number[], world: WorldBounds, posInv: number,
): void {
  const dBase = density(i, j, k);
  const tx = axis === "x" ? i + 1 : i;
  const ty = axis === "y" ? j + 1 : j;
  const tz = axis === "z" ? k + 1 : k;
  const dTip = density(tx, ty, tz);
  if (dBase < 0 === dTip < 0) return;

  const loop = QUAD_CELLS[axis];
  for (const [oi, , ok] of loop) {
    const ci = i + oi, ck = k + ok;
    if (!cellInsideWorld(ci, ck, world)) return;
  }
  const v: number[] = [];
  for (const [oi, oj, ok] of loop) {
    const idx = getOrAddVertex(buf, i + oi, j + oj, k + ok, posInv);
    if (idx === null) return;
    v.push(idx);
  }
  const flip = dBase < dTip;
  if (!flip) {
    indices.push(v[0], v[1], v[2], v[0], v[2], v[3]);
  } else {
    indices.push(v[0], v[2], v[1], v[0], v[3], v[2]);
  }
}

export function meshChunk(cx: number, cz: number, cfg: ClodPagesConfig, world: WorldBounds): PageMesh {
  const S = cfg.page.chunk_size;
  const posInv = 1 / cfg.simplify.weld_epsilon_cells;
  const buf: VertBuf = { pos: [], nrm: [], mat: [], index: new Map(), posIndex: new Map(), mergeCount: [] };
  const indices: number[] = [];

  const x0 = cx * S, x1 = (cx + 1) * S;
  const z0 = cz * S, z1 = (cz + 1) * S;
  const isFiniteWorld = finiteBounds(world);

  const visited = new Set<number>();
  const chunkEdits: DigEdit[] = [];
  const minGX = isFiniteWorld ? Math.max(0, Math.floor(x0 / CELL_SIZE) - 1) : Math.floor(x0 / CELL_SIZE) - 1;
  const maxGX = Math.floor((x1 - 1) / CELL_SIZE) + 1;
  const minGZ = isFiniteWorld ? Math.max(0, Math.floor(z0 / CELL_SIZE) - 1) : Math.floor(z0 / CELL_SIZE) - 1;
  const maxGZ = Math.floor((z1 - 1) / CELL_SIZE) + 1;
  for (let gx = minGX; gx <= maxGX; gx++) {
    for (let gz = minGZ; gz <= maxGZ; gz++) {
      for (let gy = 0; gy < 32; gy++) {
        const bucket = editIndex.get(editCellKey(gx, gy, gz));
        if (!bucket) continue;
        for (const e of bucket) {
          const id = editIds.get(e) ?? 0;
          if (!visited.has(id)) {
            visited.add(id);
            chunkEdits.push(e);
          }
        }
      }
    }
  }

  for (let i = x0; i < x1; i++) {
    for (let k = z0; k < z1; k++) {
      const nearbyHeights = [
        surfaceHeight(i, k), surfaceHeight(i + 1, k), surfaceHeight(i - 1, k),
        surfaceHeight(i, k + 1), surfaceHeight(i, k - 1),
      ];
      let j0 = Math.max(0, Math.floor(Math.min(...nearbyHeights)) - 2);
      let j1 = Math.min(Y_CELLS - 1, Math.ceil(Math.max(...nearbyHeights)) + 2);
      for (const e of chunkEdits) {
        if (Math.abs(i - e.x) > e.r + DIG_INFLUENCE_MARGIN || Math.abs(k - e.z) > e.r + DIG_INFLUENCE_MARGIN) continue;
        const eh = editHeight(e);
        j0 = Math.max(0, Math.min(j0, Math.floor(e.y - eh - DIG_INFLUENCE_MARGIN)));
        j1 = Math.min(Y_CELLS - 1, Math.max(j1, Math.ceil(e.y + eh + DIG_INFLUENCE_MARGIN)));
      }
      for (let j = j0; j <= j1; j++) {
        emitAxis("x", i, j, k, buf, indices, world, posInv);
        emitAxis("y", i, j, k, buf, indices, world, posInv);
        emitAxis("z", i, j, k, buf, indices, world, posInv);
      }
    }
  }

  const nv = buf.mat.length;
  const vertWeights = new Float32Array(nv * 4);
  for (let i = 0; i < nv; i++) {
    const py = buf.pos[i * 3 + 1];
    const ny2 = buf.nrm[i * 3 + 1];
    const [g, r, s, sn] = terrainWeights(py, ny2);
    vertWeights[i * 4 + 0] = g;
    vertWeights[i * 4 + 1] = r;
    vertWeights[i * 4 + 2] = s;
    vertWeights[i * 4 + 3] = sn;
  }
  return {
    positions: new Float32Array(buf.pos),
    normals: new Float32Array(buf.nrm),
    paintSlots: new Float32Array(buf.mat),
    materialWeights: vertWeights,
    materialWeightStride: 4,
    indices: new Uint32Array(indices),
  };
}
