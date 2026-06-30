import { describe, expect, it } from "vitest";
import {
  validateTreeParityManifestCaptureConfig,
  type TreeParityEvidenceManifest,
} from "./tree_parity_evidence.js";

describe("TREE-11 acceptance evidence manifest validation", () => {
  it("rejects empty acceptance artifact paths", () => {
    const manifest: TreeParityEvidenceManifest = {
      captures: [],
      acceptance: {
        visualArtifact: "",
        baselinePerfArtifact: "",
        impostorPerfArtifact: "",
      },
    };

    expect(validateTreeParityManifestCaptureConfig(manifest)).toEqual(expect.arrayContaining([
      { captureId: "tree-impostor-acceptance", message: "acceptance.visualArtifact is required" },
      { captureId: "tree-impostor-acceptance", message: "acceptance.baselinePerfArtifact is required" },
      { captureId: "tree-impostor-acceptance", message: "acceptance.impostorPerfArtifact is required" },
    ]));
  });

  it("rejects empty acceptance metric-path overrides", () => {
    const manifest: TreeParityEvidenceManifest = {
      captures: [],
      acceptance: {
        id: "tree-11",
        visualArtifact: "shots/tree-visual.json",
        baselinePerfArtifact: "perf/baseline.json",
        impostorPerfArtifact: "perf/impostor.json",
        visualPaths: {
          luminanceStdDev: "",
        },
        baselineFrameMsP95Path: "",
        impostorFrameMsP95Path: "",
      },
    };

    expect(validateTreeParityManifestCaptureConfig(manifest)).toEqual(expect.arrayContaining([
      { captureId: "tree-11", message: "acceptance.visualPaths.luminanceStdDev is required" },
      { captureId: "tree-11", message: "acceptance.baselineFrameMsP95Path is required" },
      { captureId: "tree-11", message: "acceptance.impostorFrameMsP95Path is required" },
    ]));
  });
});
