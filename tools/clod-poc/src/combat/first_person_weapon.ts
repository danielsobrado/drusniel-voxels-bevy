import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const SWING_MIN = -1;
const SWING_MAX = 1;

export interface FirstPersonWeaponDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}

export interface FirstPersonWeapon {
  readonly model: THREE.Object3D | null;
  load(path: string, offset: THREE.Vector3): Promise<void>;
  setVisible(visible: boolean): void;
  swingProgress(t: number): void;
  resetPose(): void;
  update(): void;
  dispose(): void;
}

const loader = new GLTFLoader();

function disposeObject(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      for (const entry of material) entry.dispose();
    } else {
      material?.dispose();
    }
  });
}

export function createFirstPersonWeapon(deps: FirstPersonWeaponDeps): FirstPersonWeapon {
  const weaponRoot = new THREE.Group();
  const weaponMount = new THREE.Group();
  const offset = new THREE.Vector3();
  let modelRoot: THREE.Object3D | null = null;
  let loadGeneration = 0;
  let swingT = 0;

  weaponRoot.name = "first_person_weapon";
  weaponRoot.visible = false;
  weaponRoot.add(weaponMount);
  deps.scene.add(weaponRoot);

  const applyPose = (): void => {
    weaponMount.position.set(
      offset.x + swingT * 0.06,
      offset.y - Math.abs(swingT) * 0.03,
      offset.z + Math.max(0, swingT) * 0.08,
    );
    weaponMount.rotation.set(
      -0.12 + Math.max(0, swingT) * 0.28,
      0.18 + swingT * 0.32,
      -0.42 + swingT * 1.65,
      "XYZ",
    );
  };

  return {
    get model() { return modelRoot; },

    async load(path: string, nextOffset: THREE.Vector3) {
      offset.copy(nextOffset);
      applyPose();
      const generation = ++loadGeneration;
      const gltf = await loader.loadAsync(path);
      if (generation !== loadGeneration) {
        disposeObject(gltf.scene);
        return;
      }
      if (modelRoot) {
        weaponMount.remove(modelRoot);
        disposeObject(modelRoot);
      }
      modelRoot = gltf.scene;
      modelRoot.name = "weapon_model";
      weaponMount.add(modelRoot);
      applyPose();
    },

    setVisible(visible: boolean) {
      weaponRoot.visible = visible;
    },

    swingProgress(t: number) {
      swingT = THREE.MathUtils.clamp(t, SWING_MIN, SWING_MAX);
      applyPose();
    },

    resetPose() {
      swingT = 0;
      applyPose();
    },

    update() {
      weaponRoot.position.copy(deps.camera.position);
      weaponRoot.quaternion.copy(deps.camera.quaternion);
    },

    dispose() {
      loadGeneration++;
      deps.scene.remove(weaponRoot);
      if (modelRoot) disposeObject(modelRoot);
      weaponRoot.clear();
      modelRoot = null;
    },
  };
}
