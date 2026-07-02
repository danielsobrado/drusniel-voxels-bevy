import { EqualDepth, InstancedMesh, Mesh, type Material, type Side } from "three";
import { NodeMaterial, type WebGPURenderer } from "three/webgpu";
import {
  materialChurnDiagnostics,
  setMaterialNeedsUpdate,
  setPipelineSensitiveMaterialProperty,
} from "./material_churn/material_churn_diagnostics.js";
import { trackCreatedMaterial } from "./material_churn/tracked_material_factory.js";

const WGSL_ATTRIBUTE_PREFIX = String.fromCharCode(64);

export function installPositionInvariance(renderer: WebGPURenderer): void {
  const backend = renderer.backend as unknown as {
    createNodeBuilder(object: object, renderer: unknown): object;
  };
  const builder = backend.createNodeBuilder(new Mesh(), renderer);
  const proto = Object.getPrototypeOf(builder) as {
    _getWGSLVertexCode(data: unknown): string;
    __clodInvariant?: boolean;
  };
  if (proto.__clodInvariant === true) return;
  proto.__clodInvariant = true;
  const original = proto._getWGSLVertexCode;
  proto._getWGSLVertexCode = function (this: unknown, data: unknown): string {
    const clipPosition = `${WGSL_ATTRIBUTE_PREFIX}builtin( position ) builtinClipSpace`;
    return original.call(this, data).replace(
      clipPosition,
      `${WGSL_ATTRIBUTE_PREFIX}invariant ${clipPosition}`,
    );
  };
}

export interface PrepassNodes {
  positionNode: unknown;
  maskNode?: unknown;
  side: Side;
}

export interface DepthPrepassTwinOptions {
  cloneColorMaterial?: boolean;
}

interface NodeMaterialShape {
  positionNode: unknown;
  maskNode: unknown;
}

type UniformMaterialShape = Material & {
  uniforms?: unknown;
};

export function depthPrepassTwin(mesh: Mesh, nodes: PrepassNodes, options: DepthPrepassTwinOptions = {}): Mesh {
  const material = createPrepassNodeMaterial(nodes, `veg-depth-prepass:${mesh.name || "mesh"}`);

  const sourceMaterial = singleMeshMaterial(mesh);
  const colorMaterial = options.cloneColorMaterial === false
    ? sourceMaterial
    : cloneColorMaterialWithSharedUniforms(sourceMaterial, `veg-depth-prepass-color:${mesh.name || "mesh"}`);
  let colorMaterialChanged = false;
  colorMaterialChanged = setPipelineSensitiveMaterialProperty(
    materialChurnDiagnostics,
    colorMaterial,
    "depthFunc",
    EqualDepth,
    "veg-depth-prepass-color-depth-func",
  ) || colorMaterialChanged;
  colorMaterialChanged = setPipelineSensitiveMaterialProperty(
    materialChurnDiagnostics,
    colorMaterial,
    "depthWrite",
    false,
    "veg-depth-prepass-color-depth-write",
  ) || colorMaterialChanged;
  if (colorMaterialChanged) setMaterialNeedsUpdate(materialChurnDiagnostics, colorMaterial, "veg-depth-prepass-color");
  mesh.material = colorMaterial;

  const twin = new Mesh(mesh.geometry, material);
  twin.name = `${mesh.name}-depth-prepass`;
  twin.frustumCulled = false;
  twin.castShadow = false;
  twin.receiveShadow = false;
  twin.renderOrder = -100;

  return twin;
}

function singleMeshMaterial(mesh: Mesh): Material {
  if (Array.isArray(mesh.material)) {
    throw new Error(`Depth prepass requires a single material mesh: ${mesh.name || "unnamed mesh"}`);
  }
  return mesh.material;
}

function cloneColorMaterialWithSharedUniforms(sourceMaterial: Material, reason: string): Material {
  const clone = trackCreatedMaterial(sourceMaterial.clone(), reason);
  const sourceUniforms = (sourceMaterial as UniformMaterialShape).uniforms;
  if (sourceUniforms !== undefined) {
    (clone as UniformMaterialShape).uniforms = sourceUniforms;
  }
  return clone;
}

/**
 * TP-3: depth-only prepass twin for an `InstancedMesh` (the CPU/patch tree path).
 * Unlike `depthPrepassTwin` (plain `Mesh`), the twin must be an `InstancedMesh`
 * that shares the source `instanceMatrix` so per-instance transforms match. The
 * caller mirrors `count`/`visible` each frame (the patch mesh count changes) and
 * occluded fragments then fail the colour pass's depth test (default LessEqual)
 * and skip the heavy relight/transmission/forest shading — early-z for the near
 * canopy. Unlike `depthPrepassTwin` this does NOT mutate the colour material
 * (the CPU path shares one material across patches and re-applies it on refresh,
 * so an `EqualDepth` clone would be fragile); the twin writing depth first via
 * `renderOrder = -100` is enough to reject the overdraw.
 *
 * Caveat: the twin shares `instanceMatrix` with the source mesh, so disposing the
 * twin must NOT dispose that attribute (it belongs to the colour mesh).
 */
export function instancedDepthPrepassTwin(mesh: InstancedMesh, nodes: PrepassNodes): InstancedMesh {
  const material = createPrepassNodeMaterial(nodes, `veg-instanced-depth-prepass:${mesh.name || "instanced"}`);

  const twin = new InstancedMesh(mesh.geometry, material, mesh.instanceMatrix.count);
  twin.instanceMatrix = mesh.instanceMatrix; // share per-instance transforms
  twin.count = mesh.count;
  twin.name = `${mesh.name}-depth-prepass`;
  twin.frustumCulled = false;
  twin.castShadow = false;
  twin.receiveShadow = false;
  twin.renderOrder = -100;

  return twin;
}

function createPrepassNodeMaterial(nodes: PrepassNodes, reason: string): NodeMaterial {
  const material = trackCreatedMaterial(new NodeMaterial(), reason);
  const materialNodes = material as unknown as NodeMaterialShape;
  materialNodes.positionNode = nodes.positionNode;
  if (nodes.maskNode !== undefined) materialNodes.maskNode = nodes.maskNode;
  setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "side", nodes.side, `${reason}:side`);
  setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "colorWrite", false, `${reason}:color-write`);
  setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "depthWrite", true, `${reason}:depth-write`);
  setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "depthTest", true, `${reason}:depth-test`);
  return material;
}
