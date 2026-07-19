import * as THREE from "three";
import {
  materialChurnDiagnostics,
  setMaterialNeedsUpdate,
  setPipelineSensitiveMaterialProperty,
} from "../rendering/material_churn/material_churn_diagnostics.js";
const GHOST_MESH_NAME = "construction-ghost";
const GHOST_PATCH_FLAG = "constructionGhostEffectInstalled";
const BASE_GHOST_OPACITY = 0.2;
const PULSE_GHOST_OPACITY = 0.06;
const PULSE_SPEED = 3.15;
const RENDER_ORDER = 90;

let installed = false;

function isGhostMesh(object: THREE.Object3D): object is THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  return object instanceof THREE.Mesh
    && object.name === GHOST_MESH_NAME
    && object.material instanceof THREE.MeshBasicMaterial;
}

function configureGhostFill(material: THREE.MeshBasicMaterial): void {
  let changed = false;
  material.name = "construction-ghost-fill";
  material.opacity = BASE_GHOST_OPACITY;
  changed = setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "transparent", true, "construction-ghost-fill") || changed;
  changed = setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "depthWrite", false, "construction-ghost-fill") || changed;
  changed = setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "depthTest", true, "construction-ghost-fill") || changed;
  changed = setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "side", THREE.FrontSide, "construction-ghost-fill") || changed;
  changed = setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "blending", THREE.NormalBlending, "construction-ghost-fill") || changed;
  changed = setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "toneMapped", false, "construction-ghost-fill") || changed;
  if (changed) setMaterialNeedsUpdate(materialChurnDiagnostics, material, "construction-ghost-fill");
}

function attachAnimation(mesh: THREE.Mesh, fill: THREE.MeshBasicMaterial): void {
  const previousOnBeforeRender = mesh.onBeforeRender;
  mesh.onBeforeRender = (...args: Parameters<typeof previousOnBeforeRender>) => {
    previousOnBeforeRender.call(mesh, ...args);
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.001 * PULSE_SPEED);
    fill.opacity = BASE_GHOST_OPACITY + pulse * PULSE_GHOST_OPACITY;
  };
}

function enhanceConstructionGhost(object: THREE.Object3D): void {
  if (!isGhostMesh(object) || object.userData[GHOST_PATCH_FLAG] === true) return;

  const fill = object.material;
  materialChurnDiagnostics.trackNewMaterial(fill, "construction-ghost-fill-existing");
  configureGhostFill(fill);
  object.renderOrder = RENDER_ORDER;
  object.frustumCulled = false;
  attachAnimation(object, fill);
  object.userData[GHOST_PATCH_FLAG] = true;
}

export function installConstructionGhostEffect(): void {
  if (installed) return;
  installed = true;

  const originalAdd = THREE.Object3D.prototype.add;
  THREE.Object3D.prototype.add = function addWithConstructionGhost(
    this: THREE.Object3D,
    ...objects: THREE.Object3D[]
  ): THREE.Object3D {
    const result = originalAdd.apply(this, objects);
    for (const object of objects) enhanceConstructionGhost(object);
    return result;
  };
}
