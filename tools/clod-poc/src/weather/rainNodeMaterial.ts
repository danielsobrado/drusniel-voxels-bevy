import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  abs, attribute, clamp, cos, cross, float, Fn, fract, length,
  max, min, mix, normalize, positionGeometry, sin, smoothstep, uniform, uv, vec2, vec3, vec4,
} from "three/tsl";
import type { RainWeatherShaderHandle } from "./rain_shader_handle.js";
import type { TslNode } from "./rain_node_material_types.js";
import { fbm, hash12, hardSplashFragment, waterSplashFragment } from "./rain_node_material_helpers.js";

function makeMat(name: string, frag: TslNode, pos?: TslNode): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial();
  m.name = name;
  if (pos) m.positionNode = pos;
  m.fragmentNode = frag;
  m.transparent = true;
  m.depthWrite = false;
  m.depthTest = !!pos;
  m.side = THREE.DoubleSide;
  return m;
}

function makeHandle(mat: MeshBasicNodeMaterial, uTime: TslNode, uIntensity: TslNode, uCenter?: TslNode, uWindX?: TslNode, uWindZ?: TslNode): RainWeatherShaderHandle {
  return {
    material: mat,
    setTime: (t) => { uTime.value = t; },
    setIntensity: (v) => { uIntensity.value = v; },
    setCenter: uCenter ? (c) => { uCenter.value.copy(c); } : () => undefined,
    setWind: uWindX ? (x, z) => { uWindX.value = x; uWindZ.value = z; } : () => undefined,
    dispose: () => { mat.dispose(); },
  };
}

export function createRainNodeMaterial(): RainWeatherShaderHandle {
  const uC = uniform(new THREE.Vector3()) as TslNode, uT = uniform(0) as TslNode, uI = uniform(1) as TslNode;
  const uWx = uniform(-1.05) as TslNode, uWz = uniform(0.28) as TslNode;
  const uTop = uniform(20) as TslNode, uBot = uniform(-12) as TslNode;
  const uCol = uniform(new THREE.Color(0xb9dcff)) as TslNode, uOp = uniform(0.46) as TslNode;
  const aOff: TslNode = attribute("aRainOffset", "vec4"), aShp: TslNode = attribute("aRainShape", "vec4");
  const rPos: TslNode = positionGeometry;
  const h: TslNode = max(uTop.sub(uBot), 0.001);
  const fall: TslNode = fract(aOff.y.sub(uT.mul(aOff.w).mul(max(uI, 0.08)).div(h)));
  const sd: TslNode = normalize(vec3(uWx, -8.0, uWz));
  const side: TslNode = normalize(cross(sd, vec3(0.0, 1.0, 0.0)).add(vec3(0.0001, 0.0, 0.0)));
  const head: TslNode = uC.add(vec3(aOff.x.add(uWx.mul(float(1).sub(fall)).mul(0.35)), uBot.add(fall.mul(h)), aOff.z.add(uWz.mul(float(1).sub(fall)).mul(0.35))));
  const wPos: TslNode = head.add(side.mul(rPos.x).mul(aShp.y)).add(sd.mul(rPos.y).mul(aShp.x));
  const frag = Fn(() => {
    const p: TslNode = uv();
    const alpha: TslNode = smoothstep(0.0, 0.55, float(1).sub(abs(p.x.mul(2.0).sub(1.0)))).mul(smoothstep(0.0, 0.2, p.y).mul(float(1).sub(smoothstep(0.82, 1.0, p.y)))).mul(smoothstep(0.02, 0.16, fall).mul(float(1).sub(smoothstep(0.84, 1.0, fall)))).mul(uOp).mul(clamp(uI, 0.0, 1.6));
    alpha.lessThan(0.01).discard();
    return vec4(uCol, alpha);
  });
  return makeHandle(makeMat("weather-rain-node", frag(), wPos), uT, uI, uC, uWx, uWz);
}

