import {
  DEFAULT_HYDROLOGY_GRAPH_CONFIG,
  HYDROLOGY_GRAPH_VERSION,
  type BuildHydrologyGraphInput,
  type HydrologyGraph,
  type HydrologyGraphConfig,
  type HydrologyLakeRecord,
  type HydrologyMacroSampleCheckpoint,
  type HydrologyRiverRecord,
  type HydrologyTerminalKind,
} from "./hydrology_graph.js";

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

interface HeapEntry { readonly index: number; readonly height: number }

class MinHeap {
  private readonly values: HeapEntry[] = [];

  get length(): number { return this.values.length; }

  push(value: HeapEntry): void {
    const values = this.values;
    let at = values.length;
    values.push(value);
    while (at > 0) {
      const parent = (at - 1) >>> 1;
      if (compareHeap(values[parent]!, value) <= 0) break;
      values[at] = values[parent]!;
      at = parent;
    }
    values[at] = value;
  }

  pop(): HeapEntry {
    const values = this.values;
    const root = values[0]!;
    const tail = values.pop()!;
    if (values.length === 0) return root;
    let at = 0;
    while (true) {
      const left = at * 2 + 1;
      if (left >= values.length) break;
      const right = left + 1;
      const child = right < values.length && compareHeap(values[right]!, values[left]!) < 0 ? right : left;
      if (compareHeap(values[child]!, tail) >= 0) break;
      values[at] = values[child]!;
      at = child;
    }
    values[at] = tail;
    return root;
  }
}

function compareHeap(a: HeapEntry, b: HeapEntry): number {
  return a.height - b.height || a.index - b.index;
}

function resolveConfig(input?: Partial<HydrologyGraphConfig>): HydrologyGraphConfig {
  const config = { ...DEFAULT_HYDROLOGY_GRAPH_CONFIG, ...input };
  if (!Number.isFinite(config.spacingM) || config.spacingM <= 0) throw new Error("hydrology graph spacingM must be positive");
  if (!Number.isFinite(config.channelThresholdCells) || config.channelThresholdCells < 1) {
    throw new Error("hydrology graph channelThresholdCells must be at least 1");
  }
  if (!Number.isFinite(config.lakeMinDepthM) || config.lakeMinDepthM < 0) {
    throw new Error("hydrology graph lakeMinDepthM must be non-negative");
  }
  return Object.freeze(config);
}

