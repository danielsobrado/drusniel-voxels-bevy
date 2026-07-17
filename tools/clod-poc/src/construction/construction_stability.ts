import type {
  ConstructionMaterial,
  ConstructionPieceDef,
  ConstructionStabilityConfig,
  ConstructionSupportClass,
  ConstructionSupportProfile,
  ConstructionSupportProfiles,
  ConstructionVec3,
  PlacedConstructionPiece,
} from "./types.js";

const SUPPORT_CLASS_RANK: Readonly<Record<ConstructionSupportClass, number>> = {
  wood: 0,
  stone: 1,
  ground: 2,
};

export interface ConstructionStabilityNode {
  id: string;
  position: ConstructionVec3;
  profile: ConstructionSupportProfile;
  grounded: boolean;
}

export interface ConstructionStabilitySolveResult {
  values: ReadonlyMap<string, number>;
  relaxations: number;
}

interface SupportQueueEntry {
  id: string;
  support: number;
}

class MaxSupportHeap {
  private readonly entries: SupportQueueEntry[] = [];

  push(entry: SupportQueueEntry): void {
    this.entries.push(entry);
    let index = this.entries.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(this.entries[parent]!, entry) >= 0) break;
      this.entries[index] = this.entries[parent]!;
      index = parent;
    }
    this.entries[index] = entry;
  }

  pop(): SupportQueueEntry | null {
    if (this.entries.length === 0) return null;
    const root = this.entries[0]!;
    const tail = this.entries.pop()!;
    if (this.entries.length === 0) return root;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.entries.length) break;
      let child = left;
      if (right < this.entries.length && this.compare(this.entries[right]!, this.entries[left]!) > 0) child = right;
      if (this.compare(tail, this.entries[child]!) >= 0) break;
      this.entries[index] = this.entries[child]!;
      index = child;
    }
    this.entries[index] = tail;
    return root;
  }

  private compare(a: SupportQueueEntry, b: SupportQueueEntry): number {
    const supportOrder = a.support - b.support;
    return supportOrder !== 0 ? supportOrder : b.id.localeCompare(a.id);
  }
}

export function constructionSupportProfile(
  piece: ConstructionPieceDef,
  material: ConstructionMaterial,
  profiles: ConstructionSupportProfiles,
): ConstructionSupportProfile {
  return piece.supportProfile ?? profiles[material];
}

export function constructionConnectionIsVertical(
  sourcePosition: ConstructionVec3,
  targetPosition: ConstructionVec3,
  minVerticalRatio: number,
): boolean {
  const dx = targetPosition[0] - sourcePosition[0];
  const dy = targetPosition[1] - sourcePosition[1];
  const dz = targetPosition[2] - sourcePosition[2];
  const length = Math.hypot(dx, dy, dz);
  return length <= 0.000001 || Math.abs(dy) / length >= minVerticalRatio;
}

export function propagatedConstructionSupport(
  sourceValue: number,
  source: ConstructionSupportProfile,
  target: ConstructionSupportProfile,
  vertical: boolean,
): number {
  if (sourceValue <= 0 || SUPPORT_CLASS_RANK[source.supportClass] < SUPPORT_CLASS_RANK[target.supportClass]) return 0;
  if (SUPPORT_CLASS_RANK[source.supportClass] > SUPPORT_CLASS_RANK[target.supportClass]) return target.maxSupport;
  const decay = vertical ? source.verticalDecay : source.horizontalDecay;
  return Math.min(target.maxSupport, Math.max(0, sourceValue - decay));
}

export function solveConstructionStability(
  nodes: ReadonlyMap<string, ConstructionStabilityNode>,
  neighbors: (id: string) => readonly string[],
  config: Pick<ConstructionStabilityConfig, "epsilon" | "verticalConnectionMinRatio">,
): ConstructionStabilitySolveResult {
  const values = new Map<string, number>();
  const queue = new MaxSupportHeap();
  for (const [id, node] of nodes) {
    const value = node.grounded ? node.profile.maxSupport : 0;
    values.set(id, value);
    if (node.grounded) queue.push({ id, support: value });
  }

  let relaxations = 0;
  for (let entry = queue.pop(); entry; entry = queue.pop()) {
    const current = values.get(entry.id) ?? 0;
    if (entry.support + config.epsilon < current) continue;
    const source = nodes.get(entry.id);
    if (!source) continue;
    for (const neighborId of neighbors(entry.id)) {
      const target = nodes.get(neighborId);
      if (!target) continue;
      const candidate = propagatedConstructionSupport(
        entry.support,
        source.profile,
        target.profile,
        constructionConnectionIsVertical(source.position, target.position, config.verticalConnectionMinRatio),
      );
      const previous = values.get(neighborId) ?? 0;
      if (candidate <= previous + config.epsilon) continue;
      values.set(neighborId, candidate);
      queue.push({ id: neighborId, support: candidate });
      relaxations += 1;
    }
  }
  return { values, relaxations };
}

export function placedConstructionStability(
  placed: PlacedConstructionPiece,
  profile: ConstructionSupportProfile,
): number {
  if (Number.isFinite(placed.stability)) return Math.max(0, Math.min(profile.maxSupport, placed.stability!));
  return placed.grounded === true ? profile.maxSupport : 0;
}

export interface PredictConstructionStabilityInput {
  grounded: boolean;
  position: ConstructionVec3;
  targetProfile: ConstructionSupportProfile;
  connectionIds: readonly string[];
  placedById: ReadonlyMap<string, PlacedConstructionPiece>;
  piecesById: ReadonlyMap<string, ConstructionPieceDef>;
  supportProfiles: ConstructionSupportProfiles;
  config: Pick<ConstructionStabilityConfig, "verticalConnectionMinRatio">;
}

export function predictConstructionStability(input: PredictConstructionStabilityInput): number {
  if (input.grounded) return input.targetProfile.maxSupport;
  let best = 0;
  for (const connectionId of input.connectionIds) {
    const sourcePlaced = input.placedById.get(connectionId);
    if (!sourcePlaced) continue;
    const sourcePiece = input.piecesById.get(sourcePlaced.typeId);
    if (!sourcePiece) continue;
    const sourceMaterial = sourcePlaced.material ?? sourcePiece.material;
    const sourceProfile = constructionSupportProfile(sourcePiece, sourceMaterial, input.supportProfiles);
    const candidate = propagatedConstructionSupport(
      placedConstructionStability(sourcePlaced, sourceProfile),
      sourceProfile,
      input.targetProfile,
      constructionConnectionIsVertical(sourcePlaced.position, input.position, input.config.verticalConnectionMinRatio),
    );
    best = Math.max(best, candidate);
  }
  return best;
}

export function shouldCollapseConstruction(
  stability: number,
  grounded: boolean,
  config: Pick<ConstructionStabilityConfig, "collapseThreshold" | "epsilon">,
): boolean {
  return !grounded && stability + config.epsilon < config.collapseThreshold;
}

export function constructionStabilityColorHex(
  stability: number,
  maxSupport: number,
  grounded: boolean,
  collapseThreshold: number,
): number {
  if (grounded) return 0x3380ff;
  const ratio = maxSupport > 0 ? stability / maxSupport : 0;
  if (ratio >= 0.67) return 0x35d46b;
  if (ratio >= 0.40) return 0xf2d83d;
  if (ratio >= collapseThreshold) return 0xff8a1f;
  return 0xff3d3d;
}