export function createSnowNodeMaterial(): RainWeatherShaderHandle {
  const uC = uniform(new THREE.Vector3()) as TslNode, uT = uniform(0) as TslNode, uI = uniform(1) as TslNode;
  const uWx = uniform(-0.62) as TslNode, uWz = uniform(0.21) as TslNode;
  const uTop = uniform(18) as TslNode, uBot = uniform(-8) as TslNode;
  const uCol = uniform(new THREE.Color(0xf1f7ff)) as TslNode, uOp = uniform(0.76) as TslNode;
  const aOff: TslNode = attribute("aSnowOffset", "vec4"), aShp: TslNode = attribute("aSnowShape", "vec4");
  const sPos: TslNode = positionGeometry;
  const h: TslNode = max(uTop.sub(uBot), 0.001);
  const fall: TslNode = fract(aOff.y.sub(uT.mul(aOff.w).mul(max(uI, 0.05)).div(h)));
  const gust: TslNode = sin(uT.mul(float(0.7).add(aShp.w.mul(0.6))).add(aShp.w.mul(6.28318530718)));
  const center: TslNode = uC.add(vec3(aOff.x.add(uWx.mul(float(1).sub(fall)).mul(1.8)).add(aShp.z.mul(gust)), uBot.add(fall.mul(h)), aOff.z.add(uWz.mul(float(1).sub(fall)).mul(1.8)).add(cos(uT.mul(0.8).add(aShp.w.mul(12.56637061436))).mul(aShp.z).mul(0.55))));
  const wPos: TslNode = center.add(sPos.mul(aShp.x));
  const frag = Fn(() => {
    const p: TslNode = uv().mul(2.0).sub(1.0);
    const r: TslNode = length(p);
    r.greaterThan(1.05).discard();
    const core: TslNode = float(1).sub(smoothstep(0.18, 0.92, r));
    const arms: TslNode = float(1).sub(smoothstep(0.035, 0.16, min(min(abs(p.x), abs(p.y)), min(abs(p.x.add(p.y)), abs(p.x.sub(p.y))).mul(0.72)))).mul(float(1).sub(smoothstep(0.24, 1.0, r)));
    const sparkle: TslNode = float(0.88).add(sin(aShp.w.mul(37.0).add(p.x.mul(7.0)).add(p.y.mul(11.0))).mul(0.12));
    const fade: TslNode = smoothstep(0.03, 0.18, fall).mul(float(1).sub(smoothstep(0.86, 1.0, fall)));
    const alpha: TslNode = core.mul(0.82).add(arms.mul(0.46)).mul(float(1).sub(smoothstep(0.76, 1.05, r))).mul(sparkle).mul(aShp.y).mul(fade).mul(uOp).mul(clamp(uI, 0.0, 1.6));
    alpha.lessThan(0.01).discard();
    return vec4(uCol, alpha);
  });
  return makeHandle(makeMat("weather-snow-node", frag(), wPos), uT, uI, uC, uWx, uWz);
}

export function createSandstormNodeMaterial(): RainWeatherShaderHandle {
  const uC = uniform(new THREE.Vector3()) as TslNode, uT = uniform(0) as TslNode, uI = uniform(1) as TslNode;
  const uWx = uniform(-1.8) as TslNode, uWz = uniform(0.24) as TslNode;
  const uCol = uniform(new THREE.Color(0xb99757)) as TslNode, uOp = uniform(0.84) as TslNode;
  const aOff: TslNode = attribute("aSandOffset", "vec4"), aShp: TslNode = attribute("aSandShape", "vec4");
  const sPos: TslNode = positionGeometry;
  const wb: TslNode = vec3(uWx, 0.0, uWz);
  const wl: TslNode = max(length(wb), 0.001);
  const wd: TslNode = wb.div(wl);
  const sd: TslNode = vec3(wd.z.mul(-1.0), 0.0, wd.x);
  const travel: TslNode = fract(aOff.y.add(uT.mul(aShp.z).mul(max(uI, 0.05)).div(max(aOff.w, 0.001))));
  const along: TslNode = float(0.5).sub(travel).mul(aOff.w);
  const waveA: TslNode = sin(along.mul(0.48).add(aOff.x.mul(0.82)).add(uT.mul(2.35)).add(aShp.w.mul(0.011)));
  const waveB: TslNode = sin(along.mul(0.19).sub(aOff.x.mul(0.43)).sub(uT.mul(1.18)).add(aShp.w.mul(0.017)));
  const wave: TslNode = smoothstep(0.08, 0.92, waveA.mul(0.35).add(waveB.mul(0.25)).add(0.5));
  const gust: TslNode = sin(uT.mul(float(1.25).add(aShp.w.mul(0.0009))).add(aShp.w)).mul(mix(0.35, 1.0, wave));
  const lift: TslNode = sin(uT.mul(1.65).add(aShp.w.mul(1.37))).mul(mix(0.025, 0.11, wave));
  const center: TslNode = uC.add(wd.mul(along)).add(sd.mul(aOff.x.add(gust.mul(0.42)))).add(vec3(0.0, aOff.z.add(lift), 0.0));
  const wPos: TslNode = center.add(sd.mul(sPos.x).mul(aShp.x).mul(1.18)).add(vec3(0.0, sPos.y.mul(aShp.x).mul(0.52), 0.0)).add(wd.mul(sPos.z).mul(aShp.x).mul(2.65));
  const frag = Fn(() => {
    const p: TslNode = uv().mul(2.0).sub(1.0);
    const d: TslNode = length(vec3(p.x.mul(0.82), p.y.mul(1.18), 0.0));
    d.greaterThan(1.05).discard();
    const body: TslNode = float(1).sub(smoothstep(0.12, 0.92, d));
    const soft: TslNode = float(1).sub(smoothstep(0.0, 0.46, d));
    const fade: TslNode = smoothstep(0.02, 0.12, travel).mul(float(1).sub(smoothstep(0.88, 1.0, travel))).mul(mix(0.16, 1.18, wave));
    const alpha: TslNode = body.mul(0.60).add(soft.mul(0.24)).mul(float(0.64).add(sin(aShp.w.mul(11.7).add(p.x.mul(31.0)).add(p.y.mul(17.0))).mul(0.36))).mul(aShp.y).mul(fade).mul(uOp).mul(clamp(uI, 0.0, 1.6));
    alpha.lessThan(0.01).discard();
    return vec4(mix(uCol, vec3(0.93, 0.79, 0.54), soft.mul(0.35)), alpha);
  });
  return makeHandle(makeMat("weather-sandstorm-node", frag(), wPos), uT, uI, uC, uWx, uWz);
}

