import * as THREE from "three";
import type { EnvironmentLighting } from "../environment/environment.js";

export interface TreeImpostorRuntimeLighting {
  update(lighting: EnvironmentLighting): void;
}

const runtimeLighting = new WeakMap<THREE.Material, TreeImpostorRuntimeLighting>();

export function registerTreeImpostorRuntimeLighting(
  material: THREE.Material,
  state: TreeImpostorRuntimeLighting,
): void {
  runtimeLighting.set(material, state);
}

export function updateTreeImpostorRuntimeLighting(
  material: THREE.Material,
  lighting: EnvironmentLighting,
): void {
  runtimeLighting.get(material)?.update(lighting);
}
