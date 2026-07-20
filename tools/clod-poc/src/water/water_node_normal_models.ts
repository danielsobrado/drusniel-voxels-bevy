import {
  cos,
  dot,
  float,
  fract,
  If,
  mix,
  normalize,
  sin,
  vec2,
  vec3,
} from "three/tsl";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

export interface WaterNormalModelInput {
  readonly model: TslNode;
  readonly worldXZ: TslNode;
  readonly time: TslNode;
  readonly cameraDistance: TslNode;
  readonly riverDir: TslNode;
  readonly sideDir: TslNode;
  readonly riverWeight: TslNode;
  readonly rapidMask: TslNode;
  readonly phaseA: TslNode;
  readonly phaseB: TslNode;
  readonly phaseBlend: TslNode;
  readonly advectA: TslNode;
  readonly advectB: TslNode;
  readonly advectSpeed: TslNode;
  readonly rippleAmp: TslNode;
  readonly rippleScaleA: TslNode;
  readonly rippleScaleB: TslNode;
  readonly rippleStrengthA: TslNode;
  readonly rippleStrengthB: TslNode;
  readonly riverFlowNormalStrength: TslNode;
  readonly riverCrossCurrentStrength: TslNode;
  readonly riverRapidNormalBoost: TslNode;
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

function buildFable5InspiredNormal(input: WaterNormalModelInput): TslNode {
  const heightAt = (p: TslNode): TslNode => {
    const phaseLayer = (offset: TslNode): TslNode => {
      const broad: TslNode = valueNoise(p.sub(offset).mul(input.rippleScaleA))
        .mul(input.rippleStrengthA);
      const detail: TslNode = valueNoise(
        p.sub(offset.mul(0.62)).mul(input.rippleScaleB).add(vec2(17.3, 9.1)),
      ).mul(input.rippleStrengthB);
      return broad.add(detail.mul(0.5));
    };

    return mix(phaseLayer(input.advectA), phaseLayer(input.advectB), input.phaseBlend);
  };

  return finiteDifferenceNormal(input.worldXZ, 0.08, heightAt, input.rippleAmp);
}

function buildGlacialNormal(input: WaterNormalModelInput): TslNode {
  const heightAt = (p: TslNode): TslNode => valueNoise(
    p.mul(vec2(1.1, 2.6)).add(vec2(input.time.mul(-1.35), input.time.mul(0.18))),
  )
    .mul(0.034)
    .add(valueNoise(
      p.mul(vec2(2.6, 6.0)).add(vec2(input.time.mul(-2.30), input.time.mul(-0.32))),
    ).mul(0.016))
    .add(valueNoise(
      p.mul(vec2(5.6, 12.0)).add(vec2(input.time.mul(-3.60), input.time.mul(0.55))),
    ).mul(0.008))
    .add(valueNoise(
      p.mul(vec2(10.0, 22.0)).add(vec2(input.time.mul(-5.20), input.time.mul(0.90))),
    ).mul(0.0045))
    .add(valueNoise(p.mul(0.45).add(vec2(input.time.mul(-0.50), 0))).mul(0.050));

  const strength: TslNode = float(1)
    .add(input.rapidMask.mul(1.4))
    .div(float(1).add(input.cameraDistance.mul(0.010)))
    .mul(input.rippleAmp.div(0.20));

  return finiteDifferenceNormal(input.worldXZ, 0.045, heightAt, strength);
}

function buildLegacyNormal(input: WaterNormalModelInput): TslNode {
  const tau = 6.28318530718;
  const uvA: TslNode = input.worldXZ.mul(input.rippleScaleA).add(input.advectA);
  const uvB: TslNode = input.worldXZ.mul(input.rippleScaleB)
    .add(input.advectB)
    .add(vec2(17.31, -9.47));

  const rippleGrad = (uv: TslNode, phase: TslNode): { x: TslNode; z: TslNode } => {
    const w1: TslNode = cos(uv.x.mul(0.94).add(uv.y.mul(0.34)).add(phase.mul(tau)))
      .mul(input.rippleStrengthA);
    const w2: TslNode = cos(uv.x.mul(-0.75).add(uv.y.mul(1.665)).sub(phase.mul(tau * 0.7)))
      .mul(input.rippleStrengthA.mul(0.55));
    const w3: TslNode = cos(uv.x.mul(1.773).add(uv.y.mul(-2.55)).add(phase.mul(tau * 0.9)))
      .mul(input.rippleStrengthB);
    const w4: TslNode = cos(uv.x.mul(-4.585).add(uv.y.mul(-2.635)).sub(phase.mul(tau * 1.3)))
      .mul(input.rippleStrengthB.mul(0.6));
    return {
      x: w1.mul(0.94).add(w2.mul(-0.41)).add(w3.mul(0.57)).add(w4.mul(-0.87)),
      z: w1.mul(0.34).add(w2.mul(0.91)).add(w3.mul(-0.82)).add(w4.mul(-0.50)),
    };
  };

  const gradA = rippleGrad(uvA, input.phaseA);
  const gradB = rippleGrad(uvB, input.phaseB);
  const flowCoord: TslNode = vec2(
    dot(input.worldXZ, input.riverDir),
    dot(input.worldXZ, input.sideDir),
  );
  const channelPhase: TslNode = input.time.mul(input.advectSpeed).mul(1.35);
  const channelWave: TslNode = sin(
    flowCoord.x.mul(input.rippleScaleA.mul(5.5))
      .sub(channelPhase)
      .add(sin(flowCoord.y.mul(0.08)).mul(0.7)),
  );
  const sideRipple: TslNode = cos(
    flowCoord.y.mul(input.rippleScaleB.mul(4.0))
      .add(flowCoord.x.mul(0.018))
      .add(channelPhase.mul(0.45)),
  );
  const channelGrad: TslNode = input.riverDir
    .mul(channelWave.mul(input.rippleStrengthA).mul(input.riverFlowNormalStrength))
    .add(input.sideDir.mul(
      sideRipple.mul(input.rippleStrengthB).mul(input.riverCrossCurrentStrength),
    ))
    .mul(input.riverWeight)
    .mul(float(0.45).add(input.rapidMask.mul(input.riverRapidNormalBoost)));
  const gradX: TslNode = mix(gradA.x, gradB.x, input.phaseBlend)
    .add(channelGrad.x)
    .mul(input.rippleAmp);
  const gradZ: TslNode = mix(gradA.z, gradB.z, input.phaseBlend)
    .add(channelGrad.y)
    .mul(input.rippleAmp);
  return normalize(vec3(gradX.negate(), float(1), gradZ.negate()));
}

export function buildSelectedWaterNormal(input: WaterNormalModelInput): TslNode {
  const result: TslNode = vec3(0, 1, 0).toVar();

  If(input.model.equal(2), () => {
    result.assign(buildLegacyNormal(input));
  }).ElseIf(input.model.equal(1), () => {
    result.assign(buildGlacialNormal(input));
  }).Else(() => {
    result.assign(buildFable5InspiredNormal(input));
  });

  return result;
}
