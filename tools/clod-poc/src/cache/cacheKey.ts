import type { ClodCacheKeyParts } from "./cacheTypes.js";

function field(value: number | string | undefined): string {
  if (value === undefined) return "_";
  return String(value);
}

export function buildClodCacheKey(parts: ClodCacheKeyParts): string {
  const pageX = field(parts.pageX);
  const pageZ = field(parts.pageZ);
  const lod = parts.lod === undefined ? "_" : `lod${parts.lod}`;
  const nodeId = field(parts.nodeId);

  return [
    parts.namespace,
    String(parts.schemaVersion),
    parts.builderVersion,
    parts.artifactKind,
    parts.worldSeed,
    parts.generatorVersion,
    parts.sourceRevision,
    parts.configHash,
    parts.sourceHash,
    `${pageX}_${pageZ}_${lod}_${nodeId}`,
  ].join("/");
}

export function parsePageCoordsFromNodeId(nodeId: string): { pageX: number; pageZ: number; lod: number } {
  const match = /^L(\d+):(\d+),(\d+)$/.exec(nodeId);
  if (!match) throw new Error(`invalid node id: ${nodeId}`);
  return { lod: Number(match[1]), pageX: Number(match[2]), pageZ: Number(match[3]) };
}
