import type { FarSummarySample, FarSummaryTile, FarSummaryTileKey } from "./types.js";
import type { FarSummaryRingConfig } from "./config.js";
import { tileOrigin } from "./tile-key.js";
import { sampleCaveEntranceCoverage } from "../terrain/voxel_overlay/voxel_overlay.js";

export interface FarTerrainSampler {
  sampleHeight(x: number, z: number): number;
  sampleMaterial?(x: number, z: number): number;
  sampleCanopyCoverage?(x: number, z: number): number;
  sampleStructureCoverage?(x: number, z: number, cellSizeM: number): number;
  sampleWaterCoverage?(x: number, z: number): number;
  sampleWaterCoverageForHeight?(x: number, z: number, height: number): number;
  /** Canonical hydrology graph sample when the world has one. */
  sampleWaterSummary?(x: number, z: number, cellSizeM: number): FarSummaryWaterSample;
  /** Same deterministic forest distribution used by near canopy. */
  sampleCanopySummary?(cellOriginX: number, cellOriginZ: number, cellSizeM: number): FarSummaryCanopySample;
}

export interface FarSummaryWaterSample {
  coverage: number;
  waterLevel: number;
  bodyKind: number;
  shoreDistance: number;
  flowX: number;
  flowZ: number;
}

export interface FarSummaryCanopySample {
  coverage: number;
  canopyHeightAvg: number;
  speciesPine: number;
  speciesBroadleaf: number;
  speciesDeadwood: number;
}

export interface FarSummaryBuildInput {
  key: FarSummaryTileKey;
  ringConfig: FarSummaryRingConfig;
  terrainSampler: FarTerrainSampler;
  frameIndex: number;
  nowMs: number;
}

interface HeightGrid {
  values: Float64Array;
  initialized: Uint8Array;
  stride: number;
  tileCells: number;
  originX: number;
  originZ: number;
  cellM: number;
  sampleHeight: (x: number, z: number) => number;
}

export interface FarSummaryTileBuildState {
  readonly input: FarSummaryBuildInput;
  readonly originX: number;
  readonly originZ: number;
  readonly sampleCount: number;
  readonly samples: FarSummarySample[];
  readonly heightGrid: HeightGrid;
  cursor: number;
  globalMin: number;
  globalMax: number;
  globalSum: number;
  validSamples: number;
}

const GRID_BORDER_CELLS = 1;
const BUILD_DEADLINE_CHECK_INTERVAL_CELLS = 8;
const WATER_COVERAGE_BLOCK_THRESHOLD = 0.05;

export function computeNormalFiniteDifference(
  h: (x: number, z: number) => number,
  x: number,
  z: number,
  step: number,
): [number, number, number] {
  const hL = h(x - step, z);
  const hR = h(x + step, z);
  const hD = h(x, z - step);
  const hU = h(x, z + step);

  if (!Number.isFinite(hL) || !Number.isFinite(hR) || !Number.isFinite(hD) || !Number.isFinite(hU)) {
    return [0, 1, 0];
  }

  return normalFromHeights(hL, hR, hD, hU, step);
}

function normalFromHeights(
  hL: number,
  hR: number,
  hD: number,
  hU: number,
  step: number,
): [number, number, number] {
  if (!Number.isFinite(hL) || !Number.isFinite(hR) || !Number.isFinite(hD) || !Number.isFinite(hU)) {
    return [0, 1, 0];
  }
  const nx = hL - hR;
  const ny = 2 * step;
  const nz = hD - hU;
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-10) return [0, 1, 0];
  return [nx / len, ny / len, nz / len];
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function finiteMin(values: readonly number[], fallback: number): number {
  let out = Number.POSITIVE_INFINITY;
  for (const value of values) if (Number.isFinite(value) && value < out) out = value;
  return Number.isFinite(out) ? out : fallback;
}

function finiteMax(values: readonly number[], fallback: number): number {
  let out = Number.NEGATIVE_INFINITY;
  for (const value of values) if (Number.isFinite(value) && value > out) out = value;
  return Number.isFinite(out) ? out : fallback;
}

function createHeightGrid(
  originX: number,
  originZ: number,
  cellM: number,
  tileCells: number,
  sampleHeight: (x: number, z: number) => number,
): HeightGrid {
  const stride = tileCells + GRID_BORDER_CELLS * 2;
  return {
    values: new Float64Array(stride * stride),
    initialized: new Uint8Array(stride * stride),
    stride,
    tileCells,
    originX,
    originZ,
    cellM,
    sampleHeight,
  };
}

