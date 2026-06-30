import type {
  TreeParityEvidenceArtifact,
  TreeParityEvidenceFailure,
  TreeParityEvidenceManifest,
} from "./tree_parity_evidence_types.js";

const TREE_PARITY_SUPPORTED_CAPTURE_PARAMS = new Set([
  "treeGpu",
  "treeGpuRing",
  "webgpuSelection",
  "freeze",
  "sunElevationDeg",
  "sunElevation",
  "sunAzimuthDeg",
  "sunAzimuth",
  "treeDistance",
  "treeDistanceM",
  "treeGpuMaxVisible",
  "treeGpuMax",
  "treeMaxInstances",
  "treeMax",
  "trees",
  "understory",
  "grass",
  "stones",
  "water",
  "weather",
  "postProcess",
  "postprocess",
  "terrainMaterial",
  "terrainTriplanar",
  "farShell",
  "clodPerf",
  "clodShadowOverlay",
  "clodShadowProxy",
  "profile",
]);

export function validateTreeParityManifestCaptureConfig(manifest: TreeParityEvidenceManifest): TreeParityEvidenceFailure[] {
  const failures: TreeParityEvidenceFailure[] = [];
  const seenCaptureIds = new Set<string>();
  const artifactOwners = new Map<string, { captureId: string; artifact: TreeParityEvidenceArtifact }>();

  for (const capture of manifest.captures) {
    const captureId = capture.id?.trim() || "<missing>";
    if (!capture.id?.trim()) failures.push({ captureId, message: "capture id is required" });
    else if (seenCaptureIds.has(capture.id)) failures.push({ captureId, message: `duplicate capture id: ${capture.id}` });
    else seenCaptureIds.add(capture.id);

    for (const [artifact, path] of Object.entries(capture.artifacts ?? {}) as [TreeParityEvidenceArtifact, string][]) {
      if (!path?.trim()) {
        failures.push({ captureId, message: `${artifact} artifact path is required` });
        continue;
      }
      const existing = artifactOwners.get(path);
      if (existing) {
        failures.push({
          captureId,
          message: `${artifact} artifact duplicates ${existing.captureId}.${existing.artifact}: ${path}`,
        });
        continue;
      }
      artifactOwners.set(path, { captureId, artifact });
    }

    for (const key of Object.keys(capture.capture?.params ?? {})) {
      if (!TREE_PARITY_SUPPORTED_CAPTURE_PARAMS.has(key)) {
        failures.push({ captureId, message: `unsupported capture param: ${key}` });
      }
    }
    if (capture.artifacts?.perf && !capture.capture?.perfCase) {
      failures.push({ captureId, message: "perf artifact requires capture.perfCase" });
    }
    if (capture.capture?.perfCase && !capture.artifacts?.perf) {
      failures.push({ captureId, message: "capture.perfCase requires perf artifact" });
    }
    for (const metric of capture.metrics ?? []) {
      if (!metric.path?.trim()) failures.push({ captureId, message: "metric path is required" });
      if (!capture.artifacts?.[metric.artifact]) {
        failures.push({ captureId, message: `metric ${metric.path || "<missing>"} has no ${metric.artifact} artifact configured` });
      }
    }
  }

  validateAcceptanceManifest(manifest, failures);
  return failures;
}

function validateAcceptanceManifest(manifest: TreeParityEvidenceManifest, failures: TreeParityEvidenceFailure[]): void {
  const acceptance = manifest.acceptance;
  if (!acceptance) return;
  const captureId = acceptance.id ?? "tree-impostor-acceptance";
  if (!acceptance.visualArtifact?.trim()) failures.push({ captureId, message: "acceptance.visualArtifact is required" });
  if (!acceptance.baselinePerfArtifact?.trim()) failures.push({ captureId, message: "acceptance.baselinePerfArtifact is required" });
  if (!acceptance.impostorPerfArtifact?.trim()) failures.push({ captureId, message: "acceptance.impostorPerfArtifact is required" });
  for (const [key, path] of Object.entries(acceptance.visualPaths ?? {})) {
    if (!path?.trim()) failures.push({ captureId, message: `acceptance.visualPaths.${key} is required` });
  }
  if (acceptance.baselineFrameMsP95Path !== undefined && !acceptance.baselineFrameMsP95Path.trim()) {
    failures.push({ captureId, message: "acceptance.baselineFrameMsP95Path is required" });
  }
  if (acceptance.impostorFrameMsP95Path !== undefined && !acceptance.impostorFrameMsP95Path.trim()) {
    failures.push({ captureId, message: "acceptance.impostorFrameMsP95Path is required" });
  }
}
