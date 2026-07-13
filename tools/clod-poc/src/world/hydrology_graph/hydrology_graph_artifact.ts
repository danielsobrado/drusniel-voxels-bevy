import { sha256Hex } from "../../cache/checksum.js";
import type { WorldArtifactRef } from "../world_manifest.js";
import type { HydrologyGraph } from "./hydrology_graph.js";
import type { HydrologyGraphConfig } from "./hydrology_graph.js";
import type { TerrainFieldConfigInput } from "../../terrain/terrain_surface.js";

const encoder = new TextEncoder();

async function hashView(view: ArrayBufferView): Promise<string> {
  const bytes = view.byteOffset === 0 && view.byteLength === view.buffer.byteLength
    ? view.buffer as ArrayBuffer
    : view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
  return sha256Hex(bytes);
}

export interface HydrologyGraphArtifact {
  readonly ref: WorldArtifactRef;
  readonly graph: HydrologyGraph;
  readonly buildMs: number;
}

export async function computeHydrologyGraphArtifactHash(graph: HydrologyGraph): Promise<string> {
  const macro = graph.macro;
  const lakeIndex = await hashView(macro.lakeIndex);
  return sha256Hex(encoder.encode(JSON.stringify({
    version: graph.version,
    worldId: graph.worldId,
    seed: graph.seed,
    config: graph.config,
    macro: {
      resX: macro.resX,
      resZ: macro.resZ,
      sizeM: macro.sizeM,
      originM: macro.originM,
      spacingM: macro.spacingM,
      lakeIndex,
    },
    rivers: graph.rivers,
    lakes: graph.lakes,
  })).buffer);
}

export async function computeHydrologyGraphParamsHash(input: {
  readonly worldId: string;
  readonly seed: number;
  readonly sizeM: { readonly x: number; readonly z: number };
  readonly originM: { readonly x: number; readonly z: number };
  readonly terrainFieldConfig: TerrainFieldConfigInput | null;
  readonly config?: Partial<HydrologyGraphConfig>;
}): Promise<string> {
  return sha256Hex(encoder.encode(JSON.stringify(input)).buffer);
}

export async function createHydrologyGraphArtifact(
  graph: HydrologyGraph,
  buildMs: number,
): Promise<HydrologyGraphArtifact> {
  const hash = await computeHydrologyGraphArtifactHash(graph);
  return Object.freeze({
    ref: Object.freeze({ id: `hydrology-graph:${hash.slice(0, 16)}`, hash }),
    graph,
    buildMs,
  });
}

export function collectHydrologyGraphTransferables(graph: HydrologyGraph): Transferable[] {
  const fields = graph.macro.buildFields;
  return fields ? [
    graph.macro.lakeIndex.buffer,
    fields.originalHeight.buffer,
    fields.filledHeight.buffer,
    fields.downstream.buffer,
    fields.accumulation.buffer,
  ] : [graph.macro.lakeIndex.buffer];
}

export function compactHydrologyGraph(graph: HydrologyGraph): HydrologyGraph {
  if (!graph.macro.buildFields) return graph;
  return Object.freeze({
    ...graph,
    macro: Object.freeze({
      resX: graph.macro.resX,
      resZ: graph.macro.resZ,
      sizeM: graph.macro.sizeM,
      originM: graph.macro.originM,
      spacingM: graph.macro.spacingM,
      lakeIndex: graph.macro.lakeIndex,
    }),
  });
}
