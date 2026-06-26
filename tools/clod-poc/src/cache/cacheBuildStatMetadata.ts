import type { NodeBuildStat } from "../clod/quadtree.js";

const BUILD_STAT_JSON_KEY = "buildStatJson";

export function encodeBuildStatMetadata(stat: NodeBuildStat): Record<string, string | number | boolean> {
  return {
    buildMs: stat.buildMs,
    [BUILD_STAT_JSON_KEY]: JSON.stringify({
      inputTris: stat.inputTris,
      outputTris: stat.outputTris,
      lockedVerts: stat.lockedVerts,
      errorWorld: stat.errorWorld,
      lowBenefit: stat.lowBenefit,
      polish: stat.polish,
    }),
  };
}

export function decodeBuildStatFromMetadata(
  nodeId: string,
  level: number,
  metadata: Record<string, string | number | boolean> | undefined,
): NodeBuildStat | null {
  if (!metadata) return null;
  const raw = metadata[BUILD_STAT_JSON_KEY];
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as Pick<
      NodeBuildStat,
      "inputTris" | "outputTris" | "lockedVerts" | "errorWorld" | "lowBenefit" | "polish"
    >;
    return {
      id: nodeId,
      level,
      inputTris: parsed.inputTris,
      outputTris: parsed.outputTris,
      lockedVerts: parsed.lockedVerts,
      errorWorld: parsed.errorWorld,
      lowBenefit: parsed.lowBenefit,
      polish: parsed.polish,
      buildMs: typeof metadata.buildMs === "number" ? metadata.buildMs : 0,
      fromCache: true,
    };
  } catch {
    return null;
  }
}
