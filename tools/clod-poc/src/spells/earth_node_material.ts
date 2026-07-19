import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  abs,
  clamp,
  float,
  Fn,
  length,
  max,
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

export interface EarthNodeMaterialHandle {
  material: MeshBasicNodeMaterial;
  uTime: { value: number };
  uProgress: { value: number };
}

const EARTH_NOISE = {
  hashSeed: 18419.21345,
  fbmFreqMul: 2.04,
  fbmOffset: [6.2, 11.7, 3.4] as [number, number, number],
};

function radialRing(r: TslNode, radius: TslNode, thickness: TslNode): TslNode {
  return float(1).sub(smoothstep(thickness, thickness.mul(2.0), abs(r.sub(radius))));
}

export function createEarthNodeMaterial(): EarthNodeMaterialHandle {
  const uTime = uniform(0) as TslNode;
  const uProgress = uniform(0) as TslNode;
  const { ridge, billow, gabor2, wavelet2, ringCells2 } = createSpellEffectNoiseNodes(EARTH_NOISE);

  const fragment = Fn(() => {
    const uvN: TslNode = uv();
    const p: TslNode = uvN.sub(vec2(0.5, 0.5));
    const r: TslNode = length(p).mul(2.0);
    const inside: TslNode = float(1).sub(smoothstep(0.96, 1.0, r));
    const castIn: TslNode = smoothstep(0.0, 0.10, uProgress);
    const fadeOut: TslNode = float(1).sub(smoothstep(0.78, 1.0, uProgress));
    const life: TslNode = castIn.mul(fadeOut).mul(inside);

    const crackNoise: TslNode = ridge(vec3(p.x.mul(9.0), p.y.mul(9.0), 1.0));
    const fractureBands: TslNode = gabor2(p.mul(8.0), uTime.mul(0.12));
    const cells: TslNode = ringCells2(p.mul(12.0));
    const cracks: TslNode = smoothstep(0.70, 1.03, crackNoise.add(fractureBands.mul(0.18)).add(cells.mul(0.22)))
      .mul(float(1).sub(smoothstep(0.88, 1.0, r)))
      .mul(life);

    const shockRadius: TslNode = smoothstep(0.0, 0.42, uProgress).mul(0.88);
    const shock: TslNode = radialRing(r, shockRadius, float(0.035))
      .mul(float(1).sub(smoothstep(0.82, 1.0, r)))
      .mul(life);

    const wave: TslNode = wavelet2(p.mul(5.0), uTime.mul(6.0));
    const dustVolume: TslNode = billow(vec3(p.x.mul(3.0), p.y.mul(3.0), uTime.mul(1.4)));
    const dustRing: TslNode = radialRing(r, shockRadius.add(0.08), float(0.16));
    const dust: TslNode = smoothstep(0.30, 0.78, dustVolume.add(wave.mul(0.18)))
      .mul(dustRing)
      .mul(float(1).sub(smoothstep(0.68, 1.0, uProgress)))
      .mul(life);

    const ground: TslNode = vec3(0.16, 0.11, 0.075);
    const crackColor: TslNode = vec3(0.04, 0.025, 0.016);
    const freshEarth: TslNode = vec3(0.46, 0.30, 0.16);
    const dustColor: TslNode = vec3(0.58, 0.44, 0.28);
    let color: TslNode = mix(ground, freshEarth, max(shock.mul(0.7), cells.mul(0.25).mul(life)));
    color = mix(color, crackColor, cracks);
    color = color.add(dustColor.mul(dust).mul(0.48));
    color = color.add(vec3(0.75, 0.45, 0.18).mul(shock).mul(0.20));

    const alpha: TslNode = clamp(
      cracks.mul(0.78)
        .add(shock.mul(0.34))
        .add(dust.mul(0.36)),
      0.0,
      0.88,
    );
    return vec4(color, alpha);
  })();

  const material = new MeshBasicNodeMaterial();
  material.name = "earth-spell-ground-node";
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
