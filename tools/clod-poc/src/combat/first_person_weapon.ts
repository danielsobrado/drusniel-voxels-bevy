import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const SWING_MIN = -1;
const SWING_MAX = 1;
const WEAPON_RENDER_ORDER = 4600;
const TARGET_MODEL_SIZE_M = 0.85;
const FALLBACK_BLADE_LENGTH_M = 0.75;

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

function createFallbackSword(): THREE.Group {
  const root = new THREE.Group();
  root.name = "fallback_first_person_sword";

  const bladeMaterial = new THREE.MeshBasicMaterial({
    color: 0xd9e4ef,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const gripMaterial = new THREE.MeshBasicMaterial({
    color: 0x3b2416,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const guardMaterial = new THREE.MeshBasicMaterial({
    color: 0xb68a3a,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });

  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.045, FALLBACK_BLADE_LENGTH_M, 0.025), bladeMaterial);
  blade.name = "fallback_sword_blade";
  blade.position.y = 0.35;

  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 4), bladeMaterial);
  tip.name = "fallback_sword_tip";
  tip.position.y = 0.79;
  tip.rotation.y = Math.PI * 0.25;

  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.28, 10), gripMaterial);
  grip.name = "fallback_sword_grip";
  grip.position.y = -0.2;

  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.045, 0.045), guardMaterial);
  guard.name = "fallback_sword_guard";
  guard.position.y = -0.04;

  root.add(blade, tip, grip, guard);
  root.rotation.set(-0.22, 0.08, -0.22, "XYZ");
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false;
    mesh.renderOrder = WEAPON_RENDER_ORDER;
  });
  return root;
}

function cloneWeaponMaterial(material: THREE.Material): THREE.Material {
  const cloned = material.clone();
  cloned.depthTest = false;
  cloned.depthWrite = false;
  cloned.toneMapped = false;
  return cloned;
}

function prepareWeaponModel(root: THREE.Object3D): boolean {
  let meshCount = 0;
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshCount++;
    mesh.frustumCulled = false;
    mesh.renderOrder = WEAPON_RENDER_ORDER;
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map(cloneWeaponMaterial);
    } else if (mesh.material) {
      mesh.material = cloneWeaponMaterial(mesh.material);
    }
  });

  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  bounds.getSize(size);
  bounds.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z);
  if (Number.isFinite(maxDim) && maxDim > 1e-6) {
    const scale = TARGET_MODEL_SIZE_M / maxDim;
    root.scale.multiplyScalar(scale);
    root.position.addScaledVector(center, -scale);
  }
  return meshCount > 0;
}

export function createFirstPersonWeapon(deps: FirstPersonWeaponDeps): FirstPersonWeapon {
  const weaponRoot = new THREE.Group();
  const weaponMount = new THREE.Group();
  const fallbackSword = createFallbackSword();
  const offset = new THREE.Vector3();
  let modelRoot: THREE.Object3D | null = null;
  let loadGeneration = 0;
  let swingT = 0;

  weaponRoot.name = "first_person_weapon";
  weaponRoot.visible = false;
  weaponRoot.add(weaponMount);
  weaponMount.add(fallbackSword);
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
      fallbackSword.visible = true;
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
      const loadedRoot = gltf.scene;
      loadedRoot.name = "weapon_model";
      const hasMeshes = prepareWeaponModel(loadedRoot);
      modelRoot = loadedRoot;
      weaponMount.add(modelRoot);
      fallbackSword.visible = !hasMeshes;
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
      disposeObject(fallbackSword);
      weaponRoot.clear();
      modelRoot = null;
    },
  };
}
