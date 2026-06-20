// GPU Surface Nets compute pass. Concatenated after terrain field bindings and common logic,
// which provide densityField / densityGradient and own group(0) bindings 0-1.
// Transliteration of src/gpu/surface_nets_core.ts, which is proven (surface_nets_core.test.ts)
// to emit the same surface as terrain.ts meshChunk. Two passes over the chunk cell grid:
//   vertexPass: one invocation per grid cell. If the cell has a sign change, atomically claim a
//               compact vertex index, write its position/normal/material, and record that index
//               in cellIndex[slot]; otherwise cellIndex[slot] = -1.
//   quadPass:   one invocation per (i,j,k,axis). On a sign-crossing edge, read the 4 dual cells'
//               compact indices from cellIndex and atomic-append the two triangles into indices.
// Compaction (atomic vertexCount) keeps readback to just the live verts + indices, and matches
// surface_nets_core (which assigns sequential indices; GPU order differs but the surface is equal).
// vertexPass must fully complete before quadPass (separate same-queue dispatches → ordered).
//
// (*) paintMaterialAt is ported inline below to keep this file self-contained for the paint slot.

struct MeshParams {
  x0 : i32, x1 : i32,
  z0 : i32, z1 : i32,
  yCells : i32,
  worldCellsX : i32,
  worldCellsZ : i32,
  vxBase : i32, vyBase : i32, vzBase : i32,
  vxCount : i32, vyCount : i32, vzCount : i32,
  maxIndices : u32,
  maxVertices : u32,
  _pad0 : u32,
};

@group(0) @binding(2) var<uniform> mesh : MeshParams;
@group(0) @binding(3) var<storage, read_write> outPositions : array<f32>;  // 3 per compact vertex
@group(0) @binding(4) var<storage, read_write> outNormals : array<f32>;    // 3 per compact vertex
@group(0) @binding(5) var<storage, read_write> outMaterials : array<f32>;  // 1 per compact vertex
@group(0) @binding(6) var<storage, read_write> cellIndex : array<i32>;     // compact vert index per slot, or -1
@group(0) @binding(7) var<storage, read_write> outIndices : array<u32>;
@group(0) @binding(8) var<storage, read_write> indexCount : atomic<u32>;
@group(0) @binding(9) var<storage, read_write> vertexCount : atomic<u32>;

const MATERIAL_PAINT_BAND : f32 = 0.75;

fn slotIndex(gx : i32, gy : i32, gz : i32) -> i32 {
  return (gx * mesh.vyCount + gy) * mesh.vzCount + gz;
}

// Inline paintMaterialAt (mirror of terrain_field_core.paintMaterialAtCore). digEdits/fieldParams
// come from the terrain field binding wrapper.
fn paintMaterialAt(x : f32, y : f32, z : f32) -> f32 {
  let count = i32(fieldParams.editCount);
  for (var i : i32 = count - 1; i >= 0; i = i - 1) {
    let e = digEdits[i];
    if (e.opAdd != 1) { continue; }
    let reachXZ = e.r + DIG_INFLUENCE_MARGIN;
    let reachY = e.h + DIG_INFLUENCE_MARGIN;
    let dx = x - e.x;
    let dy = y - e.y;
    let dz = z - e.z;
    if (abs(dx) > reachXZ || abs(dy) > reachY || abs(dz) > reachXZ) { continue; }
    if (brushSdf(e.shape, dx, dy, dz, e.r, e.h) <= MATERIAL_PAINT_BAND) {
      return f32(e.material + 1);
    }
  }
  return 0.0;
}

// Surface-nets vertex for a cell (mirror of cellVertexCore). Returns false if no sign change.
fn cellVertex(ci : i32, cj : i32, ck : i32, outPos : ptr<function, vec3<f32>>) -> bool {
  var d : array<f32, 8>;
  var neg : i32 = 0;
  for (var c : i32 = 0; c < 8; c = c + 1) {
    let x = f32(ci + (c & 1));
    let y = f32(cj + ((c >> 1u) & 1));
    let z = f32(ck + ((c >> 2u) & 1));
    let v = densityField(x, y, z);
    d[c] = v;
    if (v < 0.0) { neg = neg + 1; }
  }
  if (neg == 0 || neg == 8) { return false; }

  // 12 edges as (cornerA, cornerB): x(0-1,2-3,4-5,6-7) y(0-2,1-3,4-6,5-7) z(0-4,1-5,2-6,3-7)
  var ea = array<i32, 12>(0, 2, 4, 6, 0, 1, 4, 5, 0, 1, 2, 3);
  var eb = array<i32, 12>(1, 3, 5, 7, 2, 3, 6, 7, 4, 5, 6, 7);
  var sx : f32 = 0.0;
  var sy : f32 = 0.0;
  var sz : f32 = 0.0;
  var n : f32 = 0.0;
  for (var e : i32 = 0; e < 12; e = e + 1) {
    let a = ea[e];
    let b = eb[e];
    let da = d[a];
    let db = d[b];
    if ((da < 0.0) == (db < 0.0)) { continue; }
    let t = da / (da - db);
    let ax = f32(ci + (a & 1));
    let ay = f32(cj + ((a >> 1u) & 1));
    let az = f32(ck + ((a >> 2u) & 1));
    let bx = f32(ci + (b & 1));
    let by = f32(cj + ((b >> 1u) & 1));
    let bz = f32(ck + ((b >> 2u) & 1));
    sx = sx + ax + (bx - ax) * t;
    sy = sy + ay + (by - ay) * t;
    sz = sz + az + (bz - az) * t;
    n = n + 1.0;
  }
  *outPos = vec3<f32>(sx / n, sy / n, sz / n);
  return true;
}

