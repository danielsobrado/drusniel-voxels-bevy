export interface TerrainTextureArrayProbeColor {
  r: number;
  g: number;
  b: number;
}

export interface TerrainTextureArrayProbePass {
  layerCount: number;
  cpuLayerMeans: TerrainTextureArrayProbeColor[];
  gpuStripeMeans: TerrainTextureArrayProbeColor[];
  nearestCpuLayerByStripe: number[];
  cpuUniqueColors: number;
  gpuUniqueColors: number;
  correctLayerRatio: number;
}

export interface TerrainTextureArrayProbeResult {
  supported: boolean;
  reason: string | null;
  synthetic: TerrainTextureArrayProbePass | null;
  actual: TerrainTextureArrayProbePass | null;
}

export interface TerrainTextureArrayProbeFinding {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
}

export function diagnoseTerrainTextureArrayProbe(
  probe: TerrainTextureArrayProbeResult,
): TerrainTextureArrayProbeFinding[] {
  if (!probe.supported) {
    return [{
      severity: "error",
      code: "GPU_TEXTURE_ARRAY_PROBE_FAILED",
      message: probe.reason ?? "GPU texture-array probe is unavailable.",
    }];
  }

  const findings: TerrainTextureArrayProbeFinding[] = [];
  const synthetic = probe.synthetic;
  if (!synthetic || synthetic.correctLayerRatio < 1 || synthetic.gpuUniqueColors < synthetic.layerCount) {
    findings.push({
      severity: "error",
      code: "GPU_TEXTURE_ARRAY_DYNAMIC_INDEX_FAILURE",
      message: synthetic
        ? `Synthetic array probe mapped ${(synthetic.correctLayerRatio * 100).toFixed(1)}% of layers correctly and exposed ${synthetic.gpuUniqueColors}/${synthetic.layerCount} distinct GPU stripes.`
        : "Synthetic array probe returned no data.",
    });
    return findings;
  }

  const actual = probe.actual;
  if (!actual) {
    findings.push({
      severity: "warning",
      code: "ACTUAL_ALBEDO_ARRAY_UNAVAILABLE",
      message: "The synthetic GPU probe passed, but the live terrain albedo array was unavailable.",
    });
    return findings;
  }

  if (actual.cpuUniqueColors <= 1) {
    findings.push({
      severity: "error",
      code: "ALBEDO_ARRAY_CONTENT_COLLAPSE",
      message: `The live CPU albedo array contains only ${actual.cpuUniqueColors} distinguishable layer colour cluster.`,
    });
  } else if (actual.gpuUniqueColors <= 1) {
    findings.push({
      severity: "error",
      code: "GPU_ALBEDO_LAYER_COLLAPSE",
      message: `The CPU array has ${actual.cpuUniqueColors} distinct layers, but GPU readback exposes only ${actual.gpuUniqueColors}.`,
    });
  } else if (actual.correctLayerRatio < 0.7) {
    findings.push({
      severity: "error",
      code: "GPU_ALBEDO_LAYER_MISMATCH",
      message: `Only ${(actual.correctLayerRatio * 100).toFixed(1)}% of live albedo stripes map back to their expected CPU layer.`,
    });
  } else {
    findings.push({
      severity: "info",
      code: "GPU_TEXTURE_ARRAY_PROBE_PASSED",
      message: `Dynamic array indexing passed; ${actual.gpuUniqueColors}/${actual.layerCount} live terrain layers are distinguishable on the GPU.`,
    });
  }

  return findings;
}
