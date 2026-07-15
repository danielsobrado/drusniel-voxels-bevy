import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  clamp,
  float,
  Fn,
  mix,
  normalize,
  positionGeometry,
  sin,
  smoothstep,
  uniform,
  vec3,
  vec4,
} from "three/tsl";
import type { SpellColor } from "./spell_config.js";
import { createSpellEffectNoiseNodes } from "./spell_effect_noise.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

export interface FireballNodeMaterialHandle {
  material: MeshBasicNodeMaterial;
  uTime: { value: number };
  uOpacity: { value: number };
}

export function createFireballNodeMaterial(
  coreColor: SpellColor,
  glowColor: SpellColor,
): FireballNodeMaterialHandle {
  const uTime = uniform(0) as TslNode;
  const uOpacity = uniform(1) as TslNode;
  const { fbm, ridge } = createSpellEffectNoiseNodes({
    hashSeed: 619.184,
    fbmFreqMul: 2.08,
    fbmOffset: [4.7, 11.3, 2.9],
  });

  const fragment = Fn(() => {
    const surface: TslNode = normalize(positionGeometry);
    const flow: TslNode = vec3(
      surface.x.mul(3.4).add(uTime.mul(0.38)),
      surface.y.mul(4.1).sub(uTime.mul(2.9)),
      surface.z.mul(3.4).add(uTime.mul(0.52)),
    );
    const rolling: TslNode = fbm(flow);
    const fissures: TslNode = ridge(flow.mul(1.85).add(vec3(3.1, uTime.mul(-1.7), 5.4)));
    const pulse: TslNode = sin(uTime.mul(17).add(surface.y.mul(9))).mul(0.055).add(0.945);
    const hotMask: TslNode = smoothstep(0.38, 0.82, rolling.add(fissures.mul(0.24)));
    const whiteCore: TslNode = smoothstep(0.74, 1.0, rolling.add(fissures.mul(0.18)));
    let color: TslNode = mix(vec3(...glowColor), vec3(...coreColor), hotMask);
    color = mix(color, vec3(1.0, 0.97, 0.74), whiteCore.mul(0.72)).mul(pulse);
    const alpha: TslNode = clamp(
      float(0.54).add(hotMask.mul(0.34)).add(fissures.mul(0.12)).mul(uOpacity),
      0,
      1,
    );
    return vec4(color, alpha);
  })();

  const material = new MeshBasicNodeMaterial();
  material.name = "fireball-spell-node";
  material.colorNode = fragment.xyz;
  material.opacityNode = fragment.w;
  material.transparent = true;
  material.depthTest = true;
  material.depthWrite = false;
  material.side = THREE.FrontSide;
  material.blending = THREE.AdditiveBlending;
  material.toneMapped = false;

  return { material, uTime, uOpacity };
}
