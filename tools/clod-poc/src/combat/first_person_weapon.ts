import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export interface FirstPersonWeaponDeps {
  camera: THREE.PerspectiveCamera;
}

export interface FirstPersonWeapon {
  readonly model: THREE.Group | null;
  load(path: string, offset: THREE.Vector3): Promise<void>;
  setVisible(visible: boolean): void;
  swingProgress(t: number): void;
  resetPose(): void;
}

const loader = new GLTFLoader();

export function createFirstPersonWeapon(deps: FirstPersonWeaponDeps): FirstPersonWeapon {
  const weaponGroup = new THREE.Group();
  weaponGroup.name = "first_person_weapon";

  let modelRoot: THREE.Group | null = null;

  return {
    get model() { return modelRoot; },

    async load(path: string, offset: THREE.Vector3) {
      weaponGroup.position.copy(offset);
      deps.camera.add(weaponGroup);

      const gltf = await loader.loadAsync(path);
      modelRoot = gltf.scene;
      modelRoot.name = "weapon_model";
      weaponGroup.add(modelRoot);
    },

    setVisible(visible: boolean) {
      weaponGroup.visible = visible;
    },

    swingProgress(t: number) {
      if (!modelRoot) return;
      const swingAngle = -1.2 + t * 2.4;
      modelRoot.rotation.set(0, 0, swingAngle);
    },

    resetPose() {
      if (modelRoot) {
        modelRoot.rotation.set(0, 0, 0);
      }
    },
  };
}