function stableId(prefix: string, worldId: string, cell: number): string {
  let hash = 2166136261;
  const text = `${worldId}:${cell}`;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function forEachNeighbor(index: number, resX: number, resZ: number, visit: (neighbor: number) => void): void {
  const x = index % resX;
  const z = (index - x) / resX;
  for (const [dx, dz] of NEIGHBORS) {
    const nx = x + dx;
    const nz = z + dz;
    if (nx >= 0 && nz >= 0 && nx < resX && nz < resZ) visit(nz * resX + nx);
  }
}

function isBorder(index: number, resX: number, resZ: number): boolean {
  const x = index % resX;
  const z = (index - x) / resX;
  return x === 0 || z === 0 || x === resX - 1 || z === resZ - 1;
}

function priorityFlood(original: Float32Array, resX: number, resZ: number): {
  filled: Float32Array;
  floodParent: Int32Array;
} {
  const filled = new Float32Array(original);
  const floodParent = new Int32Array(original.length);
  floodParent.fill(-1);
  const visited = new Uint8Array(original.length);
  const heap = new MinHeap();
  for (let index = 0; index < original.length; index++) {
    if (!isBorder(index, resX, resZ)) continue;
    visited[index] = 1;
    heap.push({ index, height: filled[index]! });
  }
  while (heap.length > 0) {
    const current = heap.pop();
    forEachNeighbor(current.index, resX, resZ, (neighbor) => {
      if (visited[neighbor]) return;
      visited[neighbor] = 1;
      floodParent[neighbor] = current.index;
      filled[neighbor] = Math.max(original[neighbor]!, current.height);
      heap.push({ index: neighbor, height: filled[neighbor]! });
    });
  }
  return { filled, floodParent };
}

function buildDownstream(
  filled: Float32Array,
  floodParent: Int32Array,
  resX: number,
  resZ: number,
): Int32Array {
  const downstream = new Int32Array(filled.length);
  downstream.fill(-1);
  for (let index = 0; index < filled.length; index++) {
    if (isBorder(index, resX, resZ)) continue;
    let best = -1;
    let bestHeight = filled[index]!;
    forEachNeighbor(index, resX, resZ, (neighbor) => {
      const height = filled[neighbor]!;
      if (height < bestHeight || (height === bestHeight && best >= 0 && neighbor < best)) {
        best = neighbor;
        bestHeight = height;
      }
    });
    downstream[index] = best >= 0 ? best : floodParent[index]!;
  }
  return downstream;
}

function accumulateFlow(downstream: Int32Array): Float32Array {
  const count = downstream.length;
  const indegree = new Int32Array(count);
  const accumulation = new Float32Array(count);
  accumulation.fill(1);
  for (let index = 0; index < count; index++) {
    const next = downstream[index]!;
    if (next >= 0) indegree[next]++;
  }
  const queue = new Int32Array(count);
  let head = 0;
  let tail = 0;
  for (let index = 0; index < count; index++) if (indegree[index] === 0) queue[tail++] = index;
  while (head < tail) {
    const index = queue[head++]!;
    const next = downstream[index]!;
    if (next < 0) continue;
    accumulation[next] += accumulation[index]!;
    if (--indegree[next] === 0) queue[tail++] = next;
  }
  if (tail !== count) throw new Error(`hydrology graph contains a downstream cycle (${count - tail} cells)`);
  return accumulation;
}

function extractLakes(
  worldId: string,
  original: Float32Array,
  filled: Float32Array,
  downstream: Int32Array,
  resX: number,
  resZ: number,
  minDepthM: number,
): { lakes: HydrologyLakeRecord[]; lakeIndex: Int32Array } {
  const lakeIndex = new Int32Array(original.length);
  lakeIndex.fill(-1);
  const lakes: HydrologyLakeRecord[] = [];
  const stack = new Int32Array(original.length);
  for (let start = 0; start < original.length; start++) {
    if (lakeIndex[start] !== -1 || filled[start]! - original[start]! <= minDepthM) continue;
    const memberIndex = lakes.length;
    let top = 0;
    stack[top++] = start;
    lakeIndex[start] = memberIndex;
    const members: number[] = [];
    let maxDepthM = 0;
    let levelM = Number.NEGATIVE_INFINITY;
    while (top > 0) {
      const index = stack[--top]!;
      members.push(index);
      maxDepthM = Math.max(maxDepthM, filled[index]! - original[index]!);
      levelM = Math.max(levelM, filled[index]!);
      forEachNeighbor(index, resX, resZ, (neighbor) => {
        if (lakeIndex[neighbor] !== -1 || filled[neighbor]! - original[neighbor]! <= minDepthM) return;
        lakeIndex[neighbor] = memberIndex;
        stack[top++] = neighbor;
      });
    }
    let spillCell = members[0]!;
    let outletCell = -1;
    for (const index of members) {
      const next = downstream[index]!;
      if (next < 0 || lakeIndex[next] !== memberIndex) {
        if (filled[index]! < filled[spillCell]! || (filled[index] === filled[spillCell] && index < spillCell)) {
          spillCell = index;
          outletCell = next;
        }
      }
    }
    if (outletCell < 0) outletCell = downstream[spillCell]!;
    lakes.push(Object.freeze({
      id: stableId("lake", worldId, spillCell),
      spillCell,
      outletCell,
      terminal: outletCell < 0,
      levelM,
      areaCells: members.length,
      maxDepthM,
    }));
  }
  return { lakes, lakeIndex };
}

function terminalFor(
  cell: number,
  channel: Uint8Array,
  downstream: Int32Array,
  lakeIndex: Int32Array,
  lakes: readonly HydrologyLakeRecord[],
  resX: number,
  resZ: number,
): { kind: HydrologyTerminalKind; lakeId?: string } {
  const lake = cell >= 0 ? lakeIndex[cell]! : -1;
  if (lake >= 0) return { kind: "lake", lakeId: lakes[lake]!.id };
  if (cell < 0 || isBorder(cell, resX, resZ)) return { kind: "ocean" };
  if (channel[cell]) return { kind: "river" };
  let cursor = cell;
  for (let steps = 0; steps < downstream.length; steps++) {
    const nextLake = lakeIndex[cursor]!;
    if (nextLake >= 0) return { kind: "lake", lakeId: lakes[nextLake]!.id };
    if (isBorder(cursor, resX, resZ)) return { kind: "ocean" };
    cursor = downstream[cursor]!;
    if (cursor < 0) return { kind: "terminal" };
  }
  return { kind: "terminal" };
}

function extractRivers(
  worldId: string,
  original: Float32Array,
  filled: Float32Array,
  downstream: Int32Array,
  accumulation: Float32Array,
  lakeIndex: Int32Array,
  lakes: readonly HydrologyLakeRecord[],
  resX: number,
  resZ: number,
  originX: number,
  originZ: number,
  config: HydrologyGraphConfig,
): HydrologyRiverRecord[] {
  const channel = new Uint8Array(original.length);
  const upstreamChannels = new Uint8Array(original.length);
  for (let index = 0; index < original.length; index++) {
    if (lakeIndex[index] < 0 && accumulation[index]! >= config.channelThresholdCells) channel[index] = 1;
  }
  for (let index = 0; index < channel.length; index++) {
    const next = downstream[index]!;
    if (channel[index] && next >= 0 && channel[next]) upstreamChannels[next]++;
  }
  const rivers: HydrologyRiverRecord[] = [];
  for (let source = 0; source < channel.length; source++) {
    if (!channel[source] || upstreamChannels[source] === 1) continue;
    const cells: number[] = [source];
    let cursor = source;
    for (let steps = 0; steps < downstream.length; steps++) {
      const next = downstream[cursor]!;
      if (next < 0 || !channel[next]) {
        cursor = next;
        break;
      }
      cells.push(next);
      cursor = next;
      if (upstreamChannels[next] !== 1) break;
    }
    const terminal = terminalFor(cursor, channel, downstream, lakeIndex, lakes, resX, resZ);
    const vertices = cells.map((cell) => {
      const xCell = cell % resX;
      const zCell = (cell - xCell) / resX;
      const discharge = accumulation[cell]!;
      return Object.freeze({
        cell,
        x: originX + xCell * config.spacingM,
        z: originZ + zCell * config.spacingM,
        bedY: original[cell]!,
        waterY: filled[cell]!,
        discharge,
        widthM: config.riverBaseWidthM + Math.sqrt(discharge) * config.riverWidthScaleM,
      });
    });
    rivers.push(Object.freeze({
      id: stableId("river", worldId, source),
      sourceCell: source,
      downstreamCell: cursor,
      terminalKind: terminal.kind,
      ...(terminal.kind === "river" ? { downstreamRiverId: stableId("river", worldId, cursor) } : {}),
      ...(terminal.lakeId ? { terminalLakeId: terminal.lakeId } : {}),
      vertices: Object.freeze(vertices),
    }));
  }
  return rivers;
}

export function createHydrologyMacroSampleCheckpoint(
  input: Pick<BuildHydrologyGraphInput, "sizeM" | "originM" | "config">,
): HydrologyMacroSampleCheckpoint {
  const config = resolveConfig(input.config);
  if (input.sizeM.x <= 0 || input.sizeM.z <= 0) throw new Error("hydrology graph bounds must be positive");
  const resX = Math.floor(input.sizeM.x / config.spacingM) + 1;
  const resZ = Math.floor(input.sizeM.z / config.spacingM) + 1;
  const origin = input.originM ?? { x: 0, z: 0 };
  return {
    resX,
    resZ,
    sizeM: Object.freeze({ x: input.sizeM.x, z: input.sizeM.z }),
    originM: Object.freeze({ x: origin.x, z: origin.z }),
    spacingM: config.spacingM,
    originalHeight: new Float32Array(resX * resZ),
    nextRow: 0,
  };
}

export function sampleHydrologyMacroRows(
  checkpoint: HydrologyMacroSampleCheckpoint,
  sampleHeight: (x: number, z: number) => number,
  maxRows: number,
): boolean {
  const endRow = Math.min(checkpoint.resZ, checkpoint.nextRow + Math.max(1, Math.floor(maxRows)));
  for (let z = checkpoint.nextRow; z < endRow; z++) {
    for (let x = 0; x < checkpoint.resX; x++) {
      const height = sampleHeight(
        checkpoint.originM.x + x * checkpoint.spacingM,
        checkpoint.originM.z + z * checkpoint.spacingM,
      );
      if (!Number.isFinite(height)) throw new Error(`hydrology graph sampler returned ${height} at ${x},${z}`);
      checkpoint.originalHeight[z * checkpoint.resX + x] = height;
    }
  }
  checkpoint.nextRow = endRow;
  return checkpoint.nextRow >= checkpoint.resZ;
}

export function buildHydrologyGraphFromMacro(
  input: Omit<BuildHydrologyGraphInput, "sampleHeight">,
  checkpoint: HydrologyMacroSampleCheckpoint,
): HydrologyGraph {
  const config = resolveConfig(input.config);
  if (!input.worldId) throw new Error("hydrology graph worldId is required");
  if (checkpoint.nextRow !== checkpoint.resZ) throw new Error("hydrology macro sample is incomplete");
  if (checkpoint.spacingM !== config.spacingM) throw new Error("hydrology macro sample spacing does not match config");
  const { resX, resZ, originalHeight } = checkpoint;
  const origin = checkpoint.originM;
  const { filled, floodParent } = priorityFlood(originalHeight, resX, resZ);
  const downstream = buildDownstream(filled, floodParent, resX, resZ);
  const accumulation = accumulateFlow(downstream);
  const { lakes, lakeIndex } = extractLakes(
    input.worldId, originalHeight, filled, downstream, resX, resZ, config.lakeMinDepthM,
  );
  const rivers = extractRivers(
    input.worldId, originalHeight, filled, downstream, accumulation, lakeIndex, lakes,
    resX, resZ, origin.x, origin.z, config,
  );
  return Object.freeze({
    version: HYDROLOGY_GRAPH_VERSION,
    worldId: input.worldId,
    seed: input.seed,
    config,
    macro: Object.freeze({
      resX,
      resZ,
      sizeM: checkpoint.sizeM,
      originM: Object.freeze({ x: origin.x, z: origin.z }),
      spacingM: config.spacingM,
      lakeIndex,
      buildFields: Object.freeze({
        originalHeight,
        filledHeight: filled,
        downstream,
        accumulation,
      }),
    }),
    rivers: Object.freeze(rivers),
    lakes: Object.freeze(lakes),
  });
}

export function buildHydrologyGraph(input: BuildHydrologyGraphInput): HydrologyGraph {
  const checkpoint = createHydrologyMacroSampleCheckpoint(input);
  sampleHydrologyMacroRows(checkpoint, input.sampleHeight, checkpoint.resZ);
  return buildHydrologyGraphFromMacro(input, checkpoint);
}
