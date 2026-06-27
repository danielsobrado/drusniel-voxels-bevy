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

function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

function pageKey(px: number, pz: number): string {
  return `${px},${pz}`;
}

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
  const requiredChunks = new Set<string>();
  const requiredPages = new Set<string>();

  for (let dz = -radiusChunks; dz <= radiusChunks; dz++) {
    for (let dx = -radiusChunks; dx <= radiusChunks; dx++) {
      const distM = Math.hypot(dx * chunkSize, dz * chunkSize);
      if (distM > effectiveRadius) continue;
      const cx = centerChunkX + dx;
      const cz = centerChunkZ + dz;
      requiredChunks.add(chunkKey(cx, cz));
      const px = Math.floor(cx / chunksPerPage);
      const pz = Math.floor(cz / chunksPerPage);
      requiredPages.add(pageKey(px, pz));
    }
  }

  if (infiniteStreaming) {
    return {
      predictedCenterX: predictedX,
      predictedCenterZ: predictedZ,
      requiredChunkCount: requiredChunks.size,
      requiredPageCount: requiredPages.size,
      missingChunkCount: 0,
      missingPageCount: 0,
      nearestMissingDistanceM: null,
    };
  }

  const worldChunks = worldCells / chunkSize;
  const missingChunks: string[] = [];
  let nearestMissingDist = Infinity;

  for (const key of requiredChunks) {
    const [cx, cz] = key.split(",").map(Number);
    if (cx < 0 || cz < 0 || cx >= worldChunks || cz >= worldChunks) {
      missingChunks.push(key);
      const clampX = Math.max(0, Math.min(worldCells, cx * chunkSize));
      const clampZ = Math.max(0, Math.min(worldCells, cz * chunkSize));
      const dist = Math.hypot(clampX - predictedX, clampZ - predictedZ);
      if (dist < nearestMissingDist) nearestMissingDist = dist;
    }
  }

  const worldPages = Math.ceil(worldChunks / chunksPerPage);
  const missingPages = new Set<string>();
  for (const key of requiredPages) {
    const [px, pz] = key.split(",").map(Number);
    if (px < 0 || pz < 0 || px >= worldPages || pz >= worldPages) {
      missingPages.add(key);
    }
  }

  return {
    predictedCenterX: predictedX,
    predictedCenterZ: predictedZ,
    requiredChunkCount: requiredChunks.size,
    requiredPageCount: requiredPages.size,
    missingChunkCount: missingChunks.length,
    missingPageCount: missingPages.size,
    nearestMissingDistanceM: missingChunks.length > 0 ? nearestMissingDist : null,
  };
}
