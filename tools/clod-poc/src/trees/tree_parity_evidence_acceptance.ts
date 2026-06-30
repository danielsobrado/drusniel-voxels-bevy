import {
  evaluateTreeImpostorAcceptance,
  type TreeImpostorAcceptanceReport,
  type TreeImpostorPerfSample,
  type TreeImpostorVisualSample,
} from "./tree_impostor_acceptance.js";
import { getTreeParityEvidencePath, numericTreeParityEvidenceValue } from "./tree_parity_evidence_utils.js";
import type {
  TreeParityAcceptanceEvidenceConfig,
  TreeParityAcceptanceVisualPaths,
  TreeParityEvidenceInput,
} from "./tree_parity_evidence_types.js";

const DEFAULT_FRAME_P95_PATH = "snapshot.metrics.frameMs.p95";

const DEFAULT_VISUAL_PATHS: Required<TreeParityAcceptanceVisualPaths> = {
  luminanceMean: "luminanceMean",
  luminanceStdDev: "luminanceStdDev",
  maxViewBlendDelta: "maxViewBlendDelta",
  nearImpostorColorDelta: "nearImpostorColorDelta",
  boundaryHoleRatio: "boundaryHoleRatio",
  boundaryDoubleDrawRatio: "boundaryDoubleDrawRatio",
};

export interface TreeParityAcceptanceEvidenceResult {
  id: string;
  report: TreeImpostorAcceptanceReport;
}

export function evaluateTreeParityAcceptanceEvidence(input: TreeParityEvidenceInput): TreeParityAcceptanceEvidenceResult | null {
  const acceptance = input.manifest.acceptance;
  if (!acceptance) return null;
  return {
    id: acceptance.id ?? "tree-impostor-acceptance",
    report: evaluateTreeImpostorAcceptance(
      readVisualSample(input, acceptance),
      readPerfSample(input, acceptance),
    ),
  };
}

function readVisualSample(input: TreeParityEvidenceInput, config: TreeParityAcceptanceEvidenceConfig): TreeImpostorVisualSample {
  const source = input.readJson(config.visualArtifact);
  const paths = { ...DEFAULT_VISUAL_PATHS, ...(config.visualPaths ?? {}) };
  return {
    luminanceMean: numberAt(source, paths.luminanceMean),
    luminanceStdDev: numberAt(source, paths.luminanceStdDev),
    maxViewBlendDelta: numberAt(source, paths.maxViewBlendDelta),
    nearImpostorColorDelta: numberAt(source, paths.nearImpostorColorDelta),
    boundaryHoleRatio: numberAt(source, paths.boundaryHoleRatio),
    boundaryDoubleDrawRatio: numberAt(source, paths.boundaryDoubleDrawRatio),
  };
}

function readPerfSample(input: TreeParityEvidenceInput, config: TreeParityAcceptanceEvidenceConfig): TreeImpostorPerfSample {
  return {
    baselineFrameMsP95: numberAt(
      input.readJson(config.baselinePerfArtifact),
      config.baselineFrameMsP95Path ?? DEFAULT_FRAME_P95_PATH,
    ),
    impostorFrameMsP95: numberAt(
      input.readJson(config.impostorPerfArtifact),
      config.impostorFrameMsP95Path ?? DEFAULT_FRAME_P95_PATH,
    ),
  };
}

function numberAt(source: unknown, path: string): number {
  return numericTreeParityEvidenceValue(getTreeParityEvidencePath(source, path));
}
