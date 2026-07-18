import { EqualDepth, InstancedMesh, Mesh, type Material, type Side } from "three";
import { NodeMaterial, type WebGPURenderer } from "three/webgpu";
import {
  applyMaterialIfChanged,
  materialChurnDiagnostics,
  setMaterialNeedsUpdate,
  setPipelineSensitiveMaterialProperty,
} from "./material_churn/material_churn_diagnostics.js";
import { trackCreatedMaterial } from "./material_churn/tracked_material_factory.js";

const WGSL_ATTRIBUTE_PREFIX = String.fromCharCode(64);
const DEPTH_PREPASS_REQUESTED_KEY = "depthPrepassRequested";

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
  applyMaterialIfChanged(materialChurnDiagnostics, mesh.uuid, mesh, colorMaterial, "veg-depth-prepass-color");

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
  twin.instanceMatrix = mesh.instanceMatrix;
  twin.count = mesh.count;
  twin.name = `${mesh.name}-depth-prepass`;
  twin.frustumCulled = false;
  twin.castShadow = false;
  twin.receiveShadow = false;
  twin.renderOrder = -100;
  mesh.userData[DEPTH_PREPASS_REQUESTED_KEY] = true;

  return twin;
}

export function refreshInstancedDepthPrepassTwin(
  mesh: InstancedMesh,
  nodes: PrepassNodes | undefined,
): InstancedMesh | undefined {
  const previous = mesh.userData.depthTwin as InstancedMesh | undefined;
  const requested = previous !== undefined || mesh.userData[DEPTH_PREPASS_REQUESTED_KEY] === true;
  if (!requested) return undefined;

  if (!nodes) {
    if (previous) {
      previous.parent?.remove(previous);
      singleMeshMaterial(previous).dispose();
      previous.dispose();
      delete mesh.userData.depthTwin;
    }
    return undefined;
  }

  if (!previous) {
    const next = instancedDepthPrepassTwin(mesh, nodes);
    next.visible = mesh.visible;
    mesh.parent?.add(next);
    mesh.userData.depthTwin = next;
    return next;
  }

  const previousMaterial = singleMeshMaterial(previous);
  const previousNodes = previousMaterial as unknown as NodeMaterialShape;
  if (
    previousNodes.positionNode === nodes.positionNode &&
    (previousNodes.maskNode ?? undefined) === nodes.maskNode &&
    previousMaterial.side === nodes.side
  ) {
    previous.geometry = mesh.geometry;
    previous.instanceMatrix = mesh.instanceMatrix;
    previous.count = mesh.count;
    previous.visible = mesh.visible;
    return previous;
  }

  const parent = previous.parent ?? mesh.parent;
  const next = instancedDepthPrepassTwin(mesh, nodes);
  next.visible = mesh.visible;
  parent?.remove(previous);
  parent?.add(next);
  previousMaterial.dispose();
  previous.dispose();
  mesh.userData.depthTwin = next;
  return next;
}

function createPrepassNodeMaterial(nodes: PrepassNodes, reason: string): NodeMaterial {
  const material = trackCreatedMaterial(new NodeMaterial(), reason);
  const materialNodes = material as unknown as NodeMaterialShape;
  materialNodes.positionNode = nodes.positionNode;
  if (nodes.maskNode !== undefined) materialNodes.maskNode = nodes.maskNode;
  material.side = nodes.side;
  material.colorWrite = false;
  material.depthWrite = true;
  material.depthTest = true;
  return material;
}
