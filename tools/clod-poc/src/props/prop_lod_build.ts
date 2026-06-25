import * as THREE from "three";
import type { PropAssetDef } from "./prop_types.js";
import {
  bufferGeometryToPropMesh,
  initPropSimplifier,
  propMeshToBufferGeometry,
  propTriangleCount,
  simplifyPropMesh,
  type PropMeshData,
} from "./prop_mesh_simplify.js";
import { createPropBillboardGeometry } from "./prop_billboard.js";

export interface PropLodLevel {
  lod: number;
  geometry: THREE.BufferGeometry;
  triangleCount: number;
  errorWorld: number;
}

export interface PropLodChain {
  levels: PropLodLevel[];
  billboardGeometry: THREE.BufferGeometry | null;
}

function cloneMeshData(mesh: PropMeshData): PropMeshData {
  return {
    positions: new Float32Array(mesh.positions),
    normals: new Float32Array(mesh.normals),
    indices: new Uint32Array(mesh.indices),
  };
}

export async function buildPropLodChain(
  sourceGeometry: THREE.BufferGeometry,
  def: PropAssetDef,
  boundsRadius: number,
): Promise<PropLodChain> {
  await initPropSimplifier();
  const source = bufferGeometryToPropMesh(sourceGeometry);
  const ratios = def.lod.triangleRatios;
  const levels: PropLodLevel[] = [];

  for (let lod = 0; lod < ratios.length; lod++) {
    const ratio = ratios[lod] ?? 1;
    let mesh: PropMeshData;
    let errorWorld = 0;
    if (lod === 0 || ratio >= 0.999) {
      mesh = cloneMeshData(source);
    } else {
      const simplified = simplifyPropMesh(source, ratio);
      mesh = {
        positions: simplified.positions,
        normals: simplified.normals,
        indices: simplified.indices,
      };
      errorWorld = simplified.errorWorld;
    }
    levels.push({
      lod,
      geometry: propMeshToBufferGeometry(mesh),
      triangleCount: propTriangleCount(mesh),
      errorWorld,
    });
  }

  const billboardGeometry =
    def.lod.billboardFrom !== undefined ? createPropBillboardGeometry(boundsRadius * 2, boundsRadius * 2.4) : null;

  return { levels, billboardGeometry };
}
