import type {
  PropAssetDef,
  PropAssetMetadata,
  PropInstance,
  PropOcclusionSettings,
} from "./prop_types.js";

export interface PropOccluderBounds {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

export interface PropOccluder {
  readonly key: string;
  readonly assetId: string;
  readonly instanceIndex: number;
  readonly instanceRevision: number;
  readonly bounds: PropOccluderBounds;
  readonly heightM: number;
  readonly affectGi: boolean;
  readonly affectFog: boolean;
}

export interface PropOccluderSnapshot {
  readonly enabled: boolean;
  readonly revision: number;
  readonly sceneId: string;
  readonly occluders: readonly PropOccluder[];
}

export interface BuildPropOccluderSnapshotInput {
  readonly enabled: boolean;
  readonly revision: number;
  readonly sceneId: string;
  readonly instances: readonly PropInstance[];
  readonly assetById: ReadonlyMap<string, PropAssetDef>;
  readonly metadataByAssetId: ReadonlyMap<string, PropAssetMetadata>;
  readonly settings: PropOcclusionSettings;
}

export function emptyPropOccluderSnapshot(revision = 0, sceneId = ""): PropOccluderSnapshot {
  return {
    enabled: false,
    revision: safeRevision(revision),
    sceneId,
    occluders: [],
  };
}

export function buildPropOccluderSnapshot(
  input: BuildPropOccluderSnapshotInput,
): PropOccluderSnapshot {
  const revision = safeRevision(input.revision);
  if (!input.enabled || !input.settings.enabled) {
    return emptyPropOccluderSnapshot(revision, input.sceneId);
  }

  const occluders: PropOccluder[] = [];
  for (let instanceIndex = 0; instanceIndex < input.instances.length; instanceIndex += 1) {
    const instance = input.instances[instanceIndex]!;
    const asset = input.assetById.get(instance.assetId);
    const metadata = input.metadataByAssetId.get(instance.assetId);
    const proxy = asset?.lightingProxy;
    if (
      !asset
      || !metadata
      || proxy?.mode !== "coarse_bounds"
      || (!proxy.affectGi && !proxy.affectFog)
    ) {
      continue;
    }

    const bounds = transformedBounds(
      metadata.localBounds.min,
      metadata.localBounds.max,
      instance,
      input.settings.footprintPaddingM,
    );
    if (!bounds) continue;
    const heightM = bounds.maxY - bounds.minY;
    if (heightM < input.settings.minimumHeightM) continue;

    occluders.push({
      key: `${instance.assetId}:${instanceIndex}`,
      assetId: instance.assetId,
      instanceIndex,
      instanceRevision: safeRevision(instance.revision),
      bounds,
      heightM,
      affectGi: proxy.affectGi,
      affectFog: proxy.affectFog,
    });
  }

  return {
    enabled: true,
    revision,
    sceneId: input.sceneId,
    occluders,
  };
}

function transformedBounds(
  localMin: readonly [number, number, number],
  localMax: readonly [number, number, number],
  instance: PropInstance,
  footprintPaddingM: number,
): PropOccluderBounds | null {
  const values = [
    ...localMin,
    ...localMax,
    ...instance.position,
    instance.rotationY,
    instance.scale,
  ];
  if (!values.every(Number.isFinite)) return null;

  const scale = Math.abs(instance.scale);
  if (scale <= 0.000001) return null;
  const cosYaw = Math.cos(instance.rotationY);
  const sinYaw = Math.sin(instance.rotationY);
  const positionX = instance.position[0];
  const positionY = instance.position[1];
  const positionZ = instance.position[2];

  let minX = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const x of [localMin[0] * scale, localMax[0] * scale]) {
    for (const z of [localMin[2] * scale, localMax[2] * scale]) {
      const worldX = positionX + x * cosYaw - z * sinYaw;
      const worldZ = positionZ + x * sinYaw + z * cosYaw;
      minX = Math.min(minX, worldX);
      minZ = Math.min(minZ, worldZ);
      maxX = Math.max(maxX, worldX);
      maxZ = Math.max(maxZ, worldZ);
    }
  }

  const padding = Math.max(0, finiteOrZero(footprintPaddingM));
  const scaledMinY = localMin[1] * scale;
  const scaledMaxY = localMax[1] * scale;
  return {
    minX: minX - padding,
    minY: positionY + Math.min(scaledMinY, scaledMaxY),
    minZ: minZ - padding,
    maxX: maxX + padding,
    maxY: positionY + Math.max(scaledMinY, scaledMaxY),
    maxZ: maxZ + padding,
  };
}

function safeRevision(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
