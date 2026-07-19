import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  abs,
  clamp,
  float,
  floor,
  Fn,
  length,
  max,
  mix,
  pow,
  sin,
  smoothstep,
  step,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { createSpellEffectNoiseNodes } from "./spell_effect_noise.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

export interface SpellNodeMaterialHandle {
  material: MeshBasicNodeMaterial;
  uTime: { value: number };
  uProgress: { value: number };
}

/**
 * In-scene flame for the fire spell. TSL port of the classic screen-space
 * GLSL shader, reworked to run in the billboard quad's local UV space:
 * `t = uv.y` (0 = base, 1 = tip) and `side = uv.x - 0.5`. The mesh transform
 * now anchors and orients the flame in the world; `uProgress` drives both the
 * lifetime fade and the upward growth.
 */
export function createFireNodeMaterial(): SpellNodeMaterialHandle {
  const uTime = uniform(0) as TslNode;
  const uProgress = uniform(0) as TslNode;
  const { noise, fbm, ridge, gabor2, wavelet2, ringCells2, ign2 } = createSpellEffectNoiseNodes({
    hashSeed: 753.5453123,
    fbmFreqMul: 2.03,
    fbmOffset: [13.7, 7.1, 4.8],
  });

  const ring = (d: TslNode, radius: TslNode, thickness: TslNode): TslNode =>
    float(1).sub(smoothstep(thickness, thickness.mul(1.85), abs(d.sub(radius))));

  const fragment = Fn(() => {
    const uvN: TslNode = uv();
    const side: TslNode = uvN.x.sub(0.5);
    const t: TslNode = uvN.y;
    const p: TslNode = vec2(side, uvN.y.sub(0.5));

    const castIn: TslNode = smoothstep(0.0, 0.07, uProgress);
    const castOut: TslNode = float(1).sub(smoothstep(0.78, 1.0, uProgress));
    const life: TslNode = castIn.mul(castOut);
    // Spatial rise: the visible tip climbs from base to full over cast-in.
    const grow: TslNode = smoothstep(0.0, 0.24, uProgress);

    const centerNoise: TslNode = fbm(vec3(t.mul(2.2), uTime.mul(1.7), 3.0));
    const filamentNoise: TslNode = gabor2(
      vec2(side.mul(5.8), t.mul(3.4)).add(vec2(0.0, uTime.mul(-2.1))),
      uTime,
    );
    const lickNoise: TslNode = wavelet2(
      vec2(side.mul(2.2), t.mul(4.0)).add(vec2(uTime.mul(0.2), uTime.mul(-1.4))),
      uTime.mul(8.0),
    );
    const sideWarp: TslNode = centerNoise.sub(0.5).mul(0.105).mul(smoothstep(0.08, 0.86, t))
      .add(filamentNoise.sub(0.5).mul(0.035).mul(smoothstep(0.12, 0.92, t)))
      .add(lickNoise.sub(0.5).mul(0.028).mul(smoothstep(0.10, 0.80, t)));
    const warpedSide: TslNode = side.add(sideWarp);
    const baseMask: TslNode = smoothstep(-0.02, 0.08, t).mul(
      float(1).sub(smoothstep(grow.mul(0.92), grow.mul(1.13).add(0.01), t)),
    );
    let coneWidth: TslNode = mix(float(0.035), float(0.255), pow(max(t, 0.0), 0.74));
    coneWidth = coneWidth.mul(float(1).sub(smoothstep(0.68, 1.05, t).mul(0.58)));
    coneWidth = max(coneWidth, 0.022);

    const q: TslNode = vec3(warpedSide.div(coneWidth), t.mul(3.15), uTime.mul(2.3));
    const rolling: TslNode = fbm(q.mul(vec3(0.86, 1.42, 1.0)).add(vec3(0.0, uTime.mul(-3.2), uTime.mul(0.25))));
    const fine: TslNode = fbm(q.mul(vec3(2.3, 3.0, 1.0)).add(vec3(5.0, uTime.mul(-6.5), 1.0)));
    const body: TslNode = float(1)
      .sub(abs(warpedSide).div(coneWidth))
      .sub(t.mul(0.46))
      .add(rolling.mul(0.60))
      .add(fine.mul(0.18))
      .add(filamentNoise.sub(0.5).mul(0.24))
      .add(lickNoise.mul(0.13));
    const density: TslNode = smoothstep(0.10, 0.86, body).mul(baseMask).mul(life);
    const core: TslNode = smoothstep(0.82, 1.28, body.add(float(1).sub(t).mul(0.26))).mul(baseMask).mul(life);
    const tongue: TslNode = smoothstep(0.72, 1.08, filamentNoise.add(lickNoise.mul(0.35)))
      .mul(density)
      .mul(smoothstep(0.12, 0.86, t));

    const palmDist: TslNode = length(vec2(side.mul(0.72), t.mul(1.24)));
    const palmGlow: TslNode = float(1).sub(smoothstep(0.04, 0.28, palmDist)).mul(life);
    const magicRing: TslNode = ring(palmDist, float(0.145).add(sin(uTime.mul(7.0)).mul(0.016)), float(0.010)).mul(life);
    const runePulse: TslNode = ring(palmDist, float(0.215).add(sin(uTime.mul(4.2)).mul(0.020)), float(0.008)).mul(life).mul(0.55);

    const cell: TslNode = floor(vec2(warpedSide.add(0.52).mul(92.0), t.mul(74.0)));
    const sparkNoise: TslNode = noise(vec3(cell.x, cell.y, floor(uTime.mul(32.0)))).mul(0.72).add(ign2(cell).mul(0.28));
    const sparkLine: TslNode = smoothstep(0.18, 0.96, t).mul(float(1).sub(smoothstep(1.0, 1.14, t)));
    const sparks: TslNode = step(0.986, sparkNoise).mul(sparkLine).mul(life);
    const emberBurst: TslNode = ringCells2(vec2(warpedSide.add(0.52).mul(18.0), t.mul(15.0).sub(uTime.mul(5.5))))
      .mul(smoothstep(0.10, 0.72, t))
      .mul(life);
    const emberTrail: TslNode = step(0.993, noise(vec3(cell.x.add(17.0), cell.y.add(17.0), floor(uTime.mul(18.0)))))
      .mul(smoothstep(0.08, 0.58, t))
      .mul(life);

    const heat: TslNode = fbm(vec3(p.x.mul(2.0), p.y.mul(3.0), uTime.mul(2.0)));
    const heatVeil: TslNode = smoothstep(0.16, 0.88, body.add(heat.mul(0.25))).mul(baseMask).mul(life).mul(0.11);
    const smokeVein: TslNode = ridge(vec3(p.x.mul(1.2), p.y.mul(2.1).sub(uTime.mul(0.35)), uTime.mul(0.6)))
      .mul(smoothstep(0.46, 1.0, t))
      .mul(float(1).sub(core))
      .mul(life)
      .mul(0.09);

    const ember: TslNode = vec3(0.85, 0.12, 0.025);
    const flame: TslNode = vec3(1.0, 0.42, 0.07);
    const hot: TslNode = vec3(1.0, 0.88, 0.36);
    const arcane: TslNode = vec3(1.0, 0.37, 0.12);
    let color: TslNode = mix(ember, flame, density);
    color = mix(color, hot, core);
    color = color.add(hot.mul(tongue).mul(0.44));
    color = color.add(hot.mul(palmGlow).mul(0.78));
    color = color.add(arcane.mul(magicRing.add(runePulse)).mul(0.95));
    color = color.add(vec3(1.0, 0.55, 0.12).mul(sparks.add(emberBurst.mul(0.42))).mul(0.75));
    color = color.add(vec3(1.0, 0.22, 0.06).mul(emberTrail).mul(0.36));
    color = color.add(vec3(0.70, 0.23, 0.08).mul(heatVeil));
    color = color.add(vec3(0.34, 0.12, 0.06).mul(smokeVein));

    const alpha: TslNode = clamp(
      density.mul(0.72)
        .add(core.mul(0.34))
        .add(tongue.mul(0.22))
        .add(palmGlow.mul(0.48))
        .add(magicRing.mul(0.55))
        .add(runePulse.mul(0.34))
        .add(sparks.mul(0.38))
        .add(emberBurst.mul(0.20))
        .add(emberTrail.mul(0.18))
        .add(heatVeil)
        .add(smokeVein),
      0.0,
      0.98,
    );
    return vec4(color, alpha);
  })();

  const material = new MeshBasicNodeMaterial();
  material.name = "fire-spell-node";
  material.colorNode = fragment.xyz;
  material.opacityNode = fragment.w;
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = THREE.FrontSide;
  material.blending = THREE.AdditiveBlending;
  material.toneMapped = false;

  return { material, uTime, uProgress };
}
