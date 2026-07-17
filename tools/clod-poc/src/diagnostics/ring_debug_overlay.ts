import * as THREE from "three";

export type RingDebugKind = "stones" | "understory";
export type RingTelemetryState = "unknown" | "last-known" | "fresh";

export interface RingDebugUpdate {
  centerX: number;
  centerZ: number;
  cellSizeM: number;
  outerRadiusM: number;
  innerRadiusM?: number;
  refreshDistanceM: number;
  candidateGrid?: number;
  acceptedCount?: number;
  telemetryState?: RingTelemetryState;
  classColoring?: boolean;
  lodMode?: string;
  nowMs?: number;
}

export interface RingDebugSnapshot {
  enabled: boolean;
  centerX: number;
  centerZ: number;
  snappedCenterX: number;
  snappedCenterZ: number;
  lastRecenterX: number;
  lastRecenterZ: number;
  staleAgeMs: number;
  candidateSlots: number;
  candidatePointsShown: number;
  acceptedCount: number | null;
  telemetryState: RingTelemetryState;
  lodMode: string;
}

interface RingDebugStyle {
  outerColor: number;
  innerColor: number;
  candidateColor: number;
  centerColor: number;
  recenterColor: number;
}

const CIRCLE_SEGMENTS = 128;
const CROSS_SIZE_M = 4;
const CANDIDATE_POINT_LIMIT = 4096;
const CANDIDATE_Y_M = 0.15;
const DEFAULT_STYLE: Record<RingDebugKind, RingDebugStyle> = {
  stones: {
    outerColor: 0xffa726,
    innerColor: 0xffcc80,
    candidateColor: 0xffb74d,
    centerColor: 0xff1744,
    recenterColor: 0xffffff,
  },
  understory: {
    outerColor: 0x26c6da,
    innerColor: 0x80deea,
    candidateColor: 0x4dd0e1,
    centerColor: 0xff1744,
    recenterColor: 0xffffff,
  },
};

const OVERLAYS = new WeakMap<THREE.Scene, Map<RingDebugKind, RingDebugOverlay>>();

export function getRingDebugOverlay(scene: THREE.Scene, kind: RingDebugKind): RingDebugOverlay {
  let byKind = OVERLAYS.get(scene);
  if (!byKind) {
    byKind = new Map();
    OVERLAYS.set(scene, byKind);
  }
  const existing = byKind.get(kind);
  if (existing) return existing;
  const created = new RingDebugOverlay(scene, kind, DEFAULT_STYLE[kind]);
  byKind.set(kind, created);
  return created;
}

export function ringDebugEnabled(
  kind: RingDebugKind,
  search: string | URLSearchParams | undefined = currentSearchParams(),
): boolean {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(search ?? "");
  if (parseBoolean(params.get("ringDebug"))) return true;
  const key = kind === "stones" ? "stoneRingDebug" : "understoryRingDebug";
  return parseBoolean(params.get(key));
}

export function ringDebugShouldRecenter(
  previousX: number,
  previousZ: number,
  nextX: number,
  nextZ: number,
  refreshDistanceM: number,
): boolean {
  if (!Number.isFinite(previousX) || !Number.isFinite(previousZ)) return true;
  const threshold = Math.max(0.001, finiteOr(refreshDistanceM, 0.001));
  return Math.hypot(nextX - previousX, nextZ - previousZ) >= threshold;
}

export function ringDebugCandidatePositions(params: {
  centerX: number;
  centerZ: number;
  cellSizeM: number;
  grid: number;
  outerRadiusM: number;
  innerRadiusM?: number;
  maxPoints?: number;
}): Float32Array {
  const grid = Math.max(1, Math.floor(params.grid));
  const cell = Math.max(0.001, finiteOr(params.cellSizeM, 1));
  const outer = Math.max(cell, finiteOr(params.outerRadiusM, cell));
  const inner = Math.max(0, Math.min(outer, finiteOr(params.innerRadiusM, 0)));
  const total = grid * grid;
  const maxPoints = Math.max(1, Math.floor(params.maxPoints ?? CANDIDATE_POINT_LIMIT));
  const stride = Math.max(1, Math.ceil(Math.sqrt(total / maxPoints)));
  const centerCellX = params.centerX / cell;
  const centerCellZ = params.centerZ / cell;
  const points: number[] = [];

  for (let slotZ = 0; slotZ < grid; slotZ += stride) {
    for (let slotX = 0; slotX < grid; slotX += stride) {
      const worldCellX = Math.round((centerCellX - slotX) / grid) * grid + slotX;
      const worldCellZ = Math.round((centerCellZ - slotZ) / grid) * grid + slotZ;
      const x = worldCellX * cell;
      const z = worldCellZ * cell;
      const distance = Math.hypot(x - params.centerX, z - params.centerZ);
      if (distance > outer || distance < inner) continue;
      points.push(x, CANDIDATE_Y_M, z);
    }
  }

  return new Float32Array(points);
}

