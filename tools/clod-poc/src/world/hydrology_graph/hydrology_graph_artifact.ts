import { sha256Hex } from "../../cache/checksum.js";
import type { TerrainFieldConfigInput } from "../../terrain/terrain_surface.js";
import {
  computeTerrainErosionConfigHash,
  parseTerrainErosionConfig,
  resolveRuntimeTerrainErosionConfig,
} from "../erosion/config.js";
import terrainErosionConfigText from "../../../config/terrain_erosion.yaml?raw";
import type { WorldArtifactRef } from "../world_manifest.js";
import type { HydrologyGraph, HydrologyGraphConfig } from "./hydrology_graph.js";

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
  const erosion = macro.erosion ? {
    ref: macro.erosion.artifactRef,
    heightFixed: await hashView(macro.erosion.heightFixed),
    hardness: await hashView(macro.erosion.hardness),
    sediment: await hashView(macro.erosion.sediment),
    deposition: await hashView(macro.erosion.deposition),
  } : null;
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
      erosion,
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
  const searchParams = typeof location === "undefined" ? undefined : new URLSearchParams(location.search);
  const erosionConfig = resolveRuntimeTerrainErosionConfig(parseTerrainErosionConfig(terrainErosionConfigText), searchParams);
  const erosionConfigHash = await computeTerrainErosionConfigHash(erosionConfig);
  return sha256Hex(encoder.encode(JSON.stringify({ ...input, erosionConfigHash })).buffer);
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
  const erosion = graph.macro.erosion;
  const transferables: Transferable[] = [graph.macro.lakeIndex.buffer];
  if (fields) transferables.push(
    fields.originalHeight.buffer,
    fields.filledHeight.buffer,
    fields.downstream.buffer,
    fields.accumulation.buffer,
  );
  if (erosion) transferables.push(
    erosion.heightFixed.buffer,
    erosion.hardness.buffer,
    erosion.sediment.buffer,
    erosion.deposition.buffer,
  );
  return transferables;
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
      ...(graph.macro.erosion ? { erosion: graph.macro.erosion } : {}),
    }),
  });
}
