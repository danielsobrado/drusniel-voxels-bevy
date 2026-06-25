import type { PageFootprint, PageMesh } from "../types.js";
import { borderChain, openBoundaryVertexFlags } from "./validate.js";

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

export function validatePageBorderChains(
  mesh: PageMesh,
  footprint: PageFootprint,
  lockEpsilonM: number,
  searchBandM: number,
): number {
  let checked = 0;
  assertOpenBoundaryWithinSearchBand(mesh, footprint, searchBandM);
  for (const [axis, plane] of [
    ["x", footprint.minX],
    ["x", footprint.maxX],
    ["z", footprint.minZ],
    ["z", footprint.maxZ],
  ] as const) {
    const chain = borderChain(mesh, axis, plane, footprint, searchBandM);
    if (chain.positions.length === 0) throw new Error(`empty ${axis}=${plane} border chain`);
    for (const p of chain.positions) {
      const planeDistance = Math.abs((axis === "x" ? p[0] : p[2]) - plane);
      if (planeDistance > searchBandM) {
        throw new Error(`border vertex ${p[0]},${p[2]} is outside ${axis}=${plane} search band`);
      }
      if (axis === "x" && (p[2] < footprint.minZ - lockEpsilonM || p[2] > footprint.maxZ + lockEpsilonM)) {
        throw new Error(`border vertex ${p[0]},${p[2]} drifted outside z footprint bounds`);
      }
      if (axis === "z" && (p[0] < footprint.minX - lockEpsilonM || p[0] > footprint.maxX + lockEpsilonM)) {
        throw new Error(`border vertex ${p[0]},${p[2]} drifted outside x footprint bounds`);
      }
    }
    checked++;
  }
  return checked;
}

function assertOpenBoundaryWithinSearchBand(mesh: PageMesh, footprint: PageFootprint, searchBandM: number): void {
  const flags = openBoundaryVertexFlags(mesh);
  for (let i = 0; i < flags.length; i++) {
    if (!flags[i]) continue;
    const x = mesh.positions[i * 3];
    const z = mesh.positions[i * 3 + 2];
    if (!onFootprintBorder(x, z, footprint, searchBandM)) {
      throw new Error(`open-boundary vertex ${x},${z} is outside footprint search band`);
    }
  }
}

function onFootprintBorder(x: number, z: number, footprint: PageFootprint, epsilon: number): boolean {
  return (
    Math.abs(x - footprint.minX) <= epsilon ||
    Math.abs(x - footprint.maxX) <= epsilon ||
    Math.abs(z - footprint.minZ) <= epsilon ||
    Math.abs(z - footprint.maxZ) <= epsilon
  );
}
