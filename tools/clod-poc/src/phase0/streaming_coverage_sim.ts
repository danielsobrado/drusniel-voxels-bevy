export interface StreamingCoverageInput {
  worldCells: number;
  chunkSize: number;
  pageSizeCells: number;
  playerX: number;
  playerZ: number;
  velocityX: number;
  velocityZ: number;
  preloadSeconds: number;
  liveRadiusM: number;
  clodRadiusM: number;
  infiniteStreaming?: boolean;
}

export interface StreamingCoverageReport {
  predictedCenterX: number;
  predictedCenterZ: number;
  requiredChunkCount: number;
  requiredPageCount: number;
  missingChunkCount: number;
  missingPageCount: number;
  nearestMissingDistanceM: number | null;
}

// Pages dedupe through numeric keys instead of strings; 2^26 pages per axis is far beyond any
// reachable world coordinate, so the packed key is collision-free in practice.
const PAGE_KEY_STRIDE = 0x4000000;

export function simulateStreamingCoverage(input: StreamingCoverageInput): StreamingCoverageReport {
  const {
    worldCells, chunkSize, pageSizeCells,
    playerX, playerZ, velocityX, velocityZ,
    preloadSeconds, liveRadiusM, clodRadiusM,
    infiniteStreaming = false,
  } = input;

  const predictedX = playerX + velocityX * preloadSeconds;
  const predictedZ = playerZ + velocityZ * preloadSeconds;

  const effectiveRadius = Math.max(liveRadiusM, clodRadiusM);
  const radiusChunks = Math.ceil(effectiveRadius / chunkSize);
  const centerChunkX = Math.round(predictedX / chunkSize);
  const centerChunkZ = Math.round(predictedZ / chunkSize);

  const chunksPerPage = pageSizeCells / chunkSize;
  const worldChunks = worldCells / chunkSize;
  const worldPages = Math.ceil(worldChunks / chunksPerPage);

  // Chunk coordinates in the scan are unique by construction, so required/missing chunks are
  // plain counts; this runs every frame under acceptance so it must not allocate per cell.
  let requiredChunkCount = 0;
  let missingChunkCount = 0;
  let nearestMissingDist = Infinity;
  const requiredPages = new Set<number>();
  const missingPages = new Set<number>();

  for (let dz = -radiusChunks; dz <= radiusChunks; dz++) {
    for (let dx = -radiusChunks; dx <= radiusChunks; dx++) {
      const distM = Math.hypot(dx * chunkSize, dz * chunkSize);
      if (distM > effectiveRadius) continue;
      const cx = centerChunkX + dx;
      const cz = centerChunkZ + dz;
      requiredChunkCount++;
      const px = Math.floor(cx / chunksPerPage);
      const pz = Math.floor(cz / chunksPerPage);
      requiredPages.add(px * PAGE_KEY_STRIDE + pz);
      if (infiniteStreaming) continue;
      if (cx < 0 || cz < 0 || cx >= worldChunks || cz >= worldChunks) {
        missingChunkCount++;
        const clampX = Math.max(0, Math.min(worldCells, cx * chunkSize));
        const clampZ = Math.max(0, Math.min(worldCells, cz * chunkSize));
        const dist = Math.hypot(clampX - predictedX, clampZ - predictedZ);
        if (dist < nearestMissingDist) nearestMissingDist = dist;
      }
      if (px < 0 || pz < 0 || px >= worldPages || pz >= worldPages) {
        missingPages.add(px * PAGE_KEY_STRIDE + pz);
      }
    }
  }

  if (infiniteStreaming) {
    return {
      predictedCenterX: predictedX,
      predictedCenterZ: predictedZ,
      requiredChunkCount,
      requiredPageCount: requiredPages.size,
      missingChunkCount: 0,
      missingPageCount: 0,
      nearestMissingDistanceM: null,
    };
  }

  return {
    predictedCenterX: predictedX,
    predictedCenterZ: predictedZ,
    requiredChunkCount,
    requiredPageCount: requiredPages.size,
    missingChunkCount,
    missingPageCount: missingPages.size,
    nearestMissingDistanceM: missingChunkCount > 0 ? nearestMissingDist : null,
  };
}