export class RingDebugOverlay {
  private readonly root = new THREE.Group();
  private readonly outerRing: THREE.LineLoop;
  private readonly innerRing: THREE.LineLoop;
  private readonly candidatePoints: THREE.Points;
  private readonly currentCenter: THREE.LineSegments;
  private readonly lastRecenter: THREE.LineSegments;
  private lastRecenterX = Number.POSITIVE_INFINITY;
  private lastRecenterZ = Number.POSITIVE_INFINITY;
  private lastRecenterAtMs = 0;
  private candidateSignature = "";
  private candidateSlots = 0;
  private candidatePointsShown = 0;
  private snapshotValue: RingDebugSnapshot;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly kind: RingDebugKind,
    style: RingDebugStyle,
  ) {
    this.root.name = `${kind}-ring-debug`;
    this.root.visible = false;
    this.root.renderOrder = 10_000;

    this.outerRing = new THREE.LineLoop(
      new THREE.BufferGeometry(),
      debugLineMaterial(style.outerColor, 0.95),
    );
    this.outerRing.name = `${kind}-ring-debug-outer`;

    this.innerRing = new THREE.LineLoop(
      new THREE.BufferGeometry(),
      debugLineMaterial(style.innerColor, 0.75),
    );
    this.innerRing.name = `${kind}-ring-debug-inner`;

    this.candidatePoints = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({
        color: style.candidateColor,
        size: 2,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.55,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.candidatePoints.name = `${kind}-ring-debug-candidates`;

    this.currentCenter = new THREE.LineSegments(
      crossGeometry(0, 0, CROSS_SIZE_M),
      debugLineMaterial(style.centerColor, 1),
    );
    this.currentCenter.name = `${kind}-ring-debug-current-center`;

    this.lastRecenter = new THREE.LineSegments(
      crossGeometry(0, 0, CROSS_SIZE_M * 1.4),
      debugLineMaterial(style.recenterColor, 1),
    );
    this.lastRecenter.name = `${kind}-ring-debug-last-recenter`;

    this.root.add(this.outerRing, this.innerRing, this.candidatePoints, this.currentCenter, this.lastRecenter);
    this.scene.add(this.root);

    this.snapshotValue = emptySnapshot();
  }

  update(update: RingDebugUpdate): RingDebugSnapshot {
    const enabled = ringDebugEnabled(this.kind);
    this.root.visible = enabled;
    if (!enabled) {
      this.snapshotValue = { ...this.snapshotValue, enabled: false };
      this.publishCounters(this.snapshotValue);
      return this.snapshot();
    }

    const nowMs = finiteOr(update.nowMs, performance.now());
    const cellSizeM = Math.max(0.001, finiteOr(update.cellSizeM, 1));
    const outerRadiusM = Math.max(cellSizeM, finiteOr(update.outerRadiusM, cellSizeM));
    const innerRadiusM = Math.max(0, Math.min(outerRadiusM, finiteOr(update.innerRadiusM, 0)));
    const centerX = finiteOr(update.centerX, 0);
    const centerZ = finiteOr(update.centerZ, 0);
    const snappedCenterX = Math.round(centerX / cellSizeM) * cellSizeM;
    const snappedCenterZ = Math.round(centerZ / cellSizeM) * cellSizeM;
    const refreshDistanceM = Math.max(0.001, finiteOr(update.refreshDistanceM, cellSizeM));

    if (ringDebugShouldRecenter(
      this.lastRecenterX,
      this.lastRecenterZ,
      centerX,
      centerZ,
      refreshDistanceM,
    )) {
      this.lastRecenterX = centerX;
      this.lastRecenterZ = centerZ;
      this.lastRecenterAtMs = nowMs;
      replaceGeometry(this.lastRecenter, crossGeometry(centerX, centerZ, CROSS_SIZE_M * 1.4));
      replaceGeometry(this.outerRing, circleGeometry(centerX, centerZ, outerRadiusM));
      replaceGeometry(this.innerRing, circleGeometry(centerX, centerZ, innerRadiusM));
      this.innerRing.visible = innerRadiusM > 0.001;
    }

    replaceGeometry(this.currentCenter, crossGeometry(snappedCenterX, snappedCenterZ, CROSS_SIZE_M));

    const grid = Math.max(1, Math.floor(update.candidateGrid ?? Math.ceil((outerRadiusM * 2) / cellSizeM)));
    const signature = [
      Math.round(this.lastRecenterX * 1000),
      Math.round(this.lastRecenterZ * 1000),
      Math.round(cellSizeM * 1000),
      Math.round(outerRadiusM * 1000),
      Math.round(innerRadiusM * 1000),
      grid,
    ].join("|");
    if (signature !== this.candidateSignature) {
      this.candidateSignature = signature;
      const positions = ringDebugCandidatePositions({
        centerX: this.lastRecenterX,
        centerZ: this.lastRecenterZ,
        cellSizeM,
        grid,
        outerRadiusM,
        innerRadiusM,
      });
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      replaceGeometry(this.candidatePoints, geometry);
      this.candidateSlots = grid * grid;
      this.candidatePointsShown = positions.length / 3;
    }

    this.snapshotValue = {
      enabled: true,
      centerX,
      centerZ,
      snappedCenterX,
      snappedCenterZ,
      lastRecenterX: this.lastRecenterX,
      lastRecenterZ: this.lastRecenterZ,
      staleAgeMs: Math.max(0, nowMs - this.lastRecenterAtMs),
      candidateSlots: this.candidateSlots,
      candidatePointsShown: this.candidatePointsShown,
      acceptedCount: Number.isFinite(update.acceptedCount) ? Math.max(0, Math.floor(update.acceptedCount ?? 0)) : null,
      telemetryState: update.telemetryState ?? "unknown",
      lodMode: update.lodMode ?? "single",
    };
    this.publishCounters(this.snapshotValue, update.classColoring === true);
    return this.snapshot();
  }

  snapshot(): RingDebugSnapshot {
    return { ...this.snapshotValue };
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const child of this.root.children) {
      const renderable = child as THREE.Line | THREE.Points;
      renderable.geometry?.dispose();
      const material = renderable.material;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material?.dispose();
    }
  }

  private publishCounters(snapshot: RingDebugSnapshot, classColoring = false): void {
    const counters = globalCounters();
    if (!counters) return;
    const prefix = `${this.kind}.ringDebug`;
    counters[`${prefix}.enabled`] = snapshot.enabled ? 1 : 0;
    counters[`${prefix}.centerX`] = snapshot.centerX;
    counters[`${prefix}.centerZ`] = snapshot.centerZ;
    counters[`${prefix}.snappedCenterX`] = snapshot.snappedCenterX;
    counters[`${prefix}.snappedCenterZ`] = snapshot.snappedCenterZ;
    counters[`${prefix}.lastRecenterX`] = snapshot.lastRecenterX;
    counters[`${prefix}.lastRecenterZ`] = snapshot.lastRecenterZ;
    counters[`${prefix}.staleAgeMs`] = snapshot.staleAgeMs;
    counters[`${prefix}.candidateSlots`] = snapshot.candidateSlots;
    counters[`${prefix}.candidatePointsShown`] = snapshot.candidatePointsShown;
    counters[`${prefix}.acceptedCount`] = snapshot.acceptedCount ?? -1;
    counters[`${prefix}.telemetryFresh`] = snapshot.telemetryState === "fresh" ? 1 : 0;
    counters[`${prefix}.telemetryKnown`] = snapshot.telemetryState === "unknown" ? 0 : 1;
    counters[`${prefix}.classColoring`] = classColoring ? 1 : 0;
    counters[`${prefix}.lodSingle`] = snapshot.lodMode === "single" ? 1 : 0;
  }
}

