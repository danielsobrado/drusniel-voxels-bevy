import { float, floor, fract, mix, sin, vec3 } from "three/tsl";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

export interface SpellNoiseNodes {
  /** Value noise of a vec3 node, matching the classic spell shaders. */
  noise: (x: TslNode) => TslNode;
  /** 5-octave fractional Brownian motion built on {@link SpellNoiseNodes.noise}. */
  fbm: (p: TslNode) => TslNode;
}

export interface SpellNoiseParams {
  /** Hash seed multiplier (fire and water used different constants). */
  hashSeed: number;
  /** Per-octave frequency multiplier. */
  fbmFreqMul: number;
  /** Per-octave coordinate offset. */
  fbmOffset: readonly [number, number, number];
  octaves?: number;
}

/**
 * TSL port of the `hash`/`noise`/`fbm` helpers from the classic fire/water spell
 * GLSL. Built as inlined node graphs (matching the project's grass/ocean node
 * materials) so it runs under both the WebGPU and WebGL backends.
 */
export function createSpellNoiseNodes(params: SpellNoiseParams): SpellNoiseNodes {
  const { hashSeed, fbmFreqMul, fbmOffset, octaves = 5 } = params;

  const hash = (n: TslNode): TslNode => fract(sin(n).mul(hashSeed));

  const noise = (x: TslNode): TslNode => {
    const p: TslNode = floor(x);
    const f0: TslNode = fract(x);
    const f: TslNode = f0.mul(f0).mul(float(3).sub(f0.mul(2)));
    const n: TslNode = p.x.add(p.y.mul(157)).add(p.z.mul(113));
    return mix(
      mix(
        mix(hash(n.add(0)), hash(n.add(1)), f.x),
        mix(hash(n.add(157)), hash(n.add(158)), f.x),
        f.y,
      ),
      mix(
        mix(hash(n.add(113)), hash(n.add(114)), f.x),
        mix(hash(n.add(270)), hash(n.add(271)), f.x),
        f.y,
      ),
      f.z,
    );
  };

  const fbm = (p0: TslNode): TslNode => {
    let p: TslNode = p0;
    let value: TslNode = float(0);
    let amp = 0.5;
    for (let i = 0; i < octaves; i++) {
      value = value.add(noise(p).mul(amp));
      p = p.mul(fbmFreqMul).add(vec3(fbmOffset[0], fbmOffset[1], fbmOffset[2]));
      amp *= 0.5;
    }
    return value;
  };

  return { noise, fbm };
}
