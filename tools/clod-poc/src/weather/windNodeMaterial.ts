import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  abs,
  attribute,
  clamp,
  dot,
  float,
  floor,
  Fn,
  fract,
  length,
  max,
  mix,
  positionGeometry,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { RainWeatherShaderHandle } from "./rainShaderMaterial.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const MOD3 = [0.16532, 0.17369, 0.15787] as const;

function hash22(p: TslNode): TslNode {
  const p3: TslNode = fract(vec3(p.x, p.y, p.x).mul(vec3(MOD3[0], MOD3[1], MOD3[2])));
  const d: TslNode = dot(vec3(p3.z, p3.x, p3.y), vec3(p3.y, p3.x, p3.z).add(19.19));
  const q: TslNode = p3.add(d);
  return fract(vec2(q.x.mul(q.y), q.z.mul(q.x))).sub(0.5);
}

function noise22(x: TslNode): TslNode {
  const p: TslNode = floor(x);
  const f0: TslNode = fract(x);
  const f: TslNode = f0.mul(f0).mul(float(3).sub(f0.mul(2)));
  return mix(
    mix(hash22(p), hash22(p.add(vec2(1, 0))), f.x),
    mix(hash22(p.add(vec2(0, 1))), hash22(p.add(vec2(1, 1))), f.x),
    f.y,
  );
}

function fbm22(x0: TslNode): TslNode {
  let x: TslNode = x0;
  let r: TslNode = vec2(0, 0);
  let a = 0.6;
  for (let i = 0; i < 6; i++) {
    r = r.add(noise22(x.mul(a)).div(a));
    a += a;
  }
  return r;
}

function tri(x: TslNode): TslNode {
  return abs(fract(x).sub(0.5));
}

export function createWindNodeMaterial(): RainWeatherShaderHandle {
  const uCenter = uniform(new THREE.Vector3()) as TslNode;
  const uTime = uniform(0) as TslNode;
  const uIntensity = uniform(1) as TslNode;
  const uWindX = uniform(-2.2) as TslNode;
  const uWindZ = uniform(0.36) as TslNode;
  const uColor = uniform(new THREE.Color(0xb8d5df)) as TslNode;
  const uOpacity = uniform(0.42) as TslNode;

  const aWindOffset: TslNode = attribute("aWindOffset", "vec4");
  const aWindShape: TslNode = attribute("aWindShape", "vec4");
  const localPos: TslNode = positionGeometry;
  const windBase: TslNode = vec3(uWindX, 0.0, uWindZ);
  const windLength: TslNode = max(length(windBase), 0.001);
  const windDir: TslNode = windBase.div(windLength);
  const side: TslNode = vec3(windDir.z.mul(-1.0), 0.0, windDir.x);
  const area: TslNode = max(aWindOffset.w, 1.0);
  const speed: TslNode = aWindShape.z.mul(mix(0.25, 1.85, clamp(uIntensity, 0.0, 1.6)));
  const travel: TslNode = fract(aWindOffset.y.add(uTime.mul(speed).div(area)));
  const along: TslNode = float(0.5).sub(travel).mul(area);
  const seed: TslNode = aWindShape.w;
  const gust: TslNode = fbm22(vec2(
    along.mul(0.055).add(uTime.mul(0.52)).add(seed.mul(0.013)),
    aWindOffset.z.mul(0.42).add(seed.mul(0.019)),
  ));
  const gust2: TslNode = fbm22(vec2(
    uTime.mul(0.19).add(seed.mul(0.031)),
    along.mul(0.025).sub(aWindOffset.x.mul(0.018)),
  ));
  const pulse: TslNode = smoothstep(0.10, 0.95, gust.x.mul(0.45).add(gust2.y.mul(0.30)).add(0.48));
  const lowHug: TslNode = float(1).sub(smoothstep(0.2, 5.2, aWindOffset.z));
  const lift: TslNode = gust.y.mul(0.95).add(gust2.x.mul(0.32)).mul(mix(0.28, 1.20, lowHug));
  const center: TslNode = uCenter
    .add(windDir.mul(along))
    .add(side.mul(aWindOffset.x.add(gust.x.mul(mix(0.55, 2.25, lowHug)))))
    .add(vec3(0.0, aWindOffset.z.add(lift), 0.0));
  const ribbonWidth: TslNode = aWindShape.x.mul(mix(0.65, 1.25, pulse));
  const worldPosition: TslNode = center
    .add(side.mul(localPos.x).mul(ribbonWidth))
    .add(vec3(0.0, localPos.y.mul(ribbonWidth).mul(0.42), 0.0))
    .add(windDir.mul(localPos.z).mul(ribbonWidth).mul(mix(3.5, 7.5, pulse)));

  const fragment = Fn(() => {
    const p: TslNode = uv().mul(2.0).sub(1.0);
    const body: TslNode = float(1).sub(smoothstep(0.05, 1.0, length(vec2(p.x.mul(0.72), p.y.mul(1.35)))));
    const streak: TslNode = float(1).sub(smoothstep(
      0.04,
      0.34,
      abs(p.y.add(fbm22(vec2(p.x.mul(2.2).add(seed), uTime.mul(0.35))).x.mul(0.22))),
    ));
    const filament: TslNode = smoothstep(
      0.46,
      0.96,
      tri(p.x.mul(5.5).add(fbm22(vec2(p.y.mul(3.0).add(seed), uTime.mul(0.22))).y.mul(2.8))),
    );
    const breakup: TslNode = smoothstep(0.08, 0.80, body.mul(0.72).add(streak.mul(0.24)).add(filament.mul(0.18)));
    const fade: TslNode = smoothstep(0.02, 0.15, travel).mul(float(1).sub(smoothstep(0.86, 1.0, travel)));
    const alpha: TslNode = breakup.mul(body.mul(0.70).add(streak.mul(0.28)))
      .mul(aWindShape.y)
      .mul(mix(0.18, 1.25, pulse))
      .mul(fade)
      .mul(uOpacity)
      .mul(clamp(uIntensity, 0.0, 1.6));
    alpha.lessThan(0.006).discard();
    const pale: TslNode = vec3(0.82, 0.94, 1.0);
    const dust: TslNode = vec3(0.72, 0.68, 0.55);
    let color: TslNode = mix(uColor, pale, streak.mul(0.42));
    color = mix(color, dust, lowHug.mul(0.32));
    return vec4(color, alpha);
  });

  const material = new MeshBasicNodeMaterial();
  material.name = "weather-wind-node";
  material.positionNode = worldPosition;
  material.fragmentNode = fragment();
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = THREE.DoubleSide;

  return {
    material,
    setTime: (time) => { uTime.value = time; },
    setIntensity: (intensity) => { uIntensity.value = intensity; },
    setCenter: (center) => { uCenter.value.copy(center); },
    setWind: (x, z) => { uWindX.value = x; uWindZ.value = z; },
    dispose: () => { material.dispose(); },
  };
}
