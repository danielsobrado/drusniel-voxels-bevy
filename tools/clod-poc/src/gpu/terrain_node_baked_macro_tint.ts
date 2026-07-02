import * as THREE from "three";

export function createBakedMacroTintTexture(noiseA: THREE.Texture, noiseB: THREE.Texture, res = 256): THREE.DataTexture {
  const imgA = noiseA.image as { data?: Uint8Array; width?: number; height?: number } | undefined;
  const imgB = noiseB.image as { data?: Uint8Array; width?: number; height?: number } | undefined;
  const srcA = imgA?.data;
  const srcB = imgB?.data;
  const srcRes = imgA?.width ?? 0;
  if (!srcA || !srcB || srcRes <= 0 || imgB?.width !== srcRes) {
    const fallback = new Uint8Array(res * res * 4);
    fallback.fill(255);
    return new THREE.DataTexture(fallback, res, res, THREE.RGBAFormat, THREE.UnsignedByteType);
  }
  const out = new Uint8Array(res * res * 4);
  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res; x++) {
      writeMacroTintPixel({ srcA, srcB, srcRes, out, res, x, z });
    }
  }
  const tex = new THREE.DataTexture(out, res, res, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

interface MacroTintPixelInput {
  srcA: Uint8Array;
  srcB: Uint8Array;
  srcRes: number;
  out: Uint8Array;
  res: number;
  x: number;
  z: number;
}

function writeMacroTintPixel(input: MacroTintPixelInput): void {
  const { srcA, srcB, srcRes, out, res, x, z } = input;
  const u = x / res;
  const v = z / res;
  const ax = Math.floor(u * srcRes) % srcRes;
  const az = Math.floor(v * srcRes) % srcRes;
  const ai = (az * srcRes + ax) * 4;
  const value = srcA[ai] / 255;
  const fbm = srcA[ai + 1] / 255;
  const bx = Math.floor(((u * (256 / 96)) + 0.37) * srcRes) % srcRes;
  const bz = Math.floor(((v * (256 / 96)) + 0.11) * srcRes) % srcRes;
  const bi = (bz * srcRes + bx) * 4;
  const worley = srcB[bi + 3] / 255;
  const macroMix = value * 0.65 + fbm * 0.35;
  const baseR = 0.30 * (macroMix - 0.5) * 0.16 + 1.0;
  const baseG = 0.34 * (macroMix - 0.5) * 0.16 + 1.0;
  const baseB = 0.22 * (macroMix - 0.5) * 0.16 + 1.0;
  const mossFactor = smoothstepF(0.58, 0.86, worley) * smoothstepF(0.28, 0.72, 0.3) * 0.28;
  let r = baseR * (1 - mossFactor) + 0.11 * mossFactor;
  let g = baseG * (1 - mossFactor) + 0.19 * mossFactor;
  let b = baseB * (1 - mossFactor) + 0.07 * mossFactor;
  const wetFactor = smoothstepF(0.04, 0.0, 0) * 0.38;
  r = r * (1 - wetFactor) + r * 0.64 * wetFactor;
  g = g * (1 - wetFactor) + g * 0.68 * wetFactor;
  b = b * (1 - wetFactor) + b * 0.72 * wetFactor;
  const oi = (z * res + x) * 4;
  out[oi] = Math.round(clamp01(r) * 255);
  out[oi + 1] = Math.round(clamp01(g) * 255);
  out[oi + 2] = Math.round(clamp01(b) * 255);
  out[oi + 3] = 255;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstepF(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
