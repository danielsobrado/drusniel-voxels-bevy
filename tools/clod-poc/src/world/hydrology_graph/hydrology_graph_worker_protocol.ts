import type { TerrainFieldConfigInput } from "../../terrain/terrain_surface.js";
import type { ErosionArtifactRef, SerializedErodedMacroField } from "../erosion/types.js";
import type { HydrologyGraphArtifact } from "./hydrology_graph_artifact.js";
import type { HydrologyGraphConfig } from "./hydrology_graph.js";

export interface HydrologyGraphWorkerBuildRequest {
  readonly type: "buildHydrologyGraph";
  readonly requestId: number;
  readonly worldId: string;
  readonly seed: number;
  readonly sizeM: { readonly x: number; readonly z: number };
  readonly originM?: { readonly x: number; readonly z: number };
  readonly terrainFieldConfig: TerrainFieldConfigInput | null;
  readonly config?: Partial<HydrologyGraphConfig>;
  readonly erodedMacroField: SerializedErodedMacroField;
  readonly erosionArtifactRef: ErosionArtifactRef;
}

export type HydrologyGraphWorkerRequest = HydrologyGraphWorkerBuildRequest;

export type HydrologyGraphWorkerResponse =
  | { readonly type: "hydrologyGraphProgress"; readonly requestId: number; readonly buildPct: number; readonly sampledRows: number; readonly totalRows: number }
  | { readonly type: "hydrologyGraphBuilt"; readonly requestId: number; readonly artifact: HydrologyGraphArtifact }
  | { readonly type: "hydrologyGraphError"; readonly requestId: number; readonly message: string };
