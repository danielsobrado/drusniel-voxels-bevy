import type * as THREE from "three";
import {
  readActiveLargePropOcclusionField,
  readActiveLargePropOcclusionFieldGeneration,
} from "../../props/large_prop_occlusion_runtime.js";
import type { FarClipmapConfig, FarClipmapDebugMode } from "./far_clipmap_config.js";
import {
  createFarClipmapController as createBaseFarClipmapController,
  type FarClipmapController,
  type FarClipmapControllerOptions,
  type FarClipmapOwnershipSnapshot,
  type FarClipmapStats,
  type RefinedClodReadinessInput,
} from "./far_clipmap_controller.js";
import { FarReflectionSource, type FarReflectionSourceConfig } from "./far_reflection_source.js";
import {
  publishFarReflectionSourceCounters,
  registerActiveFarReflectionSource,
} from "./far_reflection_source_runtime.js";
import { createDefaultFarClipmapSource, type FarClipmapSource } from "./far_clipmap_source.js";

interface RingSnapState {
  readonly readySnapX: number;
  readonly readySnapZ: number;
}

interface InspectableFarClipmapController extends FarClipmapController {
  readonly rings: readonly RingSnapState[];
}

export interface CurrentSnapFarClipmapControllerOptions extends FarClipmapControllerOptions {
  readonly reflectionSource?: FarReflectionSourceConfig;
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
  options: CurrentSnapFarClipmapControllerOptions = {},
): FarClipmapController {
  const activeSource = source ?? createDefaultFarClipmapSource();
  const base = createBaseFarClipmapController(scene, config, activeSource, options) as InspectableFarClipmapController;
  if (!Array.isArray(base.rings)) throw new Error("far clipmap ring readiness contract unavailable");

  const reflection = options.reflectionSource?.enabled
    ? new FarReflectionSource(options.reflectionSource)
    : null;
  const unregisterReflection = reflection
    ? registerActiveFarReflectionSource(reflection)
    : () => undefined;
  let lastStats: FarClipmapStats | null = null;

  const updateReflection = (cameraPosition: THREE.Vector3, stats: FarClipmapStats): void => {
    if (!reflection || activeSource.isReady?.() === false) return;
    const propField = readActiveLargePropOcclusionField();
    reflection.submit({
      source: activeSource,
      sourceRevision: stats.sourceRevision,
      propGeneration: readActiveLargePropOcclusionFieldGeneration(),
      propPayload: propField?.giHeightPayload() ?? null,
      centerX: cameraPosition.x,
      centerZ: cameraPosition.z,
    });
    reflection.step();
    publishFarReflectionSourceCounters(reflection.stats());
  };

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
      updateReflection(cameraPosition, lastStats);
      return lastStats;
    },
    commitPendingUpload: () => base.commitPendingUpload(),
    setRefinedClodReadiness: (readiness: RefinedClodReadinessInput | null) => base.setRefinedClodReadiness(readiness),
    setDebugMode: (mode: FarClipmapDebugMode) => base.setDebugMode(mode),
    setVisible: (visible: boolean) => base.setVisible(visible),
    dispose() {
      unregisterReflection();
      base.dispose();
    },
    ownershipSnapshot,
  };
}
