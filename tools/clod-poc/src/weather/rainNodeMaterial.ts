import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  abs,
  attribute,
  clamp,
  cos,
  cross,
  float,
  Fn,
  fract,
  length,
  max,
  min,
  mix,
  normalize,
  positionGeometry,
  sin,
  smoothstep,
  uniform,
  uv,
  vec3,
  vec4,
} from "three/tsl";
import type { RainWeatherShaderHandle } from "./rainShaderMaterial.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

export function createRainNodeMaterial(): RainWeatherShaderHandle {
  const uCenter = uniform(new THREE.Vector3()) as TslNode;
  const uTime = uniform(0) as TslNode;
  const uIntensity = uniform(1) as TslNode;
  const uWindX = uniform(-1.05) as TslNode;
  const uWindZ = uniform(0.28) as TslNode;
  const uTopY = uniform(20) as TslNode;
  const uBottomY = uniform(-12) as TslNode;
  const uColor = uniform(new THREE.Color(0xb9dcff)) as TslNode;
  const uOpacity = uniform(0.46) as TslNode;

  const aRainOffset: TslNode = attribute("aRainOffset", "vec4");
  const aRainShape: TslNode = attribute("aRainShape", "vec4");
  const rainPos: TslNode = positionGeometry;
  const height: TslNode = max(uTopY.sub(uBottomY), 0.001);
  const fall: TslNode = fract(aRainOffset.y.sub(uTime.mul(aRainOffset.w).mul(max(uIntensity, 0.08)).div(height)));
  const streakDir: TslNode = normalize(vec3(uWindX, -8.0, uWindZ));
  const side: TslNode = normalize(cross(streakDir, vec3(0.0, 1.0, 0.0)).add(vec3(0.0001, 0.0, 0.0)));
  const head: TslNode = uCenter.add(vec3(
    aRainOffset.x.add(uWindX.mul(float(1).sub(fall)).mul(0.35)),
    uBottomY.add(fall.mul(height)),
    aRainOffset.z.add(uWindZ.mul(float(1).sub(fall)).mul(0.35)),
  ));
  const worldPosition: TslNode = head
    .add(side.mul(rainPos.x).mul(aRainShape.y))
    .add(streakDir.mul(rainPos.y).mul(aRainShape.x));

  const fragment = Fn(() => {
    const p: TslNode = uv();
    const center: TslNode = float(1).sub(abs(p.x.mul(2.0).sub(1.0)));
    const width: TslNode = smoothstep(0.0, 0.55, center);
    const tail: TslNode = smoothstep(0.0, 0.2, p.y).mul(float(1).sub(smoothstep(0.82, 1.0, p.y)));
    const fade: TslNode = smoothstep(0.02, 0.16, fall).mul(float(1).sub(smoothstep(0.84, 1.0, fall)));
    const alpha: TslNode = width.mul(tail).mul(fade).mul(uOpacity).mul(clamp(uIntensity, 0.0, 1.6));
    alpha.lessThan(0.01).discard();
    return vec4(uColor, alpha);
  });

  const material = new MeshBasicNodeMaterial();
  material.name = "weather-rain-node";
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

export function createSnowNodeMaterial(): RainWeatherShaderHandle {
  const uCenter = uniform(new THREE.Vector3()) as TslNode;
  const uTime = uniform(0) as TslNode;
  const uIntensity = uniform(1) as TslNode;
  const uWindX = uniform(-0.62) as TslNode;
  const uWindZ = uniform(0.21) as TslNode;
  const uTopY = uniform(18) as TslNode;
  const uBottomY = uniform(-8) as TslNode;
  const uColor = uniform(new THREE.Color(0xf1f7ff)) as TslNode;
  const uOpacity = uniform(0.76) as TslNode;

  const aSnowOffset: TslNode = attribute("aSnowOffset", "vec4");
  const aSnowShape: TslNode = attribute("aSnowShape", "vec4");
  const snowPos: TslNode = positionGeometry;
  const height: TslNode = max(uTopY.sub(uBottomY), 0.001);
  const fall: TslNode = fract(aSnowOffset.y.sub(uTime.mul(aSnowOffset.w).mul(max(uIntensity, 0.05)).div(height)));
  const gust: TslNode = sin(uTime.mul(float(0.7).add(aSnowShape.w.mul(0.6))).add(aSnowShape.w.mul(6.28318530718)));
  const lateral: TslNode = aSnowShape.z.mul(gust);
  const center: TslNode = uCenter.add(vec3(
    aSnowOffset.x.add(uWindX.mul(float(1).sub(fall)).mul(1.8)).add(lateral),
    uBottomY.add(fall.mul(height)),
    aSnowOffset.z.add(uWindZ.mul(float(1).sub(fall)).mul(1.8))
      .add(cos(uTime.mul(0.8).add(aSnowShape.w.mul(12.56637061436))).mul(aSnowShape.z).mul(0.55)),
  ));
  const worldPosition: TslNode = center.add(snowPos.mul(aSnowShape.x));

  const fragment = Fn(() => {
    const p: TslNode = uv().mul(2.0).sub(1.0);
    const r: TslNode = length(p);
    r.greaterThan(1.05).discard();
    const core: TslNode = float(1).sub(smoothstep(0.18, 0.92, r));
    const axis: TslNode = min(abs(p.x), abs(p.y));
    const diag: TslNode = min(abs(p.x.add(p.y)), abs(p.x.sub(p.y))).mul(0.72);
    const arms: TslNode = float(1).sub(smoothstep(0.035, 0.16, min(axis, diag)))
      .mul(float(1).sub(smoothstep(0.24, 1.0, r)));
    const edge: TslNode = float(1).sub(smoothstep(0.76, 1.05, r));
    const sparkle: TslNode = float(0.88).add(sin(aSnowShape.w.mul(37.0).add(p.x.mul(7.0)).add(p.y.mul(11.0))).mul(0.12));
    const fade: TslNode = smoothstep(0.03, 0.18, fall).mul(float(1).sub(smoothstep(0.86, 1.0, fall)));
    const alpha: TslNode = core.mul(0.82).add(arms.mul(0.46))
      .mul(edge).mul(sparkle).mul(aSnowShape.y).mul(fade).mul(uOpacity).mul(clamp(uIntensity, 0.0, 1.6));
    alpha.lessThan(0.01).discard();
    return vec4(uColor, alpha);
  });

  const material = new MeshBasicNodeMaterial();
  material.name = "weather-snow-node";
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

export function createSandstormNodeMaterial(): RainWeatherShaderHandle {
  const uCenter = uniform(new THREE.Vector3()) as TslNode;
  const uTime = uniform(0) as TslNode;
  const uIntensity = uniform(1) as TslNode;
  const uWindX = uniform(-1.8) as TslNode;
  const uWindZ = uniform(0.24) as TslNode;
  const uColor = uniform(new THREE.Color(0xb99757)) as TslNode;
  const uOpacity = uniform(0.84) as TslNode;

  const aSandOffset: TslNode = attribute("aSandOffset", "vec4");
  const aSandShape: TslNode = attribute("aSandShape", "vec4");
  const sandPos: TslNode = positionGeometry;
  const windBase: TslNode = vec3(uWindX, 0.0, uWindZ);
  const windLength: TslNode = max(length(windBase), 0.001);
  const windDir: TslNode = windBase.div(windLength);
  const side: TslNode = vec3(windDir.z.mul(-1.0), 0.0, windDir.x);
  const travel: TslNode = fract(aSandOffset.y.add(uTime.mul(aSandShape.z).mul(max(uIntensity, 0.05)).div(max(aSandOffset.w, 0.001))));
  const along: TslNode = float(0.5).sub(travel).mul(aSandOffset.w);
  const waveA: TslNode = sin(along.mul(0.48).add(aSandOffset.x.mul(0.82)).add(uTime.mul(2.35)).add(aSandShape.w.mul(0.011)));
  const waveB: TslNode = sin(along.mul(0.19).sub(aSandOffset.x.mul(0.43)).sub(uTime.mul(1.18)).add(aSandShape.w.mul(0.017)));
  const wave: TslNode = smoothstep(0.08, 0.92, waveA.mul(0.35).add(waveB.mul(0.25)).add(0.5));
  const gust: TslNode = sin(uTime.mul(float(1.25).add(aSandShape.w.mul(0.0009))).add(aSandShape.w))
    .mul(mix(0.35, 1.0, wave));
  const lift: TslNode = sin(uTime.mul(1.65).add(aSandShape.w.mul(1.37))).mul(mix(0.025, 0.11, wave));
  const center: TslNode = uCenter
    .add(windDir.mul(along))
    .add(side.mul(aSandOffset.x.add(gust.mul(0.42))))
    .add(vec3(0.0, aSandOffset.z.add(lift), 0.0));
  const worldPosition: TslNode = center
    .add(side.mul(sandPos.x).mul(aSandShape.x).mul(1.18))
    .add(vec3(0.0, sandPos.y.mul(aSandShape.x).mul(0.52), 0.0))
    .add(windDir.mul(sandPos.z).mul(aSandShape.x).mul(2.65));

  const fragment = Fn(() => {
    const p: TslNode = uv().mul(2.0).sub(1.0);
    const d: TslNode = length(vec3(p.x.mul(0.82), p.y.mul(1.18), 0.0));
    d.greaterThan(1.05).discard();
    const body: TslNode = float(1).sub(smoothstep(0.12, 0.92, d));
    const soft: TslNode = float(1).sub(smoothstep(0.0, 0.46, d));
    const grain: TslNode = float(0.64).add(sin(aSandShape.w.mul(11.7).add(p.x.mul(31.0)).add(p.y.mul(17.0))).mul(0.36));
    const fade: TslNode = smoothstep(0.02, 0.12, travel)
      .mul(float(1).sub(smoothstep(0.88, 1.0, travel)))
      .mul(mix(0.16, 1.18, wave));
    const alpha: TslNode = body.mul(0.60).add(soft.mul(0.24))
      .mul(grain).mul(aSandShape.y).mul(fade).mul(uOpacity).mul(clamp(uIntensity, 0.0, 1.6));
    alpha.lessThan(0.01).discard();
    const warm: TslNode = vec3(0.93, 0.79, 0.54);
    return vec4(mix(uColor, warm, soft.mul(0.35)), alpha);
  });

  const material = new MeshBasicNodeMaterial();
  material.name = "weather-sandstorm-node";
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

export function createSandstormHazeNodeMaterial(): RainWeatherShaderHandle {
  const uTime = uniform(0) as TslNode;
  const uIntensity = uniform(1) as TslNode;
  const uColor = uniform(new THREE.Color(0xffdc95)) as TslNode;
  const uOpacity = uniform(0.11) as TslNode;

  const fragment = Fn(() => {
    const p: TslNode = uv();
    const edgeX: TslNode = smoothstep(0.0, 0.12, p.x).mul(float(1).sub(smoothstep(0.88, 1.0, p.x)));
    const edgeY: TslNode = smoothstep(0.0, 0.10, p.y).mul(float(1).sub(smoothstep(0.86, 1.0, p.y)));
    const waveA: TslNode = sin(p.x.mul(8.0).add(uTime.mul(0.42))).mul(0.5).add(0.5);
    const waveB: TslNode = sin(p.y.mul(18.0).add(uTime.mul(0.55)).add(waveA.mul(1.7))).mul(0.5).add(0.5);
    const waveC: TslNode = sin(p.x.add(p.y).mul(15.0).sub(uTime.mul(0.36))).mul(0.5).add(0.5);
    const haze: TslNode = smoothstep(0.52, 1.0, waveA.mul(0.42).add(waveB.mul(0.42)).add(waveC.mul(0.16)));
    const alpha: TslNode = haze.mul(edgeX).mul(edgeY).mul(uOpacity).mul(clamp(uIntensity, 0.0, 1.6));
    alpha.lessThan(0.003).discard();
    return vec4(uColor, alpha);
  });

  const material = new MeshBasicNodeMaterial();
  material.name = "weather-sandstorm-haze-node";
  material.fragmentNode = fragment();
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = false;
  material.side = THREE.DoubleSide;

  return {
    material,
    setTime: (time) => { uTime.value = time; },
    setIntensity: (intensity) => { uIntensity.value = intensity; },
    setCenter: () => undefined,
    setWind: () => undefined,
    dispose: () => { material.dispose(); },
  };
}

export function createSplashNodeMaterial(kind: "hard" | "water"): RainWeatherShaderHandle {
  const uTime = uniform(0) as TslNode;
  const uRate = uniform(kind === "hard" ? 1.72 : 1.18) as TslNode;
  const uIntensity = uniform(1) as TslNode;
  const uColor = uniform(new THREE.Color(kind === "hard" ? 0xd9efff : 0x9fe6ff)) as TslNode;
  const uOpacity = uniform(kind === "hard" ? 0.84 : 0.48) as TslNode;

  const aCenter: TslNode = attribute("aSplashCenter", "vec3");
  const aNormal: TslNode = attribute("aSplashNormal", "vec3");
  const aParams: TslNode = attribute("aSplashParams", "vec4");
  const splashPos: TslNode = positionGeometry;
  const age: TslNode = fract(uTime.mul(uRate).add(aParams.y));
  const grow: TslNode = smoothstep(0.0, 0.72, age);
  const scale: TslNode = aParams.x.mul(mix(0.16, 1.0, grow));
  const c: TslNode = cos(aParams.z);
  const s: TslNode = sin(aParams.z);
  const local = vec3(
    splashPos.x.mul(c).sub(splashPos.y.mul(s)),
    splashPos.x.mul(s).add(splashPos.y.mul(c)),
    0.0,
  );
  const n: TslNode = normalize(aNormal);
  const ref: TslNode = abs(n.y).lessThan(0.95).select(vec3(0.0, 1.0, 0.0), vec3(1.0, 0.0, 0.0));
  const tangent: TslNode = normalize(cross(ref, n));
  const bitangent: TslNode = normalize(cross(n, tangent));
  const worldPosition: TslNode = aCenter
    .add(tangent.mul(local.x).add(bitangent.mul(local.y)).mul(scale))
    .add(n.mul(0.035));

  const fragment = kind === "hard" ? hardSplashFragment(age, aParams, uColor, uOpacity, uIntensity) : waterSplashFragment(age, aParams, uColor, uOpacity, uIntensity);
  const material = new MeshBasicNodeMaterial();
  material.name = `weather-${kind}-splash-node`;
  material.positionNode = worldPosition;
  material.fragmentNode = fragment;
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = THREE.DoubleSide;

  return {
    material,
    setTime: (time) => { uTime.value = time; },
    setIntensity: (intensity) => { uIntensity.value = intensity; },
    setCenter: () => undefined,
    setWind: () => undefined,
    dispose: () => { material.dispose(); },
  };
}

function hardSplashFragment(
  age: TslNode,
  params: TslNode,
  color: TslNode,
  opacity: TslNode,
  intensity: TslNode,
): TslNode {
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

function waterSplashFragment(
  age: TslNode,
  params: TslNode,
  color: TslNode,
  opacity: TslNode,
  intensity: TslNode,
): TslNode {
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
