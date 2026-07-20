import { rmSync } from "node:fs";
import { join } from "node:path";

export interface WaterFoamDistanceCaptureFiles {
  readonly bodyMask: string;
  readonly depth: string;
  readonly near: string;
  readonly mid: string;
  readonly far: string;
}

export interface WaterFoamDistanceEvidence {
  readonly reportPath: string;
  readonly files: WaterFoamDistanceCaptureFiles;
}

export function resolveWaterFoamDistanceEvidence(
  outRoot: string,
): WaterFoamDistanceEvidence {
  return {
    reportPath: join(outRoot, "report.json"),
    files: {
      bodyMask: join(outRoot, "body-mask.png"),
      depth: join(outRoot, "depth.png"),
      near: join(outRoot, "foam-near.png"),
      mid: join(outRoot, "foam-mid.png"),
      far: join(outRoot, "foam-far.png"),
    },
  };
}

export function clearWaterFoamDistanceEvidence(
  evidence: WaterFoamDistanceEvidence,
): void {
  rmSync(evidence.reportPath, { force: true });
  for (const path of Object.values(evidence.files)) rmSync(path, { force: true });
}
