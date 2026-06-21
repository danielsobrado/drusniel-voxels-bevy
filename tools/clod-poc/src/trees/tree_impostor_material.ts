import * as THREE from "three";
import type { TreeSettings } from "./tree_config.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";

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
