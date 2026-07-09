import * as THREE from "three";

export const TREE_IMPOSTOR_MIN_ORBIT_WIDTH_RATIO = 0.92;

export interface TreeImpostorOrbitWidthSample {
  angleRadians: number;
  widthRatio: number;
}

export interface TreeImpostorOrbitWidthReport {
  status: "pass" | "fail";
  minWidthRatio: number;
  samples: TreeImpostorOrbitWidthSample[];
}

export function evaluateTreeImpostorOrbitWidthGate(
  treePosition: THREE.Vector3,
  cardWidthM: number,
  orbitRadiusM: number,
  sampleCount = 32,
  threshold = TREE_IMPOSTOR_MIN_ORBIT_WIDTH_RATIO,
): TreeImpostorOrbitWidthReport {
  const width = Math.max(0.001, Math.abs(cardWidthM));
  const radius = Math.max(0.001, Math.abs(orbitRadiusM));
  const count = Math.max(4, Math.floor(sampleCount));
  const samples: TreeImpostorOrbitWidthSample[] = [];
  let minWidthRatio = Number.POSITIVE_INFINITY;
  for (let i = 0; i < count; i++) {
    const angleRadians = (i / count) * Math.PI * 2;
    const cameraPosition = new THREE.Vector3(
      treePosition.x + Math.cos(angleRadians) * radius,
      treePosition.y + radius * 0.25,
      treePosition.z + Math.sin(angleRadians) * radius,
    );
    const basis = treeImpostorCylindricalBillboardBasis(treePosition, cameraPosition);
    const left = treePosition.clone().addScaledVector(basis.right, -width * 0.5);
    const right = treePosition.clone().addScaledVector(basis.right, width * 0.5);
    const widthRatio = right.distanceTo(left) / width;
    samples.push({ angleRadians, widthRatio });
    minWidthRatio = Math.min(minWidthRatio, widthRatio);
  }
  return {
    status: minWidthRatio >= threshold ? "pass" : "fail",
    minWidthRatio,
    samples,
  };
}

export function treeImpostorCylindricalBillboardBasis(
  treePosition: THREE.Vector3,
  cameraPosition: THREE.Vector3,
): { right: THREE.Vector3; up: THREE.Vector3; normal: THREE.Vector3 } {
  const normal = new THREE.Vector3(
    cameraPosition.x - treePosition.x,
    0,
    cameraPosition.z - treePosition.z,
  );
  if (!Number.isFinite(normal.x) || !Number.isFinite(normal.z) || normal.lengthSq() <= 1e-12) {
    normal.set(0, 0, 1);
  } else {
    normal.normalize();
  }
  return {
    right: new THREE.Vector3(normal.z, 0, -normal.x),
    up: new THREE.Vector3(0, 1, 0),
    normal,
  };
}
