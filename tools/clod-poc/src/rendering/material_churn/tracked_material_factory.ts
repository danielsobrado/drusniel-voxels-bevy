import * as THREE from "three";
import { materialChurnDiagnostics } from "./material_churn_diagnostics.js";

export function trackCreatedMaterial<T extends THREE.Material>(material: T, reason: string): T {
  materialChurnDiagnostics.trackNewMaterial(material, reason);
  return material;
}

export function trackedShaderMaterial(parameters: THREE.ShaderMaterialParameters, reason: string): THREE.ShaderMaterial {
  return trackCreatedMaterial(new THREE.ShaderMaterial(parameters), reason);
}

export function trackedMeshStandardMaterial(
  parameters: THREE.MeshStandardMaterialParameters,
  reason: string,
): THREE.MeshStandardMaterial {
  return trackCreatedMaterial(new THREE.MeshStandardMaterial(parameters), reason);
}

export function trackedMeshBasicMaterial(
  parameters: THREE.MeshBasicMaterialParameters,
  reason: string,
): THREE.MeshBasicMaterial {
  return trackCreatedMaterial(new THREE.MeshBasicMaterial(parameters), reason);
}

export function trackedLineBasicMaterial(
  parameters: THREE.LineBasicMaterialParameters,
  reason: string,
): THREE.LineBasicMaterial {
  return trackCreatedMaterial(new THREE.LineBasicMaterial(parameters), reason);
}

export function trackedPointsMaterial(
  parameters: THREE.PointsMaterialParameters,
  reason: string,
): THREE.PointsMaterial {
  return trackCreatedMaterial(new THREE.PointsMaterial(parameters), reason);
}

export function trackedMeshDepthMaterial(
  parameters: THREE.MeshDepthMaterialParameters,
  reason: string,
): THREE.MeshDepthMaterial {
  return trackCreatedMaterial(new THREE.MeshDepthMaterial(parameters), reason);
}
