import {
  dot,
  float,
  fract,
  mix,
  normalize,
  sin,
  vec2,
  vec3,
} from "three/tsl";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

export interface WaterNoiseNormalInput {
  readonly worldXZ: TslNode;
  readonly time: TslNode;
  readonly cameraDistance: TslNode;
  readonly rapidMask: TslNode;
  readonly phaseBlend: TslNode;
  readonly advectA: TslNode;
  readonly advectB: TslNode;
  readonly rippleAmp: TslNode;
  readonly rippleScaleA: TslNode;
  readonly rippleScaleB: TslNode;
  readonly rippleStrengthA: TslNode;
  readonly rippleStrengthB: TslNode;
}

export interface WaterNoiseNormals {
  readonly fable5: TslNode;
  readonly glacial: TslNode;
}

function hash12(p: TslNode): TslNode {
  return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453123));
}

function valueNoise(p: TslNode): TslNode {
  const i: TslNode = p.floor();
  const f: TslNode = fract(p);
  const u: TslNode = f.mul(f).mul(vec2(3).sub(f.mul(2)));
  const a: TslNode = hash12(i);
  const b: TslNode = hash12(i.add(vec2(1, 0)));
  const c: TslNode = hash12(i.add(vec2(0, 1)));
  const d: TslNode = hash12(i.add(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

function fableHeight(p: TslNode, input: WaterNoiseNormalInput): TslNode {
  const phaseLayer = (offset: TslNode): TslNode => {
    const broad: TslNode = valueNoise(p.sub(offset).mul(input.rippleScaleA))
      .mul(input.rippleStrengthA);
    const detail: TslNode = valueNoise(
      p.sub(offset.mul(0.62)).mul(input.rippleScaleB).add(vec2(17.3, 9.1)),
    ).mul(input.rippleStrengthB);
    return broad.add(detail.mul(0.5));
  };

  return mix(phaseLayer(input.advectA), phaseLayer(input.advectB), input.phaseBlend);
}

function glacialHeight(p: TslNode, time: TslNode): TslNode {
  return valueNoise(p.mul(vec2(1.1, 2.6)).add(vec2(time.mul(-1.35), time.mul(0.18))))
    .mul(0.034)
    .add(valueNoise(p.mul(vec2(2.6, 6.0)).add(vec2(time.mul(-2.30), time.mul(-0.32)))).mul(0.016))
    .add(valueNoise(p.mul(vec2(5.6, 12.0)).add(vec2(time.mul(-3.60), time.mul(0.55)))).mul(0.008))
    .add(valueNoise(p.mul(vec2(10.0, 22.0)).add(vec2(time.mul(-5.20), time.mul(0.90)))).mul(0.0045))
    .add(valueNoise(p.mul(0.45).add(vec2(time.mul(-0.50), 0))).mul(0.050));
}

function finiteDifferenceNormal(
  worldXZ: TslNode,
  epsilon: number,
  heightAt: (p: TslNode) => TslNode,
  strength: TslNode,
): TslNode {
  const h0: TslNode = heightAt(worldXZ);
  const hx: TslNode = heightAt(worldXZ.add(vec2(epsilon, 0)));
  const hz: TslNode = heightAt(worldXZ.add(vec2(0, epsilon)));
  const gradX: TslNode = hx.sub(h0).div(epsilon).mul(strength);
  const gradZ: TslNode = hz.sub(h0).div(epsilon).mul(strength);
  return normalize(vec3(gradX.negate(), float(1), gradZ.negate()));
}

export function buildWaterNoiseNormals(input: WaterNoiseNormalInput): WaterNoiseNormals {
  const fable5 = finiteDifferenceNormal(
    input.worldXZ,
    0.08,
    (p) => fableHeight(p, input),
    input.rippleAmp,
  );

  const glacialScale: TslNode = float(1)
    .add(input.rapidMask.mul(1.4))
    .div(float(1).add(input.cameraDistance.mul(0.010)))
    .mul(input.rippleAmp.div(0.20));
  const glacial = finiteDifferenceNormal(
    input.worldXZ,
    0.045,
    (p) => glacialHeight(p, input.time),
    glacialScale,
  );

  return { fable5, glacial };
}
