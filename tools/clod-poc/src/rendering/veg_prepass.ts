import { EqualDepth, InstancedMesh, Mesh, type Material, type Side } from "three";
import { NodeMaterial, type WebGPURenderer } from "three/webgpu";

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

interface NodeMaterialShape {
  positionNode: unknown;
  maskNode: unknown;
}

export function depthPrepassTwin(mesh: Mesh, nodes: PrepassNodes): Mesh {
  const material = new NodeMaterial();
  const materialNodes = material as unknown as NodeMaterialShape;
  materialNodes.positionNode = nodes.positionNode;
  if (nodes.maskNode !== undefined) materialNodes.maskNode = nodes.maskNode;
  material.side = nodes.side;
  material.colorWrite = false;
  material.depthWrite = true;
  material.depthTest = true;

  const colorMaterial = (mesh.material as Material).clone();
  colorMaterial.depthFunc = EqualDepth;
  colorMaterial.depthWrite = false;
  mesh.material = colorMaterial;

  const twin = new Mesh(mesh.geometry, material);
  twin.name = `${mesh.name}-depth-prepass`;
  twin.frustumCulled = false;
  twin.castShadow = false;
  twin.receiveShadow = false;
  twin.renderOrder = -100;

  return twin;
}

/**
 * TP-3: depth-only prepass twin for an `InstancedMesh` (the CPU/patch tree path).
 * Unlike `depthPrepassTwin` (plain `Mesh`), the twin must be an `InstancedMesh`
 * that shares the source `instanceMatrix` so per-instance transforms match. The
 * caller mirrors `count`/`visible` each frame (the patch mesh count changes) and
 * sets the colour material to `depthFunc: EqualDepth` + `depthWrite: false` so
 * only the front-most fragment is shaded — early-z for the near canopy.
 *
 * Caveat: the twin shares `instanceMatrix` with the source mesh, so disposing the
 * twin must NOT dispose that attribute (it belongs to the colour mesh).
 */
export function instancedDepthPrepassTwin(mesh: InstancedMesh, nodes: PrepassNodes): InstancedMesh {
  const material = new NodeMaterial();
  const materialNodes = material as unknown as NodeMaterialShape;
  materialNodes.positionNode = nodes.positionNode;
  if (nodes.maskNode !== undefined) materialNodes.maskNode = nodes.maskNode;
  material.side = nodes.side;
  material.colorWrite = false;
  material.depthWrite = true;
  material.depthTest = true;

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
