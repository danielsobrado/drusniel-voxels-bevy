import * as THREE from "three";
import type { CustomPropsSettings, PropAssetMetadata } from "./prop_types.js";
import type { PropGridCell, PropSpatialGrid } from "./prop_spatial_grid.js";

const _frustum = new THREE.Frustum();
const _projScreen = new THREE.Matrix4();
const _sphere = new THREE.Sphere();
const _box = new THREE.Box3();
const _cellCenter = new THREE.Vector3();
const _instanceCenter = new THREE.Vector3();

export interface PropCullCamera {
  position: THREE.Vector3;
  matrixWorldInverse: THREE.Matrix4;
  projectionMatrix: THREE.Matrix4;
}

export interface PropCullResult {
  visibleCellKeys: Set<string>;
  visibleCells: number;
  culledCells: number;
  visibleInstanceIndices: number[];
  culledInstances: number;
  farCellSkipped: number;
}

function cellKey(coord: [number, number]): string {
  return `${coord[0]},${coord[1]}`;
}

function updateFrustum(camera: PropCullCamera): THREE.Frustum {
  _projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _frustum.setFromProjectionMatrix(_projScreen);
  return _frustum;
}

function sphereInFrustum(center: THREE.Vector3, radius: number, frustum: THREE.Frustum): boolean {
  _sphere.center.copy(center);
  _sphere.radius = radius;
  return frustum.intersectsSphere(_sphere);
}

function cellDistance(cameraPos: THREE.Vector3, cell: PropGridCell): number {
  const c = cell.bounds.center;
  return Math.hypot(cameraPos.x - c[0], cameraPos.y - c[1], cameraPos.z - c[2]);
}

export function cullPropSpatialGrid(
  grid: PropSpatialGrid,
  camera: PropCullCamera,
  settings: CustomPropsSettings,
  metadataByAssetId: ReadonlyMap<string, PropAssetMetadata>,
  frameId: number,
  candidateCells: readonly PropGridCell[] = grid.allCells(),
): PropCullResult {
  const visibleCellKeys = new Set<string>();
  const visibleInstanceIndices: number[] = [];
  let culledCells = 0;
  let culledInstances = 0;
  let farCellSkipped = 0;

  const frustum = settings.culling.cellFrustumCulling ? updateFrustum(camera) : null;
  const cameraPos = camera.position;
  const maxCellDistance = Math.max(
    ...settings.props.map((p) => p.culling.maxDistance),
    settings.spatial.cellSizeM,
  );

  for (const cell of candidateCells) {
    const key = cellKey(cell.cellCoord);
    const dist = cellDistance(cameraPos, cell);

    if (settings.culling.cellDistanceCulling && dist > maxCellDistance + cell.bounds.radius) {
      culledCells++;
      culledInstances += cell.instanceIndices.length;
      continue;
    }

    if (frustum) {
      _cellCenter.set(cell.bounds.center[0], cell.bounds.center[1], cell.bounds.center[2]);
      if (!sphereInFrustum(_cellCenter, cell.bounds.radius, frustum)) {
        culledCells++;
        culledInstances += cell.instanceIndices.length;
        continue;
      }
    }

    const isFarCell = dist > maxCellDistance * 0.5;
    if (
      isFarCell &&
      settings.spatial.farCellUpdateIntervalFrames > 1 &&
      frameId % settings.spatial.farCellUpdateIntervalFrames !== 0
    ) {
      farCellSkipped++;
      visibleCellKeys.add(key);
      for (const idx of cell.instanceIndices) visibleInstanceIndices.push(idx);
      continue;
    }

    visibleCellKeys.add(key);

    if (!settings.culling.perInstanceFrustumCullingForLargeProps || !frustum) {
      for (const idx of cell.instanceIndices) visibleInstanceIndices.push(idx);
      continue;
    }

    for (const idx of cell.instanceIndices) {
      const inst = grid.instances[idx]!;
      const meta = metadataByAssetId.get(inst.assetId);
      const radius = (meta?.boundingSphereRadius ?? 1) * inst.scale;
      if (radius < settings.culling.perInstanceCullingMinRadius) {
        visibleInstanceIndices.push(idx);
        continue;
      }
      _instanceCenter.set(inst.position[0], inst.position[1], inst.position[2]);
      if (sphereInFrustum(_instanceCenter, radius, frustum)) {
        visibleInstanceIndices.push(idx);
      } else {
        culledInstances++;
      }
    }
  }

  return {
    visibleCellKeys,
    visibleCells: visibleCellKeys.size,
    culledCells,
    visibleInstanceIndices,
    culledInstances,
    farCellSkipped,
  };
}

export function cellBoundsBox(cell: PropGridCell): THREE.Box3 {
  return _box.set(
    new THREE.Vector3(cell.bounds.min[0], cell.bounds.min[1], cell.bounds.min[2]),
    new THREE.Vector3(cell.bounds.max[0], cell.bounds.max[1], cell.bounds.max[2]),
  );
}
