import * as THREE from "three";
import { generateDitherPattern } from "./clodCrossfade.js";

const DITHER_SIZE = 16;

let sharedDitherTexture: THREE.DataTexture | null = null;

function getDitherTexture(): THREE.DataTexture {
  if (!sharedDitherTexture) {
    const pattern = generateDitherPattern(DITHER_SIZE);
    sharedDitherTexture = new THREE.DataTexture(pattern, DITHER_SIZE, DITHER_SIZE, THREE.RedFormat);
    sharedDitherTexture.needsUpdate = true;
    sharedDitherTexture.wrapS = THREE.RepeatWrapping;
    sharedDitherTexture.wrapT = THREE.RepeatWrapping;
    sharedDitherTexture.magFilter = THREE.NearestFilter;
    sharedDitherTexture.minFilter = THREE.NearestFilter;
  }
  return sharedDitherTexture;
}

export function createClodDitherMaterial(_baseMaterial?: THREE.Material): THREE.ShaderMaterial {
  const ditherTex = getDitherTexture();

  const uniforms: Record<string, THREE.IUniform> = {
    uFadeAlpha: { value: 1.0 },
    uDitherRole: { value: 0 },
    uDitherTexture: { value: ditherTex },
    uDitherSize: { value: DITHER_SIZE },
  };

  const vertexShader = `
    varying vec3 vPosition;
    void main() {
      vPosition = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const fragmentShader = `
    uniform float uFadeAlpha;
    uniform int uDitherRole;
    uniform sampler2D uDitherTexture;
    uniform float uDitherSize;

    varying vec3 vPosition;

    void main() {
      // Role: 0 = stable, 1 = fade-in, 2 = fade-out
      if (uDitherRole == 0) {
        // Stable — fully opaque
        gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
        return;
      }

      // Screen-door dither for transitions
      vec2 screenUV = gl_FragCoord.xy / uDitherSize;
      float dither = texture2D(uDitherTexture, screenUV).r;
      float threshold = dither / 16.0;

      if (uDitherRole == 1) {
        // Fade-in: visible where dither < fadeAlpha
        if (threshold > uFadeAlpha) discard;
        gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
      } else {
        // Fade-out: visible where dither > (1 - fadeAlpha)
        if (threshold > 1.0 - uFadeAlpha) discard;
        gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
      }
    }
  `;

  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: false,
    side: THREE.DoubleSide,
    depthWrite: true,
  });
}

export function updateDitherUniforms(
  material: THREE.ShaderMaterial,
  alpha: number,
  role: "stable" | "fade-in" | "fade-out",
): void {
  if (!material.uniforms) return;
  material.uniforms.uFadeAlpha.value = alpha;
  material.uniforms.uDitherRole.value = role === "stable" ? 0 : role === "fade-in" ? 1 : 2;
}
