import type * as THREE from "three";
import type { FarClipmapConfig, FarClipmapDebugMode } from "./far_clipmap_config.js";
import {
  createFarClipmapController as createBaseFarClipmapController,
  type FarClipmapController,
  type FarClipmapControllerOptions,
  type FarClipmapOwnershipSnapshot,
  type FarClipmapStats,
  type RefinedClodReadinessInput,
} from "./far_clipmap_controller.js";
import type { FarClipmapSource } from "./far_clipmap_source.js";

interface RingSnapState {
  readonly readySnapX: number;
  readonly readySnapZ: number;
}

interface InspectableFarClipmapController extends FarClipmapController {
  readonly rings: readonly RingSnapState[];
}

export function applyCurrentSnapReadiness(
  stats: FarClipmapStats,
  rings: readonly RingSnapState[],
): FarClipmapStats {
  const readyTiles = stats.enabled === 1
    ? rings.filter((ring) => (
      Number.isFinite(ring.readySnapX)
      && Number.isFinite(ring.readySnapZ)
      && ring.readySnapX === stats.snappedOriginX
      && ring.readySnapZ === stats.snappedOriginZ
    )).length
    : 0;
  const pendingTiles = Math.max(0, stats.ringCount - readyTiles);
  return {
    ...stats,
    readyTiles,
    pendingTiles,
    gpuOwnedCells: readyTiles,
    gpuOwnershipHoles: pendingTiles,
  };
}

export function createCurrentSnapFarClipmapController(
  scene: THREE.Scene,
  config: FarClipmapConfig,
  source?: FarClipmapSource,
  options?: FarClipmapControllerOptions,
): FarClipmapController {
  const base = createBaseFarClipmapController(scene, config, source, options) as InspectableFarClipmapController;
  if (!Array.isArray(base.rings)) throw new Error("far clipmap ring readiness contract unavailable");

  let lastStats: FarClipmapStats | null = null;
  const ownershipSnapshot = (): FarClipmapOwnershipSnapshot => {
    const snapshot = base.ownershipSnapshot();
    return {
      ...snapshot,
      ready: snapshot.enabled && lastStats !== null && lastStats.pendingTiles === 0,
    };
  };

  return {
    update(cameraPosition, motionPosition) {
      lastStats = applyCurrentSnapReadiness(base.update(cameraPosition, motionPosition), base.rings);
      return lastStats;
    },
    commitPendingUpload: () => base.commitPendingUpload(),
    setRefinedClodReadiness: (readiness: RefinedClodReadinessInput | null) => base.setRefinedClodReadiness(readiness),
    setDebugMode: (mode: FarClipmapDebugMode) => base.setDebugMode(mode),
    setVisible: (visible: boolean) => base.setVisible(visible),
    dispose: () => base.dispose(),
    ownershipSnapshot,
  };
}
