import * as THREE from "three";
import {
  materialChurnDiagnostics,
  setMaterialNeedsUpdate,
  setPipelineSensitiveMaterialProperty,
} from "../rendering/material_churn/material_churn_diagnostics.js";
import { trackedMeshBasicMaterial } from "../rendering/material_churn/tracked_material_factory.js";

const GHOST_MESH_NAME = "construction-ghost";
const GHOST_PATCH_FLAG = "constructionGhostEffectInstalled";
const OUTER_GLOW_NAME = "construction-ghost-outer-glow";
const BASE_GHOST_OPACITY = 0.2;
const PULSE_GHOST_OPACITY = 0.06;
const BASE_GLOW_OPACITY = 0.12;
const PULSE_GLOW_OPACITY = 0.12;
const GLOW_SCALE = 1.035;
const PULSE_GLOW_SCALE = 0.018;
const PULSE_SPEED = 3.15;
const RENDER_ORDER = 90;

let installed = false;

function isGhostMesh(object: THREE.Object3D): object is THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  return object instanceof THREE.Mesh
    && object.name === GHOST_MESH_NAME
    && object.material instanceof THREE.MeshBasicMaterial;
}

function syncMaterialColor(source: THREE.MeshBasicMaterial, target: THREE.MeshBasicMaterial): void {
  target.color.copy(source.color);
}

function configureGhostFill(material: THREE.MeshBasicMaterial): void {
  let changed = false;
  material.name = "construction-ghost-fill";
  material.opacity = BASE_GHOST_OPACITY;
  changed = setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "transparent", true, "construction-ghost-fill") || changed;
  changed = setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "depthWrite", false, "construction-ghost-fill") || changed;
  changed = setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "depthTest", true, "construction-ghost-fill") || changed;
  changed = setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "side", THREE.DoubleSide, "construction-ghost-fill") || changed;
  changed = setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "blending", THREE.NormalBlending, "construction-ghost-fill") || changed;
  changed = setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "toneMapped", false, "construction-ghost-fill") || changed;
  if (changed) setMaterialNeedsUpdate(materialChurnDiagnostics, material, "construction-ghost-fill");
}

function createOuterGlow(source: THREE.MeshBasicMaterial, geometry: THREE.BufferGeometry): THREE.Mesh {
  const glowMaterial = trackedMeshBasicMaterial({
    color: source.color,
    transparent: true,
    opacity: BASE_GLOW_OPACITY,
    depthWrite: false,
    depthTest: true,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  }, "construction-ghost-outer-glow");
  glowMaterial.name = "construction-ghost-outer-glow-material";

  const glow = new THREE.Mesh(geometry, glowMaterial);
  glow.name = OUTER_GLOW_NAME;
  glow.scale.setScalar(GLOW_SCALE);
  glow.renderOrder = RENDER_ORDER - 1;
  glow.frustumCulled = false;
  return glow;
}

function attachColorSync(source: THREE.MeshBasicMaterial, glow: THREE.Mesh): void {
  const glowMaterial = glow.material;
  if (!(glowMaterial instanceof THREE.MeshBasicMaterial)) return;

  const originalSetHex = source.color.setHex.bind(source.color);
  source.color.setHex = ((hex: number, colorSpace?: THREE.ColorSpace) => {
    const result = colorSpace === undefined ? originalSetHex(hex) : originalSetHex(hex, colorSpace);
    syncMaterialColor(source, glowMaterial);
    return result;
  }) as typeof source.color.setHex;
}

function attachAnimation(mesh: THREE.Mesh, fill: THREE.MeshBasicMaterial, glow: THREE.Mesh): void {
  const glowMaterial = glow.material instanceof THREE.MeshBasicMaterial ? glow.material : null;
  const previousOnBeforeRender = mesh.onBeforeRender;
  mesh.onBeforeRender = (...args: Parameters<typeof previousOnBeforeRender>) => {
    previousOnBeforeRender.call(mesh, ...args);
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.001 * PULSE_SPEED);
    fill.opacity = BASE_GHOST_OPACITY + pulse * PULSE_GHOST_OPACITY;
    if (glowMaterial) glowMaterial.opacity = BASE_GLOW_OPACITY + pulse * PULSE_GLOW_OPACITY;
    glow.scale.setScalar(GLOW_SCALE + pulse * PULSE_GLOW_SCALE);
  };
}

function attachDisposeSync(source: THREE.MeshBasicMaterial, glow: THREE.Mesh): void {
  const glowMaterial = glow.material;
  const originalDispose = source.dispose.bind(source);
  source.dispose = () => {
    if (glowMaterial instanceof THREE.Material) glowMaterial.dispose();
    originalDispose();
  };
}

function enhanceConstructionGhost(object: THREE.Object3D): void {
  if (!isGhostMesh(object) || object.userData[GHOST_PATCH_FLAG] === true) return;

  const fill = object.material;
  materialChurnDiagnostics.trackNewMaterial(fill, "construction-ghost-fill-existing");
  configureGhostFill(fill);
  const glow = createOuterGlow(fill, object.geometry);
  object.renderOrder = RENDER_ORDER;
  object.frustumCulled = false;
  object.add(glow);
  attachColorSync(fill, glow);
  attachAnimation(object, fill, glow);
  attachDisposeSync(fill, glow);
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
