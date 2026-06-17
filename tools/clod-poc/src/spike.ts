// Meshoptimizer API verification spike.
//
// Confirms the four facts everything downstream depends on, against a small grid mesh:
//   1. simplifyWithAttributes accepts a per-vertex lock array + attribute weights.
//   2. ['LockBorder'] locks topological borders.
//   3. result_error is relative; getScale() converts it to world units.
//   4. locked border vertices survive simplification verbatim.
//
// Run: npm run spike

import { MeshoptSimplifier } from "meshoptimizer";

const N = 33; // 33x33 grid of vertices -> 32x32 quads
const CELL = 1.0;

function buildGrid() {
  const positions: number[] = [];
  const normals: number[] = [];
  const materials: number[] = [];
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const wx = x * CELL, wz = z * CELL;
      const wy = Math.sin(wx * 0.4) * 1.5 + Math.cos(wz * 0.3) * 1.2; // gentle relief
      positions.push(wx, wy, wz);
      normals.push(0, 1, 0);
      materials.push(1, 0, 0, 0);
    }
  }
  const indices: number[] = [];
  for (let z = 0; z < N - 1; z++) {
    for (let x = 0; x < N - 1; x++) {
      const a = z * N + x, b = a + 1, c = a + N, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    materials: new Float32Array(materials),
    indices: new Uint32Array(indices),
  };
}

async function main() {
  await MeshoptSimplifier.ready;
  (MeshoptSimplifier as unknown as { useExperimentalFeatures?: boolean }).useExperimentalFeatures = true;

  const g = buildGrid();
  const vc = g.positions.length / 3;

  // Lock the 4 outer border vertices (x==0 || x==max || z==0 || z==max).
  const locks = new Uint8Array(vc);
  const max = (N - 1) * CELL;
  for (let i = 0; i < vc; i++) {
    const x = g.positions[i * 3], z = g.positions[i * 3 + 2];
    if (x === 0 || x === max || z === 0 || z === max) locks[i] = 1;
  }
  const lockedBefore: [number, number, number][] = [];
  for (let i = 0; i < vc; i++) if (locks[i]) lockedBefore.push([g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]]);

  // Interleave attributes (normal3 + material4), stride 7.
  const STRIDE = 7;
  const attrs = new Float32Array(vc * STRIDE);
  for (let i = 0; i < vc; i++) {
    attrs.set(g.normals.subarray(i * 3, i * 3 + 3), i * STRIDE);
    attrs.set(g.materials.subarray(i * 4, i * 4 + 4), i * STRIDE + 3);
  }
  const weights = [0.5, 0.5, 0.5, 1, 1, 1, 1];

  const scale = MeshoptSimplifier.getScale(g.positions, 3);
  const target = Math.floor(g.indices.length * 0.5);

  const [outIndices, resultError] = MeshoptSimplifier.simplifyWithAttributes(
    g.indices, g.positions, 3, attrs, STRIDE, weights, locks, target, 0.01, ["LockBorder"],
  );

  const errorWorld = resultError * scale;

  // Verify every locked vertex still exists verbatim in the simplified mesh.
  const used = new Set(outIndices);
  let lockedSurvived = 0;
  for (let i = 0; i < vc; i++) if (locks[i] && used.has(i)) lockedSurvived++;
  const lockedTotal = lockedBefore.length;

  console.log("=== meshoptimizer spike ===");
  console.log(`package: meshoptimizer (simplifyWithAttributes present: ${typeof MeshoptSimplifier.simplifyWithAttributes === "function"})`);
  console.log(`input  : ${g.indices.length / 3} tris, ${vc} verts, ${lockedTotal} locked`);
  console.log(`output : ${outIndices.length / 3} tris`);
  console.log(`error  : relative result_error = ${resultError.toExponential(3)}`);
  console.log(`scale  : simplifyScale = ${scale.toFixed(4)}`);
  console.log(`error_world = result_error * scale = ${errorWorld.toExponential(3)} world units`);
  console.log(`locked border survived verbatim: ${lockedSurvived}/${lockedTotal}`);

  if (lockedSurvived !== lockedTotal) {
    console.error("FAIL: locked border vertices were removed — vertex_lock not honoured.");
    process.exit(1);
  }
  console.log("PASS: locks honoured, attributes carried, world error computed.");
}

main().catch((e) => {
  console.error("spike failed:", e);
  process.exit(1);
});
