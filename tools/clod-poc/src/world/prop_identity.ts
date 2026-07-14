import { tileKeyString, tileOriginM, type WorldTileKey, WORLD_TILE_SIZE_M } from "./tile_key.js";

export type EnvironmentalPropLayer = "tree" | "stone" | "grass";

export interface PropCandidateAddress {
  readonly tileKey: WorldTileKey;
  readonly layer: EnvironmentalPropLayer;
  readonly candidateIndex: number;
}

export interface EnumeratedPropCandidate extends PropCandidateAddress {
  readonly worldX: number;
  readonly worldZ: number;
}

function assertCandidateIndex(candidateIndex: number): void {
  if (!Number.isSafeInteger(candidateIndex) || candidateIndex < 0) {
    throw new Error(`candidateIndex must be a non-negative safe integer: ${candidateIndex}`);
  }
}

/** Stable FNV-1a 64-bit identity. The textual form is JSON-safe and portable across sessions. */
export function deriveEnvironmentalPropId(
  worldId: string,
  address: PropCandidateAddress,
): string {
  if (!worldId) throw new Error("worldId is required");
  assertCandidateIndex(address.candidateIndex);
  const bytes = new TextEncoder().encode(
    `${worldId}\u001f${tileKeyString(address.tileKey)}\u001f${address.layer}\u001f${address.candidateIndex}`,
  );
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `env_${hash.toString(16).padStart(16, "0")}`;
}

function enumerateGridCandidates(
  tileKey: WorldTileKey,
  layer: EnvironmentalPropLayer,
  spacingM: number,
): EnumeratedPropCandidate[] {
  if (!Number.isFinite(spacingM) || spacingM <= 0) throw new Error("candidate spacing must be positive");
  const cells = Math.ceil(WORLD_TILE_SIZE_M / spacingM);
  const origin = tileOriginM(tileKey);
  const candidates: EnumeratedPropCandidate[] = [];
  for (let z = 0; z < cells; z++) {
    for (let x = 0; x < cells; x++) {
      candidates.push({
        tileKey,
        layer,
        candidateIndex: z * cells + x,
        worldX: origin.x + Math.min(WORLD_TILE_SIZE_M - Number.EPSILON, (x + 0.5) * spacingM),
        worldZ: origin.z + Math.min(WORLD_TILE_SIZE_M - Number.EPSILON, (z + 0.5) * spacingM),
      });
    }
  }
  return candidates;
}

/** Row-major world-cell enumeration used by deterministic tree distribution. */
export function enumerateTreeCandidatesForTile(tileKey: WorldTileKey, cellSizeM = 8): EnumeratedPropCandidate[] {
  return enumerateGridCandidates(tileKey, "tree", cellSizeM);
}

/** Row-major ring-cell enumeration shared by CPU/GPU stone scatter. */
export function enumerateStoneCandidatesForTile(tileKey: WorldTileKey, cellSizeM: number): EnumeratedPropCandidate[] {
  return enumerateGridCandidates(tileKey, "stone", cellSizeM);
}

export function candidateAddressForWorldPosition(
  layer: EnvironmentalPropLayer,
  worldX: number,
  worldZ: number,
  spacingM: number,
): PropCandidateAddress {
  if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) throw new Error("candidate position must be finite");
  if (!Number.isFinite(spacingM) || spacingM <= 0) throw new Error("candidate spacing must be positive");
  const tileKey = Object.freeze({
    x: Math.floor(worldX / WORLD_TILE_SIZE_M),
    z: Math.floor(worldZ / WORLD_TILE_SIZE_M),
  });
  const origin = tileOriginM(tileKey);
  const cells = Math.ceil(WORLD_TILE_SIZE_M / spacingM);
  const x = Math.min(cells - 1, Math.max(0, Math.floor((worldX - origin.x) / spacingM)));
  const z = Math.min(cells - 1, Math.max(0, Math.floor((worldZ - origin.z) / spacingM)));
  return { tileKey, layer, candidateIndex: z * cells + x };
}

export function environmentalPropIdAtWorldPosition(
  worldId: string,
  layer: EnvironmentalPropLayer,
  worldX: number,
  worldZ: number,
  spacingM: number,
): { readonly propId: string; readonly address: PropCandidateAddress } {
  const address = candidateAddressForWorldPosition(layer, worldX, worldZ, spacingM);
  return { propId: deriveEnvironmentalPropId(worldId, address), address };
}
