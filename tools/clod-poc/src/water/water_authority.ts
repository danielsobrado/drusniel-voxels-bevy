import {
  HYDROLOGY_BODY_DRY,
  HYDROLOGY_BODY_LAKE,
  HYDROLOGY_BODY_MARSH,
  HYDROLOGY_BODY_OCEAN,
  HYDROLOGY_BODY_POND,
  HYDROLOGY_BODY_RIVER,
  sampleHydrologyGrid,
} from "./hydrologyGrid.js";
import type { HydrologySystem } from "./hydrologySystem.js";
import type { WaterConfig } from "./waterConfig.js";
import type { WaterField } from "./waterField.js";

export type WaterSampleState = "dry" | "water" | "unknown";
export type WaterBodyKind = "ocean" | "lake" | "river" | "pond" | "flood";

export interface WaterSample {
  state: WaterSampleState;
  surfaceY: number;
  bottomY?: number;
  bodyId: string;
  bodyKind: WaterBodyKind;
  flow: readonly [number, number];
  sourceRevision: number;
}

export interface WaterAuthoritySource {
  readonly id: string;
  revision(): number;
  sample(x: number, z: number): WaterSample | null;
}

export interface WaterAuthority {
  sample(x: number, z: number): WaterSample;
  readyAt(x: number, z: number): boolean;
  revision(): number;
}

export interface EditedWaterBody {
  id: string;
  kind: WaterBodyKind;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  surfaceY: number;
  bottomY?: number;
  flow?: readonly [number, number];
  /** Dry overlays are authoritative removals/dams and override generated water. */
  state?: "water" | "dry";
  priority?: number;
}

const DEFAULT_BODY_KIND: WaterBodyKind = "pond";
const DRY_BODY_ID = "";
const STILL_FLOW = [0, 0] as const;
const REVISION_MIX_MULTIPLIER = 1_000_003;

function drySample(sourceRevision: number): WaterSample {
  return {
    state: "dry",
    surfaceY: Number.NaN,
    bodyId: DRY_BODY_ID,
    bodyKind: DEFAULT_BODY_KIND,
    flow: STILL_FLOW,
    sourceRevision,
  };
}

function unknownSample(sourceRevision: number): WaterSample {
  return {
    state: "unknown",
    surfaceY: Number.NaN,
    bodyId: DRY_BODY_ID,
    bodyKind: DEFAULT_BODY_KIND,
    flow: STILL_FLOW,
    sourceRevision,
  };
}

function hydrologyBodyKind(kind: number): WaterBodyKind {
  if (kind === HYDROLOGY_BODY_OCEAN) return "ocean";
  if (kind === HYDROLOGY_BODY_LAKE) return "lake";
  if (kind === HYDROLOGY_BODY_RIVER) return "river";
  if (kind === HYDROLOGY_BODY_POND || kind === HYDROLOGY_BODY_MARSH) return "pond";
  return DEFAULT_BODY_KIND;
}

function contains(body: EditedWaterBody, x: number, z: number): boolean {
  return x >= body.minX && x <= body.maxX && z >= body.minZ && z <= body.maxZ;
}

function pointSegmentDistance(
  x: number,
  z: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq > 1e-8
    ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / lengthSq))
    : 0;
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}

function legacyBodyId(config: WaterConfig | undefined, kind: WaterBodyKind, x: number, z: number): string {
  if (!config) return `legacy:${kind}`;
  if (kind === "lake") {
    let selected = -1;
    let selectedMetric = Number.POSITIVE_INFINITY;
    for (let index = 0; index < config.fakeBodies.lakes.length; index += 1) {
      const lake = config.fakeBodies.lakes[index]!;
      const dx = (x - lake.center[0]) / Math.max(0.001, lake.radius[0]);
      const dz = (z - lake.center[1]) / Math.max(0.001, lake.radius[1]);
      const metric = dx * dx + dz * dz;
      if (metric <= 1 && metric < selectedMetric) {
        selected = index;
        selectedMetric = metric;
      }
    }
    return selected >= 0 ? `legacy:lake:${selected}` : "legacy:lake";
  }
  if (kind === "river") {
    let selected = -1;
    let selectedDistance = Number.POSITIVE_INFINITY;
    for (let riverIndex = 0; riverIndex < config.fakeBodies.rivers.length; riverIndex += 1) {
      const river = config.fakeBodies.rivers[riverIndex]!;
      const maxDistance = Math.max(0.05, river.width * 0.5);
      for (let pointIndex = 0; pointIndex < river.points.length - 1; pointIndex += 1) {
        const a = river.points[pointIndex]!;
        const b = river.points[pointIndex + 1]!;
        const distance = pointSegmentDistance(x, z, a[0], a[1], b[0], b[1]);
        if (distance <= maxDistance && distance < selectedDistance) {
          selected = riverIndex;
          selectedDistance = distance;
        }
      }
    }
    return selected >= 0 ? `legacy:river:${selected}` : "legacy:river";
  }
  return `legacy:${kind}`;
}

function hydrologySampleReady(hydrology: HydrologySystem, x: number, z: number): boolean {
  if (x >= 0 && z >= 0 && x <= hydrology.grid.worldCells && z <= hydrology.grid.worldCells) return true;
  const atlas = hydrology.tileAtlasSource();
  // Outside the startup grid, missing atlas means residency is unknown — fail closed.
  if (!atlas) return false;
  const tileX = Math.floor(x / atlas.tileSizeM);
  const tileZ = Math.floor(z / atlas.tileSizeM);
  return atlas.peek(tileX, tileZ) !== null;
}

