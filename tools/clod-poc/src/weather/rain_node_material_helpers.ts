import {
  abs, clamp, cos, dot, float, floor, Fn, fract, length, min, mix, mod, sin, smoothstep, vec2, vec4, uv,
} from "three/tsl";
import type { TslNode } from "./rain_node_material_types.js";

export function hash12(uv: TslNode): TslNode {
  return fract(cos(mod(dot(uv, vec2(13.9898, 8.141)), 3.14)).mul(43758.5453));
}

export function hash22(uv: TslNode): TslNode {
  const u: TslNode = vec2(dot(uv, vec2(127.1, 311.7)), dot(uv, vec2(269.5, 183.3)));
  return float(2.0).mul(fract(sin(u).mul(43758.5453123)));
}

export function noise(uv: TslNode): TslNode {
  const iuv: TslNode = floor(uv);
  const fuv: TslNode = fract(uv);
  const blurX: TslNode = smoothstep(0.0, 1.0, fuv.x);
  const blurY: TslNode = smoothstep(0.0, 1.0, fuv.y);
  return mix(
    mix(dot(hash22(iuv.add(vec2(0.0, 0.0))), fuv.sub(vec2(0.0, 0.0))),
        dot(hash22(iuv.add(vec2(1.0, 0.0))), fuv.sub(vec2(1.0, 0.0))), blurX),
    mix(dot(hash22(iuv.add(vec2(0.0, 1.0))), fuv.sub(vec2(0.0, 1.0))),
        dot(hash22(iuv.add(vec2(1.0, 1.0))), fuv.sub(vec2(1.0, 1.0))), blurX),
    blurY,
  ).add(0.5);
}

export function fbm(uv: TslNode): TslNode {
  let v: TslNode = float(0);
  let amp: TslNode = float(0.5);
  let u: TslNode = uv;
  for (let i = 0; i < 5; i++) {
    v = v.add(amp.mul(noise(u)));
    u = u.mul(2.0);
    amp = amp.mul(0.5);
  }
  return v;
}

export function hardSplashFragment(age: TslNode, params: TslNode, color: TslNode, opacity: TslNode, intensity: TslNode): TslNode {
  return Fn(() => {
    const p: TslNode = uv().mul(2.0).sub(1.0);
    const r: TslNode = length(p);
    r.greaterThan(1.04).discard();
    const radius: TslNode = mix(0.18, 0.78, smoothstep(0.0, 0.78, age));
    const ring: TslNode = float(1).sub(smoothstep(0.018, 0.075, abs(r.sub(radius))));
    const axis: TslNode = min(abs(p.x), abs(p.y));
    const diag: TslNode = min(abs(p.x.add(p.y)), abs(p.x.sub(p.y))).mul(0.7);
    const ray: TslNode = float(1).sub(smoothstep(0.025, 0.13, min(axis, diag)))
      .mul(smoothstep(0.08, 0.24, r))
      .mul(float(1).sub(smoothstep(0.52, 1.0, r)));
    const center: TslNode = float(1).sub(smoothstep(0.02, 0.16, r));
    const fade: TslNode = float(1).sub(smoothstep(0.58, 1.0, age)).mul(smoothstep(0.0, 0.08, age));
    const alpha: TslNode = ring.mul(0.62).add(ray.mul(0.55)).add(center.mul(0.32))
      .mul(fade).mul(params.w).mul(opacity).mul(clamp(intensity, 0.0, 1.6));
    alpha.lessThan(0.01).discard();
    return vec4(color, alpha);
  })();
}

export function waterSplashFragment(age: TslNode, params: TslNode, color: TslNode, opacity: TslNode, intensity: TslNode): TslNode {
  return Fn(() => {
    const p: TslNode = uv().mul(2.0).sub(1.0);
    const r: TslNode = length(p);
    r.greaterThan(1.04).discard();
    const radiusA: TslNode = mix(0.14, 0.86, smoothstep(0.0, 0.9, age));
    const radiusB: TslNode = mix(0.04, 0.54, smoothstep(0.14, 0.96, age));
    const ringA: TslNode = float(1).sub(smoothstep(0.015, 0.055, abs(r.sub(radiusA))));
    const ringB: TslNode = float(1).sub(smoothstep(0.012, 0.045, abs(r.sub(radiusB))));
    const center: TslNode = float(1).sub(smoothstep(0.03, 0.13, r)).mul(float(1).sub(smoothstep(0.0, 0.35, age)));
    const fade: TslNode = float(1).sub(smoothstep(0.62, 1.0, age)).mul(smoothstep(0.0, 0.07, age));
    const alpha: TslNode = ringA.mul(0.76).add(ringB.mul(0.42)).add(center.mul(0.18))
      .mul(fade).mul(params.w).mul(opacity).mul(clamp(intensity, 0.0, 1.6));
    alpha.lessThan(0.01).discard();
    return vec4(color, alpha);
  })();
}