function circleGeometry(centerX: number, centerZ: number, radiusM: number): THREE.BufferGeometry {
  const positions = new Float32Array(CIRCLE_SEGMENTS * 3);
  for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
    const angle = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
    positions[i * 3] = centerX + Math.cos(angle) * radiusM;
    positions[i * 3 + 1] = CANDIDATE_Y_M;
    positions[i * 3 + 2] = centerZ + Math.sin(angle) * radiusM;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return geometry;
}

function crossGeometry(centerX: number, centerZ: number, sizeM: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    centerX - sizeM, CANDIDATE_Y_M, centerZ,
    centerX + sizeM, CANDIDATE_Y_M, centerZ,
    centerX, CANDIDATE_Y_M, centerZ - sizeM,
    centerX, CANDIDATE_Y_M, centerZ + sizeM,
  ], 3));
  return geometry;
}

function debugLineMaterial(color: number, opacity: number): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
  });
}

function replaceGeometry(object: THREE.Line | THREE.Points, next: THREE.BufferGeometry): void {
  const previous = object.geometry;
  object.geometry = next;
  previous.dispose();
}

function emptySnapshot(): RingDebugSnapshot {
  return {
    enabled: false,
    centerX: 0,
    centerZ: 0,
    snappedCenterX: 0,
    snappedCenterZ: 0,
    lastRecenterX: 0,
    lastRecenterZ: 0,
    staleAgeMs: 0,
    candidateSlots: 0,
    candidatePointsShown: 0,
    acceptedCount: null,
    telemetryState: "unknown",
    lodMode: "single",
  };
}

function parseBoolean(value: string | null): boolean {
  return value === "1" || value === "true" || value === "on";
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function currentSearchParams(): URLSearchParams {
  const maybeWindow = globalThis as typeof globalThis & { window?: { location?: { search?: string } } };
  return new URLSearchParams(maybeWindow.window?.location?.search ?? "");
}

function globalCounters(): Record<string, number> | null {
  return (globalThis as typeof globalThis & {
    window?: { __drusnielClod?: { stats?: { counters?: Record<string, number> } } };
  }).window?.__drusnielClod?.stats?.counters ?? null;
}