@compute @workgroup_size(64)
fn vertexPass(@builtin(global_invocation_id) gid : vec3<u32>) {
  let total = u32(mesh.vxCount * mesh.vyCount * mesh.vzCount);
  let lin = gid.x;
  if (lin >= total) { return; }
  let gx = i32(lin) / (mesh.vyCount * mesh.vzCount);
  let rem = i32(lin) % (mesh.vyCount * mesh.vzCount);
  let gy = rem / mesh.vzCount;
  let gz = rem % mesh.vzCount;
  let ci = mesh.vxBase + gx;
  let cj = mesh.vyBase + gy;
  let ck = mesh.vzBase + gz;

  let slot = i32(lin);
  var p : vec3<f32>;
  if (!cellVertex(ci, cj, ck, &p)) {
    cellIndex[slot] = -1;
    return;
  }
  let vi = atomicAdd(&vertexCount, 1u);
  if (vi >= mesh.maxVertices) { cellIndex[slot] = -1; return; } // overflow guard; host sizes buffer
  let nrm = densityGradient(p.x, p.y, p.z);
  let paint = paintMaterialAt(p.x, p.y, p.z);
  let vo = i32(vi);
  outPositions[vo * 3 + 0] = p.x;
  outPositions[vo * 3 + 1] = p.y;
  outPositions[vo * 3 + 2] = p.z;
  outNormals[vo * 3 + 0] = nrm.x;
  outNormals[vo * 3 + 1] = nrm.y;
  outNormals[vo * 3 + 2] = nrm.z;
  outMaterials[vo] = paint;
  cellIndex[slot] = vo;
}

// QUAD_CELLS[axis] (offsets to the cell min-corner), flattened [axis][corner][oi,oj,ok].
fn quadCell(axis : i32, corner : i32) -> vec3<i32> {
  // x
  if (axis == 0) {
    if (corner == 0) { return vec3<i32>(0, -1, -1); }
    if (corner == 1) { return vec3<i32>(0, 0, -1); }
    if (corner == 2) { return vec3<i32>(0, 0, 0); }
    return vec3<i32>(0, -1, 0);
  }
  // y
  if (axis == 1) {
    if (corner == 0) { return vec3<i32>(-1, 0, -1); }
    if (corner == 1) { return vec3<i32>(-1, 0, 0); }
    if (corner == 2) { return vec3<i32>(0, 0, 0); }
    return vec3<i32>(0, 0, -1);
  }
  // z
  if (corner == 0) { return vec3<i32>(-1, -1, 0); }
  if (corner == 1) { return vec3<i32>(0, -1, 0); }
  if (corner == 2) { return vec3<i32>(0, 0, 0); }
  return vec3<i32>(-1, 0, 0);
}

@compute @workgroup_size(64)
fn quadPass(@builtin(global_invocation_id) gid : vec3<u32>) {
  let nx = mesh.x1 - mesh.x0;
  let nz = mesh.z1 - mesh.z0;
  let perAxis = nx * nz * mesh.yCells;
  let total = u32(perAxis * 3);
  let lin = i32(gid.x);
  if (gid.x >= total) { return; }

  let axis = lin / perAxis;
  let r0 = lin % perAxis;
  let i = mesh.x0 + (r0 / (nz * mesh.yCells));
  let r1 = r0 % (nz * mesh.yCells);
  let k = mesh.z0 + (r1 / mesh.yCells);
  let j = r1 % mesh.yCells;

  let dBase = densityField(f32(i), f32(j), f32(k));
  var step = vec3<i32>(0, 0, 0);
  if (axis == 0) { step = vec3<i32>(1, 0, 0); }
  else if (axis == 1) { step = vec3<i32>(0, 1, 0); }
  else { step = vec3<i32>(0, 0, 1); }
  let dTip = densityField(f32(i + step.x), f32(j + step.y), f32(k + step.z));
  if ((dBase < 0.0) == (dTip < 0.0)) { return; } // no crossing

  // Perimeter clip + gather the 4 dual-cell vertex slots.
  var slots : array<i32, 4>;
  for (var c : i32 = 0; c < 4; c = c + 1) {
    let o = quadCell(axis, c);
    let ci = i + o.x;
    let ck = k + o.z;
    if (ci < 0 || ci >= mesh.worldCellsX || ck < 0 || ck >= mesh.worldCellsZ) { return; } // clipped
    let gi = ci - mesh.vxBase;
    let gj = (j + o.y) - mesh.vyBase;
    let gk = ck - mesh.vzBase;
    let vi = cellIndex[slotIndex(gi, gj, gk)];
    if (vi < 0) { return; } // degenerate: a dual cell has no vertex
    slots[c] = vi;
  }

  let base = atomicAdd(&indexCount, 6u);
  if (base + 6u > mesh.maxIndices) { return; } // overflow guard; host sizes the buffer
  let flip = dBase < dTip;
  if (!flip) {
    outIndices[base + 0u] = u32(slots[0]);
    outIndices[base + 1u] = u32(slots[1]);
    outIndices[base + 2u] = u32(slots[2]);
    outIndices[base + 3u] = u32(slots[0]);
    outIndices[base + 4u] = u32(slots[2]);
    outIndices[base + 5u] = u32(slots[3]);
  } else {
    outIndices[base + 0u] = u32(slots[0]);
    outIndices[base + 1u] = u32(slots[2]);
    outIndices[base + 2u] = u32(slots[1]);
    outIndices[base + 3u] = u32(slots[0]);
    outIndices[base + 4u] = u32(slots[3]);
    outIndices[base + 5u] = u32(slots[2]);
  }
}