export function createSandstormHazeNodeMaterial(): RainWeatherShaderHandle {
  const uT = uniform(0) as TslNode, uI = uniform(1) as TslNode;
  const uCol = uniform(new THREE.Color(0xffdc95)) as TslNode, uOp = uniform(0.11) as TslNode;
  const frag = Fn(() => {
    const p: TslNode = uv();
    const edge: TslNode = smoothstep(0.0, 0.12, p.x).mul(float(1).sub(smoothstep(0.88, 1.0, p.x))).mul(smoothstep(0.0, 0.10, p.y)).mul(float(1).sub(smoothstep(0.86, 1.0, p.y)));
    const haze: TslNode = smoothstep(0.52, 1.0, sin(p.x.mul(8.0).add(uT.mul(0.42))).mul(0.5).add(0.5).mul(0.42).add(sin(p.y.mul(18.0).add(uT.mul(0.55)).add(sin(p.x.mul(8.0).add(uT.mul(0.42))).mul(0.5).add(0.5).mul(1.7))).mul(0.5).add(0.5).mul(0.42)).add(sin(p.x.add(p.y).mul(15.0).sub(uT.mul(0.36))).mul(0.5).add(0.5).mul(0.16)));
    const alpha: TslNode = haze.mul(edge).mul(uOp).mul(clamp(uI, 0.0, 1.6));
    alpha.lessThan(0.003).discard();
    return vec4(uCol, alpha);
  });
  return makeHandle(makeMat("weather-sandstorm-haze-node", frag()), uT, uI);
}

export function createStormNodeMaterial(): RainWeatherShaderHandle {
  const uT = uniform(0) as TslNode, uI = uniform(1) as TslNode;
  const uEC = uniform(new THREE.Color(0.3, 0.3, 1.0)) as TslNode, uMC = uniform(new THREE.Color(1.0, 1.0, 1.0)) as TslNode;
  const frag = Fn(() => {
    const p: TslNode = uv();
    const muv: TslNode = vec2(p.x.mul(2.0).sub(1.0), p.y.mul(2.0).sub(1.0).mul(4.0));
    const dist: TslNode = abs(muv.x.sub(0.5).add(fbm(vec2(muv.x.sub(0.5), muv.y).add(uT.mul(3.0)))));
    const flicker: TslNode = mix(0.0, 0.05, hash12(vec2(uT)));
    const fc: TslNode = uEC.mul(flicker).div(max(dist, 0.001));
    const alpha: TslNode = min(fc.r, 1.0).mul(clamp(uI, 0.0, 1.6));
    alpha.lessThan(0.003).discard();
    return vec4(fc.mul(uMC), alpha);
  });
  return makeHandle(makeMat("weather-storm-node", frag()), uT, uI);
}

export function createSplashNodeMaterial(kind: "hard" | "water"): RainWeatherShaderHandle {
  const uT = uniform(0) as TslNode, uRate = uniform(kind === "hard" ? 1.72 : 1.18) as TslNode, uI = uniform(1) as TslNode;
  const uCol = uniform(new THREE.Color(kind === "hard" ? 0xd9efff : 0x9fe6ff)) as TslNode, uOp = uniform(kind === "hard" ? 0.84 : 0.48) as TslNode;
  const aC: TslNode = attribute("aSplashCenter", "vec3"), aN: TslNode = attribute("aSplashNormal", "vec3");
  const aP: TslNode = attribute("aSplashParams", "vec4"), sPos: TslNode = positionGeometry;
  const age: TslNode = fract(uT.mul(uRate).add(aP.y));
  const grow: TslNode = smoothstep(0.0, 0.72, age);
  const scale: TslNode = aP.x.mul(mix(0.16, 1.0, grow));
  const c_: TslNode = cos(aP.z), s_: TslNode = sin(aP.z);
  const local = vec3(sPos.x.mul(c_).sub(sPos.y.mul(s_)), sPos.x.mul(s_).add(sPos.y.mul(c_)), 0.0);
  const n: TslNode = normalize(aN);
  const ref: TslNode = abs(n.y).lessThan(0.95).select(vec3(0.0, 1.0, 0.0), vec3(1.0, 0.0, 0.0));
  const tangent: TslNode = normalize(cross(ref, n));
  const bitangent: TslNode = normalize(cross(n, tangent));
  const wPos: TslNode = aC.add(tangent.mul(local.x).add(bitangent.mul(local.y)).mul(scale)).add(n.mul(0.035));
  const frag = kind === "hard" ? hardSplashFragment(age, aP, uCol, uOp, uI) : waterSplashFragment(age, aP, uCol, uOp, uI);
  return makeHandle(makeMat(`weather-${kind}-splash-node`, frag, wPos), uT, uI);
}
