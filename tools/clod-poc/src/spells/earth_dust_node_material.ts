import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  clamp,
  float,
  Fn,
  length,
  mix,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { createSpellEffectNoiseNodes } from "./spell_effect_noise.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

export interface EarthDustNodeMaterialParams {
  seed: number;
  opacity: number;
}

export interface EarthDustNodeMaterialHandle {
  material: MeshBasicNodeMaterial;
  uTime: { value: number };
  uProgress: { value: number };
}

const EARTH_DUST_NOISE = {
  hashSeed: 32991.43117,
  fbmFreqMul: 2.01,
  fbmOffset: [10.2, 3.7, 14.4] as [number, number, number],
};

export function createEarthDustNodeMaterial(params: EarthDustNodeMaterialParams): EarthDustNodeMaterialHandle {
  const uTime = uniform(0) as TslNode;
  const uProgress = uniform(0) as TslNode;
  const { billow, ridge, wavelet2 } = createSpellEffectNoiseNodes(EARTH_DUST_NOISE);
  const seed = float(params.seed);
  const opacity = float(params.opacity);

  const fragment = Fn(() => {
    const uvN: TslNode = uv();
    const p: TslNode = uvN.sub(vec2(0.5, 0.5));
    const r: TslNode = length(p).mul(2.0);
    const castIn: TslNode = smoothstep(0.0, 0.10, uProgress);
    const fadeOut: TslNode = float(1).sub(smoothstep(0.55, 1.0, uProgress));
    const life: TslNode = castIn.mul(fadeOut);
    const expansion: TslNode = mix(float(0.42), float(1.12), smoothstep(0.0, 0.78, uProgress));
    const softDisc: TslNode = float(1).sub(smoothstep(expansion.mul(0.54), expansion, r));
    const centerVoid: TslNode = smoothstep(0.05, 0.24, r);

    const drift: TslNode = vec2(uTime.mul(0.17).add(seed.mul(0.11)), uTime.mul(-0.10).add(seed.mul(0.07)));
    const coarse: TslNode = billow(vec3(p.x.mul(2.4).add(seed), p.y.mul(2.2).sub(seed.mul(0.4)), uTime.mul(0.58)));
    const rolling: TslNode = ridge(vec3(p.x.mul(4.2).add(drift.x), p.y.mul(3.6).add(drift.y), uTime.mul(0.82).add(seed)));
    const wisps: TslNode = wavelet2(p.mul(3.4).add(drift), uTime.mul(4.2).add(seed));
    const breakup: TslNode = smoothstep(0.20, 0.95, coarse.mul(0.55).add(rolling.mul(0.30)).add(wisps.mul(0.18)));
    const rimLift: TslNode = smoothstep(0.16, 0.72, r).mul(float(1).sub(smoothstep(0.76, 1.12, r)));

    const alpha: TslNode = clamp(
      softDisc
        .mul(centerVoid)
        .mul(breakup.mul(0.72).add(0.20))
        .mul(rimLift.mul(0.44).add(0.58))
        .mul(life)
        .mul(opacity),
      0.0,
      0.72,
    );
    const darkDust: TslNode = vec3(0.22, 0.16, 0.10);
    const warmDust: TslNode = vec3(0.56, 0.43, 0.28);
    const paleDust: TslNode = vec3(0.78, 0.67, 0.48);
    let color: TslNode = mix(darkDust, warmDust, coarse);
    color = mix(color, paleDust, wisps.mul(0.35).add(uProgress.mul(0.18)));
    color = color.add(vec3(0.18, 0.11, 0.05).mul(rolling).mul(0.20));
    return vec4(color, alpha);
  })();

  const material = new MeshBasicNodeMaterial();
  material.name = "earth-spell-dust-node";
  material.colorNode = fragment.xyz;
  material.opacityNode = fragment.w;
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = THREE.FrontSide;
  material.blending = THREE.NormalBlending;
  material.toneMapped = false;

  return { material, uTime, uProgress };
}
