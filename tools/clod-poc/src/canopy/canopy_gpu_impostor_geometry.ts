import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Crown cluster used for far-canopy GPU impostors: two crossed vertical cards plus a
 * horizontal top card. Reads as a rounded crown volume from every horizon angle instead
 * of a single flat billboard. Unit-sized; instance matrices scale it to crown size.
 */
export function createCanopyCrownClusterGeometry(): THREE.BufferGeometry {
  const verticalA = new THREE.PlaneGeometry(1, 1, 1, 1);

  const verticalB = new THREE.PlaneGeometry(1, 1, 1, 1);
  verticalB.rotateY(Math.PI / 2);

  const horizontalTop = new THREE.PlaneGeometry(1, 1, 1, 1);
  horizontalTop.rotateX(-Math.PI / 2);
  horizontalTop.translate(0, 0.45, 0);

  const merged = mergeGeometries([verticalA, verticalB, horizontalTop], false);
  verticalA.dispose();
  verticalB.dispose();
  horizontalTop.dispose();
  if (!merged) throw new Error("failed to merge canopy crown cluster geometry");
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}