function compositeRevision(sources: readonly WaterAuthoritySource[]): number {
  if (sources.length === 0) return 0;
  let revision = sources[0]!.revision() >>> 0;
  for (let index = 1; index < sources.length; index += 1) {
    revision = (Math.imul(revision, REVISION_MIX_MULTIPLIER) ^ (sources[index]!.revision() >>> 0)) >>> 0;
  }
  return revision;
}

export class EditedWaterAuthoritySource implements WaterAuthoritySource {
  readonly id = "edited-water";
  private readonly bodies = new Map<string, EditedWaterBody>();
  private sourceRevision = 0;

  revision(): number {
    return this.sourceRevision;
  }

  upsert(body: EditedWaterBody): void {
    if (!body.id.trim()) throw new Error("Edited water body id is required");
    if (![body.minX, body.maxX, body.minZ, body.maxZ, body.surfaceY].every(Number.isFinite)) {
      throw new Error(`Edited water body ${body.id} contains non-finite bounds or surface`);
    }
    if (body.minX > body.maxX || body.minZ > body.maxZ) {
      throw new Error(`Edited water body ${body.id} has inverted bounds`);
    }
    this.bodies.set(body.id, {
      ...body,
      flow: body.flow ? [body.flow[0], body.flow[1]] : STILL_FLOW,
    });
    this.sourceRevision += 1;
  }

  remove(id: string): boolean {
    if (!this.bodies.delete(id)) return false;
    this.sourceRevision += 1;
    return true;
  }

  clear(): void {
    if (this.bodies.size === 0) return;
    this.bodies.clear();
    this.sourceRevision += 1;
  }

  sample(x: number, z: number): WaterSample | null {
    let selected: EditedWaterBody | null = null;
    for (const body of this.bodies.values()) {
      if (!contains(body, x, z)) continue;
      if (!selected
        || (body.priority ?? 0) > (selected.priority ?? 0)
        || ((body.priority ?? 0) === (selected.priority ?? 0) && body.id < selected.id)) {
        selected = body;
      }
    }
    if (!selected) return null;
    if (selected.state === "dry") return drySample(this.sourceRevision);
    return {
      state: "water",
      surfaceY: selected.surfaceY,
      ...(selected.bottomY !== undefined && Number.isFinite(selected.bottomY) ? { bottomY: selected.bottomY } : {}),
      bodyId: `edited:${selected.id}`,
      bodyKind: selected.kind,
      flow: selected.flow ?? STILL_FLOW,
      sourceRevision: this.sourceRevision,
    };
  }
}

export function createHydrologyWaterSource(
  hydrology: HydrologySystem,
  getRevision: () => number = () => 0,
  shoreEpsilonM = 0.05,
): WaterAuthoritySource {
  return {
    id: "hydrology",
    revision: getRevision,
    sample(x, z) {
      const revision = getRevision();
      if (!hydrologySampleReady(hydrology, x, z)) return unknownSample(revision);
      const insideStartup = x >= 0 && z >= 0 && x <= hydrology.grid.worldCells && z <= hydrology.grid.worldCells;
      const sample = insideStartup
        ? sampleHydrologyGrid(hydrology.grid, x, z)
        : hydrology.sample(x, z);
      const wet = sample.bodyKind !== HYDROLOGY_BODY_DRY
        && sample.bodyId !== 0
        && sample.bodyMask > 0.5
        && sample.depth > shoreEpsilonM;
      if (!wet) return drySample(revision);
      const flowLength = Math.hypot(sample.flowX, sample.flowZ);
      const flowScale = flowLength > 1e-8 ? Math.max(0, sample.flowStrength) / flowLength : 0;
      return {
        state: "water",
        surfaceY: sample.waterY,
        bottomY: sample.terrainY,
        bodyId: `hydrology:${sample.bodyId}`,
        bodyKind: hydrologyBodyKind(sample.bodyKind),
        flow: [sample.flowX * flowScale, sample.flowZ * flowScale],
        sourceRevision: revision,
      };
    },
  };
}

export function createLegacyWaterFieldSource(
  field: WaterField,
  getRevision: () => number = () => 0,
  shoreEpsilonM = 0.05,
  config?: WaterConfig,
): WaterAuthoritySource {
  return {
    id: "legacy-water-field",
    revision: getRevision,
    sample(x, z) {
      const revision = getRevision();
      const sample = field.sample(x, z);
      if (sample.bodyKind === HYDROLOGY_BODY_DRY || sample.bodyMask <= 0.5 || sample.depth <= shoreEpsilonM) {
        return drySample(revision);
      }
      const kind = hydrologyBodyKind(sample.bodyKind);
      return {
        state: "water",
        surfaceY: sample.waterY,
        bottomY: sample.terrainY,
        bodyId: legacyBodyId(config, kind, x, z),
        bodyKind: kind,
        flow: [sample.flow.x * sample.flow.speed, sample.flow.z * sample.flow.speed],
        sourceRevision: revision,
      };
    },
  };
}

export function createCanonicalWaterAuthority(
  sources: readonly WaterAuthoritySource[],
): WaterAuthority {
  const ordered = [...sources];
  return {
    sample(x, z) {
      for (const source of ordered) {
        const sample = source.sample(x, z);
        if (sample) return sample;
      }
      return drySample(compositeRevision(ordered));
    },
    readyAt(x, z) {
      return this.sample(x, z).state !== "unknown";
    },
    revision() {
      return compositeRevision(ordered);
    },
  };
}