function heightAt(grid: HeightGrid, sx: number, sz: number): number {
  const gx = Math.max(-GRID_BORDER_CELLS, Math.min(grid.tileCells, sx));
  const gz = Math.max(-GRID_BORDER_CELLS, Math.min(grid.tileCells, sz));
  const index = (gz + GRID_BORDER_CELLS) * grid.stride + gx + GRID_BORDER_CELLS;
  if (grid.initialized[index]) return grid.values[index];

  const wx = grid.originX + (gx + 0.5) * grid.cellM;
  const wz = grid.originZ + (gz + 0.5) * grid.cellM;
  const height = grid.sampleHeight(wx, wz);
  grid.values[index] = height;
  grid.initialized[index] = 1;
  return height;
}

export function createFarSummaryTileBuild(input: FarSummaryBuildInput): FarSummaryTileBuildState {
  const { key, ringConfig, terrainSampler } = input;
  const originX = tileOrigin(key.x, ringConfig.cellM, ringConfig.tileCells);
  const originZ = tileOrigin(key.z, ringConfig.cellM, ringConfig.tileCells);
  const sampleCount = ringConfig.tileCells * ringConfig.tileCells;
  return {
    input,
    originX,
    originZ,
    sampleCount,
    samples: new Array(sampleCount),
    heightGrid: createHeightGrid(originX, originZ, ringConfig.cellM, ringConfig.tileCells, terrainSampler.sampleHeight),
    cursor: 0,
    globalMin: Number.POSITIVE_INFINITY,
    globalMax: Number.NEGATIVE_INFINITY,
    globalSum: 0,
    validSamples: 0,
  };
}

export function stepFarSummaryTileBuild(
  build: FarSummaryTileBuildState,
  deadlineMs: number,
): boolean {
  let cellsSinceDeadlineCheck = 0;

  while (build.cursor < build.sampleCount) {
    build.samples[build.cursor] = sampleCell(build, build.cursor);
    build.cursor++;
    cellsSinceDeadlineCheck++;

    if (cellsSinceDeadlineCheck >= BUILD_DEADLINE_CHECK_INTERVAL_CELLS) {
      cellsSinceDeadlineCheck = 0;
      if (performance.now() >= deadlineMs) return false;
    }
  }

  return true;
}

export function finishFarSummaryTileBuild(build: FarSummaryTileBuildState): FarSummaryTile {
  const { key, ringConfig, frameIndex, nowMs } = build.input;
  const avg = build.validSamples > 0 ? build.globalSum / build.validSamples : 0;

  for (let i = 0; i < build.samples.length; i++) {
    const sample = build.samples[i];
    if (!sample) {
      build.samples[i] = fallbackSample(avg);
      continue;
    }
    if (!Number.isFinite(sample.heightAvg)) sample.heightAvg = avg;
    if (!Number.isFinite(sample.heightMin)) sample.heightMin = avg;
    if (!Number.isFinite(sample.heightMax)) sample.heightMax = avg;
  }

  return {
    key,
    state: "ready",
    revision: 0,
    lastTouchedFrame: frameIndex,
    lastTouchedTimeMs: nowMs,
    cellSizeM: ringConfig.cellM,
    tileCells: ringConfig.tileCells,
    originX: build.originX,
    originZ: build.originZ,
    samples: build.samples,
  };
}

export function buildFarSummaryTile(input: FarSummaryBuildInput): FarSummaryTile {
  const build = createFarSummaryTileBuild(input);
  stepFarSummaryTileBuild(build, Number.POSITIVE_INFINITY);
  return finishFarSummaryTileBuild(build);
}

export function enrichFarSummaryTileUnifiedChannels(
  tile: FarSummaryTile,
  terrainSampler: FarTerrainSampler,
): FarSummaryTile {
  if (!hasUnifiedEnrichment(terrainSampler)) return tile;
  const state = createFarSummaryUnifiedEnrichment(tile);
  stepFarSummaryUnifiedEnrichment(state, terrainSampler, Number.POSITIVE_INFINITY);
  return tile;
}

export interface FarSummaryUnifiedEnrichmentState {
  tile: FarSummaryTile;
  nextSample: number;
  nextCanopySample: number;
  waterSnapshotTaken: boolean;
}

