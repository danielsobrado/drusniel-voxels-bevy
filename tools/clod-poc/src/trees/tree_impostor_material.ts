import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { attribute, texture, uv } from "three/tsl";
import type { TreeSettings } from "./tree_config.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

/**
 * WebGPU node-material twin of the classic impostor ShaderMaterial. WebGPURenderer
 * rejects raw `ShaderMaterial` ("Material ShaderMaterial is not compatible"), which
 * rendered the billboard impostor LOD black. Same behaviour as the GLSL version:
 * sample the octahedral atlas at the per-instance `treeImpostorUvRect` frame and
 * alpha-test. instanceMatrix (axial billboard) is applied automatically.
 */
export function createTreeImpostorNodeMaterial(
  settings: TreeSettings,
  atlas: TreeImpostorAtlas,
): THREE.Material {
  const uvRect: TslNode = attribute("treeImpostorUvRect", "vec4");
  const atlasUv: TslNode = uvRect.xy.add(uv().mul(uvRect.zw.sub(uvRect.xy)));
  const sample: TslNode = texture(atlas.texture, atlasUv);
  const material = new MeshBasicNodeMaterial();
  material.colorNode = sample.xyz;
  (material as unknown as { opacityNode: TslNode }).opacityNode = sample.w;
  material.alphaTest = settings.impostors.alphaTest;
  material.side = THREE.DoubleSide;
  material.transparent = false;
  material.depthWrite = true;
  return material;
}

export function createTreeImpostorMaterial(
  settings: TreeSettings,
  atlas: TreeImpostorAtlas,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: `tree-impostor-${atlas.species}`,
    uniforms: {
      map: { value: atlas.texture },
      alphaTest: { value: settings.impostors.alphaTest },
    },
    vertexShader: TREE_IMPOSTOR_VERTEX_SHADER,
    fragmentShader: TREE_IMPOSTOR_FRAGMENT_SHADER,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
  });
}

export function updateTreeImpostorMaterialSettings(material: THREE.Material, settings: TreeSettings): void {
  if (material instanceof THREE.ShaderMaterial && "alphaTest" in material.uniforms) {
    material.uniforms.alphaTest.value = settings.impostors.alphaTest;
  } else {
    material.alphaTest = settings.impostors.alphaTest;
  }
  material.side = THREE.DoubleSide;
  material.transparent = false;
  material.depthWrite = true;
  material.needsUpdate = true;
}

export const TREE_IMPOSTOR_VERTEX_SHADER = `
attribute vec4 treeImpostorUvRect;
varying vec2 vTreeImpostorUv;

void main() {
  vec2 atlasScale = treeImpostorUvRect.zw - treeImpostorUvRect.xy;
  vTreeImpostorUv = treeImpostorUvRect.xy + uv * atlasScale;
  vec4 transformed = vec4(position, 1.0);
#ifdef USE_INSTANCING
  transformed = instanceMatrix * transformed;
#endif
  gl_Position = projectionMatrix * modelViewMatrix * transformed;
}
`;

export const TREE_IMPOSTOR_FRAGMENT_SHADER = `
uniform sampler2D map;
uniform float alphaTest;
varying vec2 vTreeImpostorUv;

void main() {
  vec4 color = texture2D(map, vTreeImpostorUv);
  if (color.a < alphaTest) discard;
  gl_FragColor = color;
}
`;
