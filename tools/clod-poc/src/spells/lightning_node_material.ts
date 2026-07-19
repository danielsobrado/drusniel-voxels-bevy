import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  abs,
  clamp,
  float,
  Fn,
  max,
  mix,
  pow,
  sin,
  smoothstep,
  uniform,
  uv,
  vec3,
  vec4,
} from "three/tsl";
import type { SpellColor } from "./spell_config.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

export interface LightningArcNodeMaterialParams {
  name: string;
  coreColor: SpellColor;
  edgeColor: SpellColor;
  opacity: number;
  softness: number;
}

export interface LightningArcNodeMaterialHandle {
  material: MeshBasicNodeMaterial;
  uTime: { value: number };
  uOpacity: { value: number };
}

export function createLightningArcNodeMaterial(
  params: LightningArcNodeMaterialParams,
): LightningArcNodeMaterialHandle {
  const uTime = uniform(0) as TslNode;
  const uOpacity = uniform(params.opacity) as TslNode;
  const coreColor = vec3(...params.coreColor);
  const edgeColor = vec3(...params.edgeColor);
  const softness = float(Math.max(0.25, params.softness));

  const fragment = Fn(() => {
    const uvN: TslNode = uv();
    const across: TslNode = abs(uvN.x.mul(2).sub(1));
    const softEdge: TslNode = float(1).sub(smoothstep(0.0, 1.0, across));
    const filament: TslNode = pow(max(softEdge, 0), softness);
    const currentRipple: TslNode = sin(uvN.y.mul(91).sub(uTime.mul(47))).mul(0.055).add(0.945);
    const intensity: TslNode = filament.mul(currentRipple).mul(uOpacity);
    const hotCenter: TslNode = pow(filament, 0.42);
    const color: TslNode = mix(edgeColor, coreColor, hotCenter).mul(currentRipple.add(0.08));
    return vec4(color, clamp(intensity, 0, 1));
  })();

  const material = new MeshBasicNodeMaterial();
  material.name = params.name;
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