export function createFarSummaryUnifiedEnrichment(tile: FarSummaryTile): FarSummaryUnifiedEnrichmentState {
  return { tile, nextSample: 0, nextCanopySample: 0, waterSnapshotTaken: false };
}

export function takeFarSummaryUnifiedWaterSnapshot(
  state: FarSummaryUnifiedEnrichmentState,
): FarSummaryTile | null {
  if (state.waterSnapshotTaken || state.nextSample < state.tile.samples.length) return null;
  state.waterSnapshotTaken = true;
  return {
    ...state.tile,
    key: { ...state.tile.key },
    samples: state.tile.samples.map((sample) => ({ ...sample })),
  };
}

export function stepFarSummaryUnifiedEnrichment(
  state: FarSummaryUnifiedEnrichmentState,
  terrainSampler: FarTerrainSampler,
  deadlineMs: number,
): boolean {
  if (!hasUnifiedEnrichment(terrainSampler)) {
    state.nextSample = state.tile.samples.length;
    state.nextCanopySample = coarseCanopySampleCount(state.tile.tileCells);
    return true;
  }

  const waterWasComplete = state.nextSample >= state.tile.samples.length;
  if (!stepFarSummaryUnifiedWaterEnrichment(state, terrainSampler, deadlineMs)) return false;
  if (!waterWasComplete && performance.now() >= deadlineMs) return false;

  let stepped = false;
  const canopySampleCount = coarseCanopySampleCount(state.tile.tileCells);
  if (!terrainSampler.sampleCanopySummary) {
    state.nextCanopySample = canopySampleCount;
  }

  while (state.nextCanopySample < canopySampleCount && (!stepped || performance.now() < deadlineMs)) {
    const target = coarseCanopySampleTarget(state.tile.tileCells, state.nextCanopySample++);
    const tile = state.tile;

    if (target.sx >= tile.tileCells || target.sz >= tile.tileCells) {
      stepped = true;
      continue;
    }

    const sample = tile.samples[target.sz * tile.tileCells + target.sx]!;
    const canopy = terrainSampler.sampleCanopySummary!(
      tile.originX + target.sx * tile.cellSizeM,
      tile.originZ + target.sz * tile.cellSizeM,
      tile.cellSizeM,
    );
    // Water masks canopy *coverage*, but the height channel still records what the canopy sampler
    // reported — clearing it here would reset canopyHeightAvg to ground level and break the
    // long-standing water-snapshot contract.
    sample.canopyCoverage = farSummaryCanopyWaterBlocked(tile, target.sx, target.sz)
      ? 0
      : clamp01(canopy.coverage);
    sample.canopyHeightAvg = finiteOr(canopy.canopyHeightAvg, sample.canopyHeightAvg);
    sample.speciesPine = clamp01(canopy.speciesPine);
    sample.speciesBroadleaf = clamp01(canopy.speciesBroadleaf);
    sample.speciesDeadwood = clamp01(canopy.speciesDeadwood);
    stepped = true;
  }

  return state.nextCanopySample >= canopySampleCount;
}

export function farSummaryWaterNeighbourhoodCoverage(
  tile: FarSummaryTile,
  sx: number,
  sz: number,
): number {
  let coverage = 0;
  for (let dz = -1; dz <= 1; dz++) {
    const nz = sz + dz;
    if (nz < 0 || nz >= tile.tileCells) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const nx = sx + dx;
      if (nx < 0 || nx >= tile.tileCells) continue;
      coverage = Math.max(coverage, tile.samples[nz * tile.tileCells + nx]?.waterCoverage ?? 0);
    }
  }
  return coverage;
}

