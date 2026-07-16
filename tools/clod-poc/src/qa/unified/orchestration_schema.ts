import type { QaLane, QaTarget } from "./schema.js";

export const QA_ORCHESTRATION_SCHEMA_VERSION = 1;

export type QaPlaceholder = "OUTPUT_DIR" | "REPOSITORY_ROOT" | "RUN_INDEX" | "SCENE_ID" | "TARGET";

export interface QaCommandArtifact {
  path: string;
  required: boolean;
  deterministic: boolean;
  kind: "file" | "directory" | "json";
  ignore_json_keys: string[];
  numeric_tolerance: number;
}

export interface QaCommandDefinition {
  id: string;
  target: QaTarget | "all";
  lane: QaLane;
  program: string;
  args: string[];
  cwd: string;
  timeout_ms: number;
  continue_on_failure: boolean;
  environment: Record<string, string>;
  placeholders: QaPlaceholder[];
  artifacts: QaCommandArtifact[];
}

export interface QaCommandManifest {
  schema_version: 1;
  commands: QaCommandDefinition[];
}

export interface QaBatteryLane {
  id: string;
  target: QaTarget | "all";
  authoritative: boolean;
  commands: string[];
}

export interface QaBatteryDefinition {
  id: string;
  description: string;
  targets: QaTarget[];
  lanes: string[];
  scenes: string[];
  tags: string[];
}

export interface QaBatteryManifest {
  schema_version: 1;
  lanes: QaBatteryLane[];
  batteries: QaBatteryDefinition[];
}

export interface QaOrchestrationRegistry {
  commands: Map<string, QaCommandDefinition>;
  lanes: Map<string, QaBatteryLane>;
  batteries: Map<string, QaBatteryDefinition>;
}
