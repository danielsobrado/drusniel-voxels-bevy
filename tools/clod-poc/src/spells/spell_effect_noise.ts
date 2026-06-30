import { abs, dot, float, floor, fract, sin, smoothstep, vec2, vec3 } from "three/tsl";
import { createSpellNoiseNodes, type SpellNoiseParams } from "./spell_noise_nodes.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const TAU = 6.28318530718;
const HALF_PI = 1.57079632679;

export interface SpellEffectNoiseNodes {
  noise: (x: TslNode) => TslNode;
  fbm: (p: TslNode) => TslNode;
  ridge: (p: TslNode) => TslNode;
  billow: (p: TslNode) => TslNode;
  ign2: (p: TslNode) => TslNode;
  gabor2: (p: TslNode, time: TslNode) => TslNode;
  wavelet2: (p: TslNode, phase: TslNode) => TslNode;
  ringCells2: (p: TslNode) => TslNode;
}

export function createSpellEffectNoiseNodes(params: SpellNoiseParams): SpellEffectNoiseNodes {
  const base = createSpellNoiseNodes(params);
  const ridge = (p: TslNode): TslNode => float(1).sub(abs(base.fbm(p).mul(2).sub(1)));
  const billow = (p: TslNode): TslNode => abs(base.fbm(p).mul(2).sub(1));
  const ign2 = (p: TslNode): TslNode => fract(float(52.9829189).mul(fract(dot(p, vec2(0.06711056, 0.00583715)))));

  const gabor2 = (p: TslNode, time: TslNode): TslNode => {
    const warp: TslNode = base.fbm(vec3(p.x.mul(0.72), p.y.mul(0.72), time.mul(0.35))).mul(TAU);
    const a: TslNode = sin(dot(p, vec2(12.3, 5.1)).add(warp).add(time.mul(3.0)));
    const b: TslNode = sin(dot(p, vec2(-4.9, 15.7)).sub(time.mul(1.7)));
    return a.mul(b).mul(0.5).add(0.5);
  };

  const wavelet2 = (p: TslNode, phase: TslNode): TslNode => {
    const cell: TslNode = floor(p);
    const local: TslNode = fract(p).sub(0.5);
    const seed: TslNode = base.noise(vec3(cell.x, cell.y, 7.0));
    const angle: TslNode = seed.mul(TAU);
    const waveCoord: TslNode = local.x.mul(sin(angle.add(HALF_PI))).add(local.y.mul(sin(angle)));
    const falloff: TslNode = float(1).sub(smoothstep(0.02, 0.34, dot(local, local)));
    return sin(waveCoord.mul(18.0).add(phase).add(seed.mul(TAU))).mul(falloff).mul(0.5).add(0.5);
  };

  const ringCells2 = (p: TslNode): TslNode => {
    const cell: TslNode = floor(p);
    const local: TslNode = fract(p).sub(0.5);
    const seed: TslNode = base.noise(vec3(cell.x, cell.y, 13.0));
    const radius2: TslNode = seed.mul(0.075).add(0.018);
    const d2: TslNode = dot(local, local);
    const ring: TslNode = float(1).sub(smoothstep(0.006, 0.032, abs(d2.sub(radius2))));
    const gate: TslNode = smoothstep(0.62, 0.98, seed);
    return ring.mul(gate);
  };

  return { ...base, ridge, billow, ign2, gabor2, wavelet2, ringCells2 };
}
