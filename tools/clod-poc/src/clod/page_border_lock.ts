import type { PageFootprint, PageMesh } from "../types.js";
import { borderChain, openBoundaryVertexFlags } from "../validate.js";

export function collectOuterBorderVertexKeys(mesh: PageMesh, footprint: PageFootprint, epsilon: number): Set<number> {
  const flags = openBoundaryVertexFlags(mesh);
  const keys = new Set<number>();
  for (let i = 0; i < flags.length; i++) {
    if (!flags[i]) continue;
    const x = mesh.positions[i * 3];
    const z = mesh.positions[i * 3 + 2];
    if (!onFootprintBorder(x, z, footprint, epsilon)) continue;
    keys.add(i);
  }
  return keys;
}

export function validatePageBorderChains(mesh: PageMesh, footprint: PageFootprint, epsilon: number): number {
  let checked = 0;
  for (const [axis, plane] of [
    ["x", footprint.minX],
    ["x", footprint.maxX],
    ["z", footprint.minZ],
    ["z", footprint.maxZ],
  ] as const) {
    const chain = borderChain(mesh, axis, plane, footprint);
    if (chain.positions.length === 0) throw new Error(`empty ${axis}=${plane} border chain`);
    for (const p of chain.positions) {
      if (!onFootprintBorder(p[0], p[2], footprint, Math.max(1, epsilon))) {
        throw new Error(`border vertex ${p[0]},${p[2]} is outside footprint edge tolerance`);
      }
    }
    checked++;
  }
  return checked;
}

function onFootprintBorder(x: number, z: number, footprint: PageFootprint, epsilon: number): boolean {
  return (
    Math.abs(x - footprint.minX) <= epsilon ||
    Math.abs(x - footprint.maxX) <= epsilon ||
    Math.abs(z - footprint.minZ) <= epsilon ||
    Math.abs(z - footprint.maxZ) <= epsilon
  );
}
