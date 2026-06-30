export type TreeParityEvidenceArtifact = "image" | "stats" | "perf" | "notes";

export interface TreeParityEvidenceArtifactSet {
  image?: string;
  stats?: string;
  perf?: string;
  notes?: string;
}

export interface TreeParityEvidenceMetricRule {
  artifact: "stats" | "perf";
  path: string;
  min?: number;
  max?: number;
  equals?: number | string | boolean | null;
  present?: boolean;
  nonZero?: boolean;
}

export interface TreeParityCaptureConfig {
  scene?: string;
  camera?: string;
  params?: Record<string, string | number | boolean>;
  perfCase?: string;
  world?: number;
  width?: number;
  height?: number;
  settleFrames?: number;
  warmupFrames?: number;
  sampleFrames?: number;
  timeoutMs?: number;
}

export interface TreeParityEvidenceCapture {
  id: string;
  description?: string;
  artifacts?: TreeParityEvidenceArtifactSet;
  capture?: TreeParityCaptureConfig;
  metrics?: TreeParityEvidenceMetricRule[];
}

export interface TreeParityAcceptanceVisualPaths {
  luminanceMean?: string;
  luminanceStdDev?: string;
  maxViewBlendDelta?: string;
  nearImpostorColorDelta?: string;
  boundaryHoleRatio?: string;
  boundaryDoubleDrawRatio?: string;
}

export interface TreeParityAcceptanceEvidenceConfig {
  id?: string;
  visualArtifact: string;
  baselinePerfArtifact: string;
  impostorPerfArtifact: string;
  visualPaths?: TreeParityAcceptanceVisualPaths;
  baselineFrameMsP95Path?: string;
  impostorFrameMsP95Path?: string;
}

export interface TreeParityEvidenceManifest {
  captures: TreeParityEvidenceCapture[];
  acceptance?: TreeParityAcceptanceEvidenceConfig;
}

export interface TreeParityEvidenceFileInfo {
  exists: boolean;
  sizeBytes: number;
}

export interface TreeParityEvidenceInput {
  manifest: TreeParityEvidenceManifest;
  fileInfo(path: string): TreeParityEvidenceFileInfo;
  readJson(path: string): unknown;
}

export interface TreeParityEvidenceFailure {
  captureId: string;
  message: string;
}

export interface TreeParityEvidenceResult {
  ok: boolean;
  failures: TreeParityEvidenceFailure[];
}

export interface TreeParityCaptureCommandOptions {
  baseUrl?: string;
  renderer?: "webgpu" | "webgl";
  world?: number;
  width?: number;
  height?: number;
  settleFrames?: number;
  warmupFrames?: number;
  sampleFrames?: number;
  timeoutMs?: number;
}

export interface TreeParityCaptureCommandSet {
  captureId: string;
  screenshotCommand: string | null;
  perfCommand: string | null;
}

export interface TreeParityEvidenceReportOptions {
  generatedAt?: string;
  title?: string;
}
