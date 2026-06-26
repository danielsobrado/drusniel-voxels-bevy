export function mipLevelForDistance(
  distanceM: number,
  chunkSizeCells: number,
  voxelSizeM: number,
  lodBias: number,
  mipLevels?: readonly number[],
): number {
  const chunkM = chunkSizeCells * voxelSizeM;
  const maxLevel = mipLevels && mipLevels.length > 0
    ? mipLevels.length - 1
    : Math.max(0, Math.floor(Math.log2(chunkSizeCells)));
  const distCells = Math.max(1, distanceM / Math.max(chunkM, 1e-6));
  const raw = Math.floor(Math.log2(distCells)) + lodBias;
  const level = Math.max(0, Math.min(maxLevel, Math.round(raw)));
  return level;
}

export function aadfSkipOccurred(skip: number, cellSize: number): boolean {
  return skip > cellSize * 1.01;
}

export function recordMissingSample(
  state: { metrics: { missingSamples: number; farShellMissingSamples: number; visibleHoles: number } },
  purpose: string,
  unknown: boolean,
): void {
  state.metrics.missingSamples++;
  if (purpose === "render") state.metrics.farShellMissingSamples++;
  if (unknown) state.metrics.visibleHoles++;
}
