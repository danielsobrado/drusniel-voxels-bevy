import * as THREE from "three";
import type {
  ClodHooks,
  PrecisionLandmark,
  PrecisionLandmarkScreenPosition,
} from "../core/hooks.js";

export interface PrecisionLandmarkOrigin {
  readonly x: number;
  readonly z: number;
}

export function precisionLandmarkRenderPosition(
  world: readonly [number, number, number],
  origin: PrecisionLandmarkOrigin,
): readonly [number, number, number] {
  return [world[0] - origin.x, world[1], world[2] - origin.z];
}

function disposeGroup(group: THREE.Group): void {
  for (const child of group.children) {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material?.dispose();
  }
  group.clear();
}

export function installPrecisionLandmarkHooks(input: {
  hooks: ClodHooks;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  origin: () => PrecisionLandmarkOrigin;
  viewport: () => { width: number; height: number };
}): void {
  const group = new THREE.Group();
  group.name = "precision-diagnostic-landmarks";
  group.renderOrder = 10_000;
  input.scene.add(group);

  input.hooks.setPrecisionLandmarks = (landmarks: readonly PrecisionLandmark[]) => {
    disposeGroup(group);
    group.position.set(0, 0, 0);
    const origin = input.origin();
    for (const landmark of landmarks) {
      const color = new THREE.Color(landmark.color ?? "#ff00ff");
      const geometry = new THREE.SphereGeometry(Math.max(0.1, landmark.radiusM ?? 3), 12, 8);
      const material = new THREE.MeshBasicMaterial({ color, toneMapped: false, depthTest: true });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = landmark.id;
      mesh.position.fromArray(precisionLandmarkRenderPosition(landmark.p, origin));
      mesh.renderOrder = 10_000;
      group.add(mesh);
    }
  };
  input.hooks.getPrecisionLandmarkScreenPositions = (): readonly PrecisionLandmarkScreenPosition[] => {
    const viewport = input.viewport();
    input.camera.updateMatrixWorld(true);
    return group.children.map((child) => {
      const ndc = child.getWorldPosition(new THREE.Vector3()).project(input.camera);
      return {
        id: child.name,
        xPx: (ndc.x * 0.5 + 0.5) * viewport.width,
        yPx: (-ndc.y * 0.5 + 0.5) * viewport.height,
        depthNdc: ndc.z,
        visible: Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z >= -1 && ndc.z <= 1,
      };
    });
  };
}
