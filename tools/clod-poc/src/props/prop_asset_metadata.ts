import * as THREE from "three";
import type { PropAssetDef, PropAssetMetadata, PropBoundsSnapshot, PropLodAvailability } from "./prop_types.js";

function snapshotBounds(box: THREE.Box3): PropBoundsSnapshot {
  const center = new THREE.Vector3();
  const sphere = new THREE.Sphere();
  box.getCenter(center);
  box.getBoundingSphere(sphere);
  return {
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
    center: [center.x, center.y, center.z],
    radius: sphere.radius,
  };
}

function isAlphaMaterial(material: THREE.Material): boolean {
  if (material.transparent) return true;
  if ("alphaTest" in material && typeof material.alphaTest === "number" && material.alphaTest > 0) return true;
  if ("opacity" in material && typeof material.opacity === "number" && material.opacity < 1) return true;
  return false;
}

function textureMaxDimension(texture: THREE.Texture | null | undefined): number {
  if (!texture?.image) return 0;
  const image = texture.image as { width?: number; height?: number };
  return Math.max(image.width ?? 0, image.height ?? 0);
}

function meshScaleUniform(mesh: THREE.Mesh): boolean {
  const scale = mesh.scale;
  const eps = 1e-4;
  return Math.abs(scale.x - scale.y) <= eps && Math.abs(scale.y - scale.z) <= eps;
}

export function extractPropAssetMetadata(
  root: THREE.Object3D,
  def: PropAssetDef,
  options?: { lodAvailability?: PropLodAvailability },
): PropAssetMetadata {
  const bounds = new THREE.Box3();
  const materials = new Set<THREE.Material>();
  let meshCount = 0;
  let triangleCount = 0;
  let drawCallParts = 0;
  let hasAlphaMaterial = false;
  let hasNormals = true;
  let hasAnimation = false;
  let hasCollisionMesh = false;
  let maxTextureSize = 0;
  let scaleUniform = true;

  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    if (obj instanceof THREE.SkinnedMesh || (obj as THREE.Object3D & { isBone?: boolean }).isBone) {
      hasAnimation = true;
    }
    if (!(obj instanceof THREE.Mesh)) return;
    meshCount += 1;
    drawCallParts += 1;
    if (!scaleUniform || !meshScaleUniform(obj)) scaleUniform = false;

    const geom = obj.geometry as THREE.BufferGeometry | undefined;
    if (!geom) return;
    if (!geom.attributes.normal) hasNormals = false;
    const pos = geom.attributes.position;
    if (pos) {
      const index = geom.index;
      triangleCount += index ? index.count / 3 : pos.count / 3;
    }

    const name = obj.name.toLowerCase();
    if (name.includes("collision") || name.includes("collider")) hasCollisionMesh = true;

    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!mat) continue;
      materials.add(mat);
      if (isAlphaMaterial(mat)) hasAlphaMaterial = true;
      const matRecord = mat as THREE.MeshStandardMaterial;
      maxTextureSize = Math.max(
        maxTextureSize,
        textureMaxDimension(matRecord.map),
        textureMaxDimension(matRecord.normalMap),
        textureMaxDimension(matRecord.roughnessMap),
        textureMaxDimension(matRecord.metalnessMap),
        textureMaxDimension(matRecord.alphaMap),
      );
    }

    const meshBounds = new THREE.Box3().setFromObject(obj);
    if (!meshBounds.isEmpty()) bounds.union(meshBounds);
  });

  if (bounds.isEmpty()) {
    bounds.set(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0));
  }

  const localBounds = snapshotBounds(bounds);
  return {
    id: def.id,
    sourcePath: def.source,
    meshCount,
    materialCount: materials.size,
    localBounds,
    boundingSphereRadius: localBounds.radius,
    triangleCount: Math.round(triangleCount),
    hasAlphaMaterial,
    hasAnimation,
    hasCollisionMesh,
    lodAvailability: options?.lodAvailability ?? (def.lod.mode === "provided" ? "provided" : "generated"),
    drawCallParts,
    maxTextureSize,
    hasNormals,
    scaleUniform,
  };
}
