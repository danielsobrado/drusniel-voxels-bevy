// Dithered (screen-door) crossfade material. Plan §4.2.
//
// Topology-changing decimation can't geomorph cheaply, so the PoC crossfades with a
// screen-door dither over `crossfade_frames` when the cut changes. Our terrain meshes
// carry WORLD-space normals, so lighting uses them directly (no normalMatrix).

import * as THREE from "three";

const VERT = /* glsl */ `
  varying vec3 vWorldNormal;
  void main() {
    vWorldNormal = normal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform vec3 uLight;
  uniform float uFade;   // 0 = fully dithered out, 1 = fully visible
  uniform bool uDither;
  uniform bool uNormalColor;
  varying vec3 vWorldNormal;

  // interleaved-gradient noise — cheap stable screen-door threshold
  float ign(vec2 p) {
    return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y));
  }
  void main() {
    if (uDither && ign(gl_FragCoord.xy) > uFade) discard;
    if (uNormalColor) {
      gl_FragColor = vec4(normalize(vWorldNormal) * 0.5 + 0.5, 1.0);
      return;
    }
    float d = max(dot(normalize(vWorldNormal), normalize(uLight)), 0.0);
    gl_FragColor = vec4(uColor * (0.35 + 0.65 * d), 1.0);
  }
`;

export function createTerrainMaterial(color: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uLight: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      uFade: { value: 1 },
      uDither: { value: false },
      uNormalColor: { value: false },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.DoubleSide,
  });
}
