import { EqualDepth, Mesh, type Material, type Side } from "three";
import { NodeMaterial, type WebGPURenderer } from "three/webgpu";

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
    return original.call(this, data).replace(
      "@builtin( position ) builtinClipSpace",
      "@invariant @builtin( position ) builtinClipSpace",
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

  const twin = new Mesh(mesh.geometry, material);
  twin.name = `${mesh.name}-depth-prepass`;
  twin.frustumCulled = false;
  twin.castShadow = false;
  twin.receiveShadow = false;
  twin.renderOrder = -100;

  const colorMaterial = mesh.material as Material;
  colorMaterial.depthFunc = EqualDepth;
  colorMaterial.depthWrite = false;
  return twin;
}
