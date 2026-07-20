import type * as THREE from "three";

const AUXILIARY_OVERLAY_NAMES = [
  "river-bank-residue-overlay",
  "river-cascade-particles",
  "river-mist-overlay",
] as const;

export interface WaterFoamAuxiliaryVisibilityState {
  readonly hidden: boolean;
  readonly matched: number;
}

export interface WaterFoamAuxiliaryVisibilityController {
  setHidden(hidden: boolean): WaterFoamAuxiliaryVisibilityState;
  getState(): WaterFoamAuxiliaryVisibilityState;
}

interface VisibilitySnapshot {
  readonly object: THREE.Object3D;
  readonly visible: boolean;
}

const controllers = new WeakMap<THREE.Scene, WaterFoamAuxiliaryVisibilityController>();

export function installWaterFoamAuxiliaryVisibility(
  scene: THREE.Scene,
): WaterFoamAuxiliaryVisibilityController {
  const existing = controllers.get(scene);
  if (existing) return existing;

  let hidden = false;
  let snapshots: VisibilitySnapshot[] = [];
  const controller: WaterFoamAuxiliaryVisibilityController = {
    setHidden(value) {
      if (value === hidden) return state();
      if (value) {
        snapshots = AUXILIARY_OVERLAY_NAMES.flatMap((name) => {
          const object = scene.getObjectByName(name);
          return object ? [{ object, visible: object.visible }] : [];
        });
        for (const snapshot of snapshots) snapshot.object.visible = false;
      } else {
        for (const snapshot of snapshots) snapshot.object.visible = snapshot.visible;
        snapshots = [];
      }
      hidden = value;
      return state();
    },
    getState: state,
  };
  controllers.set(scene, controller);
  return controller;

  function state(): WaterFoamAuxiliaryVisibilityState {
    return { hidden, matched: snapshots.length };
  }
}
