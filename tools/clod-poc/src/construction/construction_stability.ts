import type { ConstructionSupportGraph } from "./construction_support_graph.js";
import type {
  ConstructionConnectionKind,
  ConstructionStabilityConfig,
  ConstructionStabilityPrediction,
  ConstructionSupportClass,
  ConstructionSupportProfile,
  ConstructionVec3,
  PlacedConstructionPiece,
} from "./types.js";

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

interface QueueEntry {
  id: string;
  support: number;
}

const SUPPORT_CLASS_RANK: Readonly<Record<ConstructionSupportClass, number>> = {
  wood: 0,
  stone: 1,
  ground: 2,
};

class MaxSupportHeap {
  private readonly entries: QueueEntry[] = [];

  push(entry: QueueEntry): void {
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

  pop(): QueueEntry | null {
    if (this.entries.length === 0) return null;
    const result = this.entries[0]!;
    const last = this.entries.pop()!;
    if (this.entries.length === 0) return result;

    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.entries.length) break;
      const best = right < this.entries.length && this.compare(this.entries[right]!, this.entries[left]!) > 0
        ? right
        : left;
      if (this.compare(this.entries[best]!, last) <= 0) break;
      this.entries[index] = this.entries[best]!;
      index = best;
    }
    this.entries[index] = last;
    return result;
  }

  private compare(a: QueueEntry, b: QueueEntry): number {
    return a.support - b.support || b.id.localeCompare(a.id);
  }
}

export function constructionConnectionKind(
  source: ConstructionVec3,
  target: ConstructionVec3,
): ConstructionConnectionKind {
  const dy = Math.abs(target[1] - source[1]);
  const horizontal = Math.hypot(target[0] - source[0], target[2] - source[2]);
  return dy >= horizontal * 0.75 ? "vertical" : "horizontal";
}

export function propagatedConstructionSupport(
  sourceValue: number,
  source: ConstructionSupportProfile,
  target: ConstructionSupportProfile,
  connection: ConstructionConnectionKind,
): number {
  if (sourceValue <= 0 || SUPPORT_CLASS_RANK[source.supportClass] < SUPPORT_CLASS_RANK[target.supportClass]) return 0;
  if (SUPPORT_CLASS_RANK[source.supportClass] > SUPPORT_CLASS_RANK[target.supportClass]) return target.maxSupport;
  const decay = connection === "vertical" ? source.verticalDecay : source.horizontalDecay;
  return Math.min(target.maxSupport, Math.max(0, sourceValue - decay));
}

export function solveConstructionStabilityIsland(
  nodes: ReadonlyMap<string, ConstructionStabilityNode>,
  graph: ConstructionSupportGraph,
  epsilon: number,
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
    if (entry.support + epsilon < (values.get(entry.id) ?? 0)) continue;
    const source = nodes.get(entry.id);
    if (!source) continue;
    for (const neighborId of graph.neighbors(entry.id)) {
      const target = nodes.get(neighborId);
      if (!target) continue;
      const candidate = propagatedConstructionSupport(
        entry.support,
        source.profile,
        target.profile,
        constructionConnectionKind(source.position, target.position),
      );
      if (candidate <= (values.get(neighborId) ?? 0) + epsilon) continue;
      values.set(neighborId, candidate);
      queue.push({ id: neighborId, support: candidate });
      relaxations += 1;
    }
  }
  return { values, relaxations };
}

export function predictConstructionStability(input: {
  grounded: boolean;
  position: ConstructionVec3;
  targetProfile: ConstructionSupportProfile;
  connectedPieces: readonly PlacedConstructionPiece[];
  profileForPiece: (piece: PlacedConstructionPiece) => ConstructionSupportProfile;
  config: ConstructionStabilityConfig;
}): ConstructionStabilityPrediction {
  const maxSupport = input.targetProfile.maxSupport;
  let value = input.grounded ? maxSupport : 0;
  for (const sourcePiece of input.connectedPieces) {
    const sourceValue = sourcePiece.grounded === true
      ? input.profileForPiece(sourcePiece).maxSupport
      : sourcePiece.stability ?? 0;
    value = Math.max(value, propagatedConstructionSupport(
      sourceValue,
      input.profileForPiece(sourcePiece),
      input.targetProfile,
      constructionConnectionKind(sourcePiece.position, input.position),
    ));
  }
  const supported = input.grounded || value + input.config.epsilon >= input.config.collapseThreshold;
  return {
    supported,
    grounded: input.grounded,
    value,
    maxSupport,
    ratio: maxSupport > 0 ? value / maxSupport : 0,
    connectionIds: input.connectedPieces.map((piece) => piece.id).sort(),
    reason: supported ? null : "insufficient stability",
  };
}

export function shouldConstructionCollapse(
  piece: Pick<PlacedConstructionPiece, "grounded" | "stability">,
  config: ConstructionStabilityConfig,
): boolean {
  return piece.grounded !== true && (piece.stability ?? 0) + config.epsilon < config.collapseThreshold;
}
