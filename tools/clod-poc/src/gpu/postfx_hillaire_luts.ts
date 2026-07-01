import * as THREE from "three";
import type { PostFxHillaireSettings, PostFxColor } from "./postfx_atmosphere.js";

export const POSTFX_HILLAIRE_LUT_SIZES = {
  transmittance: { width: 256, height: 64 },
  multiScatter: { width: 32, height: 32 },
  skyView: { width: 192, height: 108 },
} as const;

export interface PostFxHillaireLutNodeInput {
  transmittanceTexture: THREE.DataTexture;
  multiScatterTexture: THREE.DataTexture;
  skyViewTexture: THREE.DataTexture;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function color3(color: PostFxColor, scale = 1): [number, number, number] {
  return [color[0] * scale, color[1] * scale, color[2] * scale];
}

function createRgbaTexture(name: string, width: number, height: number, fill: (u: number, v: number) => [number, number, number, number]): THREE.DataTexture {
  const data = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fill((x + 0.5) / width, (y + 0.5) / height);
      const base = (y * width + x) * 4;
      data[base] = r;
      data[base + 1] = g;
      data[base + 2] = b;
      data[base + 3] = a;
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.name = name;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

export class PostFxHillaireLuts {
  readonly transmittanceTexture: THREE.DataTexture;
  readonly multiScatterTexture: THREE.DataTexture;
  readonly skyViewTexture: THREE.DataTexture;

  constructor(settings: PostFxHillaireSettings) {
    const rayleigh = color3(settings.rayleighColor);
    const mie = color3(settings.mieColor);
    const rayleighExtinction = settings.rayleighExtinction;
    const mieExtinction = settings.mieExtinction;

    this.transmittanceTexture = createRgbaTexture(
      "postfx-hillaire-transmittance",
      POSTFX_HILLAIRE_LUT_SIZES.transmittance.width,
      POSTFX_HILLAIRE_LUT_SIZES.transmittance.height,
      (u, v) => {
        const sunMu = u * 2 - 1;
        const heightMeters = v * 40000;
        const rayleighDensity = Math.exp(-heightMeters / Math.max(1, settings.rayleighScaleHeightMeters));
        const mieDensity = Math.exp(-heightMeters / Math.max(1, settings.mieScaleHeightMeters));
        const horizonPenalty = 1 / Math.max(0.08, sunMu * 0.72 + 0.28);
        const opticalDepth = Math.max(0, horizonPenalty) * (rayleighDensity * rayleighExtinction + mieDensity * mieExtinction) * 8500;
        const tr = Math.exp(-opticalDepth * 0.42);
        const tg = Math.exp(-opticalDepth * 0.55);
        const tb = Math.exp(-opticalDepth * 0.82);
        return [clamp01(tr), clamp01(tg), clamp01(tb), 1];
      },
    );

    this.multiScatterTexture = createRgbaTexture(
      "postfx-hillaire-multiscatter",
      POSTFX_HILLAIRE_LUT_SIZES.multiScatter.width,
      POSTFX_HILLAIRE_LUT_SIZES.multiScatter.height,
      (u, v) => {
        const sunLift = clamp01((u * 2 - 0.15) / 1.85);
        const heightFade = Math.exp(-(v * 40000) / Math.max(1, settings.rayleighScaleHeightMeters * 2.2));
        const amount = (0.035 + 0.12 * sunLift) * heightFade * settings.strength;
        return [
          clamp01(rayleigh[0] * amount + mie[0] * amount * 0.25),
          clamp01(rayleigh[1] * amount + mie[1] * amount * 0.25),
          clamp01(rayleigh[2] * amount + mie[2] * amount * 0.25),
          1,
        ];
      },
    );

    this.skyViewTexture = createRgbaTexture(
      "postfx-hillaire-sky-view",
      POSTFX_HILLAIRE_LUT_SIZES.skyView.width,
      POSTFX_HILLAIRE_LUT_SIZES.skyView.height,
      (u, v) => {
        const viewUp = v * 2 - 1;
        const sunForward = Math.max(0, 1 - Math.abs(u - 0.5) * 2);
        const horizon = Math.exp(-Math.abs(viewUp) * 2.4);
        const zenith = clamp01(viewUp);
        const amount = settings.strength * (0.018 + horizon * 0.045 + zenith * 0.028);
        const warm = Math.pow(sunForward, 6) * horizon * settings.strength * 0.18;
        return [
          clamp01(rayleigh[0] * amount + mie[0] * warm),
          clamp01(rayleigh[1] * amount + mie[1] * warm),
          clamp01(rayleigh[2] * amount + mie[2] * warm),
          1,
        ];
      },
    );
  }

  nodeInput(): PostFxHillaireLutNodeInput {
    return {
      transmittanceTexture: this.transmittanceTexture,
      multiScatterTexture: this.multiScatterTexture,
      skyViewTexture: this.skyViewTexture,
    };
  }

  dispose(): void {
    this.transmittanceTexture.dispose();
    this.multiScatterTexture.dispose();
    this.skyViewTexture.dispose();
  }
}
