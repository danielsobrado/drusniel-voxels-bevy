import type { ClodNodeId, ClodPageNodeRuntime } from "../runtime/clodRuntimeTypes.js";
import type { ClodPageNode } from "../../types.js";
import type { FixtureDef } from "../stressFixtures.js";
import * as THREE from "three";

export interface TerrainBuildResult {
  rootNodeIds: ClodNodeId[];
  nodes: Map<ClodNodeId, ClodPageNodeRuntime>;
  nodeDefs: Map<ClodNodeId, ClodPageNode>;
  scene: THREE.Scene;
  fixtureDef: FixtureDef;
}

export type StressTerrainDebugMode =
  | "final"
  | "lod"
  | "coastType"
  | "materialWeights"
  | "pageSourceSections";
