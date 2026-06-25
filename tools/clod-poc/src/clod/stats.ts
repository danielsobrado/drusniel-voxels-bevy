export interface LevelStats {
  level: number;
  nodeCount: number;
  inputTriangles: number;
  outputTriangles: number;
  reductionRatio: number;
  lowBenefitCount: number;
  averageErrorWorld: number;
  maxErrorWorld: number;
  averageBuildMs: number;
  maxBuildMs: number;
}

export interface BuildStats {
  totalBuildMs: number;
  levels: LevelStats[];
}

export function formatBuildStats(stats: BuildStats): string {
  const lines: string[] = [];
  lines.push(`Total build: ${stats.totalBuildMs.toFixed(1)}ms`);
  lines.push("");
  lines.push("Level  Nodes  InTris  OutTris  Reduction  Low%%  AvgErr  MaxErr  AvgMs  MaxMs");
  for (const l of stats.levels) {
    const reduction = (1 - l.reductionRatio) * 100;
    const lowPct = l.lowBenefitCount / Math.max(1, l.nodeCount) * 100;
    lines.push(
      `L${l.level}  ${l.nodeCount.toString().padStart(4)}  ` +
      `${l.inputTriangles.toString().padStart(6)}  ${l.outputTriangles.toString().padStart(6)}  ` +
      `${reduction.toFixed(1).padStart(5)}%  ${lowPct.toFixed(0).padStart(3)}%  ` +
      `${l.averageErrorWorld.toFixed(4)}  ${l.maxErrorWorld.toFixed(4)}  ` +
      `${l.averageBuildMs.toFixed(1)}  ${l.maxBuildMs.toFixed(1)}`
    );
  }
  return lines.join("\n");
}