export function stepFarSummaryUnifiedWaterEnrichment(
  state: FarSummaryUnifiedEnrichmentState,
  terrainSampler: FarTerrainSampler,
  deadlineMs: number,
): boolean {
  let stepped = false;
  while (state.nextSample < state.tile.samples.length && (!stepped || performance.now() < deadlineMs)) {
    const idx = state.nextSample++;
    const sample = state.tile.samples[idx]!;
    const sx = idx % state.tile.tileCells;
    const sz = Math.floor(idx / state.tile.tileCells);
    const tile = state.tile;
    const wx = tile.originX + (sx + 0.5) * tile.cellSizeM;
    const wz = tile.originZ + (sz + 0.5) * tile.cellSizeM;
    const water = terrainSampler.sampleWaterSummary?.(wx, wz, tile.cellSizeM);
    sample.waterCoverage = clamp01(water?.coverage
      ?? terrainSampler.sampleWaterCoverageForHeight?.(wx, wz, sample.heightAvg)
      ?? sample.waterCoverage);
    sample.waterLevel = finiteOr(water?.waterLevel, sample.waterLevel);
    sample.bodyKind = finiteOr(water?.bodyKind, sample.bodyKind);
    sample.shoreDistance = finiteOr(water?.shoreDistance, sample.shoreDistance);
    sample.flowX = finiteOr(water?.flowX, sample.flowX);
    sample.flowZ = finiteOr(water?.flowZ, sample.flowZ);
    if (sample.waterCoverage > WATER_COVERAGE_BLOCK_THRESHOLD) clearCanopySample(sample);
    stepped = true;
  }
  return state.nextSample >= state.tile.samples.length;
}

export function farSummaryCanopyWaterBlocked(
  tile: FarSummaryTile,
  sx: number,
  sz: number,
): boolean {
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = Math.max(0, Math.min(tile.tileCells - 1, sx + dx));
      const z = Math.max(0, Math.min(tile.tileCells - 1, sz + dz));
      if (tile.samples[z * tile.tileCells + x]!.waterCoverage > WATER_COVERAGE_BLOCK_THRESHOLD) {
        return true;
      }
    }
  }
  return false;
}

function hasUnifiedEnrichment(terrainSampler: FarTerrainSampler): boolean {
  return Boolean(
    terrainSampler.sampleWaterSummary
    || terrainSampler.sampleWaterCoverageForHeight
    || terrainSampler.sampleCanopySummary
  );
}

function clearCanopySample(sample: FarSummarySample): void {
  sample.canopyCoverage = 0;
  sample.canopyHeightAvg = sample.heightAvg;
  sample.speciesPine = 0;
  sample.speciesBroadleaf = 0;
  sample.speciesDeadwood = 0;
}

function coarseCanopySampleCount(tileCells: number): number {
  const blockSize = Math.min(8, tileCells);
  const blocksPerAxis = Math.ceil(tileCells / blockSize);
  const representativesPerAxis = blockSize > 1 ? 2 : 1;
  return blocksPerAxis * blocksPerAxis * representativesPerAxis * representativesPerAxis;
}

function coarseCanopySampleTarget(tileCells: number, sampleIndex: number): { sx: number; sz: number } {
  const blockSize = Math.min(8, tileCells);
  const blocksPerAxis = Math.ceil(tileCells / blockSize);
  const representativeCells = blockSize > 1
    ? [Math.floor(blockSize * 0.25), Math.floor(blockSize * 0.75)]
    : [0];
  const samplesPerBlock = representativeCells.length * representativeCells.length;
  const blockIndex = Math.floor(sampleIndex / samplesPerBlock);
  const localIndex = sampleIndex % samplesPerBlock;
  const blockX = blockIndex % blocksPerAxis;
  const blockZ = Math.floor(blockIndex / blocksPerAxis);
  return {
    sx: blockX * blockSize + representativeCells[localIndex % representativeCells.length]!,
    sz: blockZ * blockSize + representativeCells[Math.floor(localIndex / representativeCells.length)]!,
  };
}

