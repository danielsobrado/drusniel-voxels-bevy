import * as THREE from "three";
import type { RainWeatherShaderHandle } from "./rain_shader_handle.js";

const WIND_VERTEX = /* glsl */ `
attribute vec4 aWindOffset;
attribute vec4 aWindShape;
uniform vec3 uCenter;
uniform float uTime;
uniform float uIntensity;
uniform float uWindX;
uniform float uWindZ;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
varying float vLayer;

vec2 add2 = vec2(1.0, 0.0);
#define MOD3 vec3(.16532,.17369,.15787)

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * MOD3);
  p3 += dot(p3.zxy, p3.yxz + 19.19);
  return fract(vec2(p3.x * p3.y, p3.z * p3.x)) - 0.5;
}

vec2 noise22(vec2 x) {
  vec2 p = floor(x);
  vec2 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  vec2 res = mix(
    mix(hash22(p), hash22(p + add2.xy), f.x),
    mix(hash22(p + add2.yx), hash22(p + add2.xx), f.x),
    f.y
  );
  return res;
}

vec2 fbm22(vec2 x) {
  vec2 r = vec2(0.0);
  float a = 0.6;
  for (int i = 0; i < 6; i++) {
    r += noise22(x * a) / a;
    a += a;
  }
  return r;
}

void main() {
  vec3 windBase = vec3(uWindX, 0.0, uWindZ);
  float windLength = max(length(windBase), 0.001);
  vec3 windDir = windBase / windLength;
  vec3 side = vec3(-windDir.z, 0.0, windDir.x);
  float area = max(aWindOffset.w, 1.0);
  float speed = aWindShape.z * mix(0.25, 1.85, clamp(uIntensity, 0.0, 1.6));
  float travel = fract(aWindOffset.y + uTime * speed / area);
  float along = (0.5 - travel) * area;
  float seed = aWindShape.w;
  vec2 gust = fbm22(vec2(along * 0.055 + uTime * 0.52 + seed * 0.013, aWindOffset.z * 0.42 + seed * 0.019));
  vec2 gust2 = fbm22(vec2(uTime * 0.19 + seed * 0.031, along * 0.025 - aWindOffset.x * 0.018));
  float pulse = smoothstep(0.10, 0.95, gust.x * 0.45 + gust2.y * 0.30 + 0.48);
  float lowHug = 1.0 - smoothstep(0.2, 5.2, aWindOffset.z);
  float lift = (gust.y * 0.95 + gust2.x * 0.32) * mix(0.28, 1.20, lowHug);
  vec3 center = uCenter
    + windDir * along
    + side * (aWindOffset.x + gust.x * mix(0.55, 2.25, lowHug))
    + vec3(0.0, aWindOffset.z + lift, 0.0);

  float ribbonWidth = aWindShape.x * mix(0.65, 1.25, pulse);
  vec3 worldPosition = center
    + side * position.x * ribbonWidth
    + vec3(0.0, position.y * ribbonWidth * 0.42, 0.0)
    + windDir * position.z * ribbonWidth * mix(3.5, 7.5, pulse);

  vUv = uv;
  vSeed = seed;
  vLayer = lowHug;
  vAlpha = aWindShape.y
    * mix(0.18, 1.25, pulse)
    * smoothstep(0.02, 0.15, travel)
    * (1.0 - smoothstep(0.86, 1.0, travel));
  gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
}
`;

const WIND_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
varying float vLayer;

vec2 add2 = vec2(1.0, 0.0);
#define MOD3 vec3(.16532,.17369,.15787)

float tri(float x) { return abs(fract(x) - 0.5); }
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * MOD3);
  p3 += dot(p3.zxy, p3.yxz + 19.19);
  return fract(vec2(p3.x * p3.y, p3.z * p3.x)) - 0.5;
}
vec2 noise22(vec2 x) {
  vec2 p = floor(x);
  vec2 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash22(p), hash22(p + add2.xy), f.x), mix(hash22(p + add2.yx), hash22(p + add2.xx), f.x), f.y);
}
vec2 fbm22(vec2 x) {
  vec2 r = vec2(0.0);
  float a = 0.6;
  for (int i = 0; i < 6; i++) {
    r += noise22(x * a) / a;
    a += a;
  }
  return r;
}

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float body = 1.0 - smoothstep(0.05, 1.0, length(vec2(p.x * 0.72, p.y * 1.35)));
  float streak = 1.0 - smoothstep(0.04, 0.34, abs(p.y + fbm22(vec2(p.x * 2.2 + vSeed, uTime * 0.35)).x * 0.22));
  float filament = smoothstep(0.46, 0.96, tri(p.x * 5.5 + fbm22(vec2(p.y * 3.0 + vSeed, uTime * 0.22)).y * 2.8));
  float breakup = smoothstep(0.08, 0.80, body * 0.72 + streak * 0.24 + filament * 0.18);
  float alpha = breakup * (body * 0.70 + streak * 0.28) * vAlpha * uOpacity * clamp(uIntensity, 0.0, 1.6);
  if (alpha < 0.006) discard;
  vec3 pale = vec3(0.82, 0.94, 1.0);
  vec3 dust = vec3(0.72, 0.68, 0.55);
  vec3 color = mix(uColor, pale, streak * 0.42);
  color = mix(color, dust, vLayer * 0.32);
  gl_FragColor = vec4(color, alpha);
}
`;

export function createWindShaderMaterial(): RainWeatherShaderHandle {
  const uniforms = {
    uCenter: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uIntensity: { value: 1 },
    uWindX: { value: -2.2 },
    uWindZ: { value: 0.36 },
    uColor: { value: new THREE.Color(0xb8d5df) },
    uOpacity: { value: 0.42 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: WIND_VERTEX,
    fragmentShader: WIND_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });
  material.name = "weather-wind-shader";
  return {
    material,
    setTime: (time) => { uniforms.uTime.value = time; },
    setIntensity: (intensity) => { uniforms.uIntensity.value = intensity; },
    setCenter: (center) => { uniforms.uCenter.value.copy(center); },
    setWind: (x, z) => { uniforms.uWindX.value = x; uniforms.uWindZ.value = z; },
    dispose: () => { material.dispose(); },
  };
}