function sampleCell(build: FarSummaryTileBuildState, idx: number): FarSummarySample {
  const { ringConfig, terrainSampler } = build.input;
  const { cellM, tileCells } = ringConfig;
  const sx = idx % tileCells;
  const sz = Math.floor(idx / tileCells);
  const wx = build.originX + (sx + 0.5) * cellM;
  const wz = build.originZ + (sz + 0.5) * cellM;

  const height = heightAt(build.heightGrid, sx, sz);
  if (Number.isNaN(height)) {
    console.warn(`[far-summary] NaN height at (${wx}, ${wz})`);
  }

  const heightValid = Number.isFinite(height);
  const sampleH = heightValid ? height : 0;
  const hLeft = heightAt(build.heightGrid, sx - 1, sz);
  const hRight = heightAt(build.heightGrid, sx + 1, sz);
  const hDown = heightAt(build.heightGrid, sx, sz - 1);
  const hUp = heightAt(build.heightGrid, sx, sz + 1);
  const hMin = finiteMin([height, hLeft, hRight, hDown, hUp], sampleH);
  const hMax = finiteMax([height, hLeft, hRight, hDown, hUp], sampleH);

  const [nx, ny, nz] = normalFromHeights(hLeft, hRight, hDown, hUp, cellM);
  const slope = Math.acos(clamp01(ny));
  const material = terrainSampler.sampleMaterial?.(wx, wz) ?? 0;
  const canopySummary = terrainSampler.sampleCanopySummary?.(
    build.originX + sx * cellM,
    build.originZ + sz * cellM,
    cellM,
  );
  const canopy = canopySummary?.coverage ?? terrainSampler.sampleCanopyCoverage?.(wx, wz) ?? 0;
  const waterHeight = Number.isFinite(hMax) ? hMax : sampleH;
  const waterSummary = heightValid ? terrainSampler.sampleWaterSummary?.(wx, wz, cellM) : undefined;
  const water = waterSummary?.coverage ?? (heightValid
    ? terrainSampler.sampleWaterCoverageForHeight?.(wx, wz, waterHeight) ?? terrainSampler.sampleWaterCoverage?.(wx, wz) ?? 0
    : 0);
  const roughness = computeRoughnessFromGrid(build.heightGrid, sx, sz);

  if (heightValid) {
    build.globalMin = Math.min(build.globalMin, height);
    build.globalMax = Math.max(build.globalMax, height);
    build.globalSum += height;
    build.validSamples++;
  }

  return {
    heightMin: hMin,
    heightMax: hMax,
    heightAvg: heightValid ? sampleH : Number.POSITIVE_INFINITY,
    normalX: nx,
    normalY: ny,
    normalZ: nz,
    dominantMaterial: Math.max(0, Math.round(material)),
    materialVariance: 0,
    // Canopy-over-water is masked during unified enrichment (`farSummaryCanopyWaterBlocked`), which
    // is neighbourhood-aware and reads the tile's enriched water field. Masking again here, off a
    // single raw water sample, would contradict the channel-mapping tests on both sides.
    canopyCoverage: clamp01(canopy),
    waterCoverage: clamp01(water),
    waterLevel: finiteOr(waterSummary?.waterLevel, sampleH),
    bodyKind: finiteOr(waterSummary?.bodyKind, 0),
    shoreDistance: finiteOr(waterSummary?.shoreDistance, 0),
    flowX: finiteOr(waterSummary?.flowX, 0),
    flowZ: finiteOr(waterSummary?.flowZ, 0),
    canopyHeightAvg: finiteOr(canopySummary?.canopyHeightAvg, sampleH),
    speciesPine: clamp01(canopySummary?.speciesPine ?? 0),
    speciesBroadleaf: clamp01(canopySummary?.speciesBroadleaf ?? 0),
    speciesDeadwood: clamp01(canopySummary?.speciesDeadwood ?? 0),
    structureCoverage: clamp01(terrainSampler.sampleStructureCoverage?.(wx, wz, cellM) ?? 0),
    caveEntranceCoverage: sampleCaveEntranceCoverage(
      build.originX + sx * cellM,
      build.originZ + sz * cellM,
      cellM,
    ),
    occluderHeight: 0,
    slope: Number.isFinite(slope) ? slope : 0,
    roughness,
  };
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function computeRoughnessFromGrid(grid: HeightGrid, cx: number, cz: number): number {
  const center = heightAt(grid, cx, cz);
  if (!Number.isFinite(center)) return 0;

  let sumSq = 0;
  let count = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      const value = heightAt(grid, cx + dx, cz + dz);
      if (Number.isFinite(value)) {
        const diff = value - center;
        sumSq += diff * diff;
        count++;
      }
    }
  }
  return count > 0 ? Math.sqrt(sumSq / count) : 0;
}

function fallbackSample(height: number): FarSummarySample {
  return {
    heightMin: height,
    heightMax: height,
    heightAvg: height,
    normalX: 0,
    normalY: 1,
    normalZ: 0,
    dominantMaterial: 0,
    materialVariance: 0,
    canopyCoverage: 0,
    waterCoverage: 0,
    waterLevel: height,
    bodyKind: 0,
    shoreDistance: 0,
    flowX: 0,
    flowZ: 0,
    canopyHeightAvg: height,
    speciesPine: 0,
    speciesBroadleaf: 0,
    speciesDeadwood: 0,
    structureCoverage: 0,
    caveEntranceCoverage: 0,
    occluderHeight: 0,
    slope: 0,
    roughness: 0,
  };
}
