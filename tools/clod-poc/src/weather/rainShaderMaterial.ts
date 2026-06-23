import * as THREE from "three";

export interface RainWeatherShaderHandle {
  material: THREE.Material;
  setTime(time: number): void;
  setIntensity(intensity: number): void;
  setCenter(center: THREE.Vector3): void;
  setWind(x: number, z: number): void;
  dispose(): void;
}

const RAIN_VERTEX = /* glsl */ `
attribute vec4 aRainOffset;
attribute vec4 aRainShape;
uniform vec3 uCenter;
uniform float uTime;
uniform float uIntensity;
uniform float uWindX;
uniform float uWindZ;
uniform float uTopY;
uniform float uBottomY;
varying vec2 vUv;
varying float vFade;

void main() {
  float height = max(0.001, uTopY - uBottomY);
  float fall = fract(aRainOffset.y - uTime * aRainOffset.w * max(uIntensity, 0.08) / height);
  vec3 streakDir = normalize(vec3(uWindX, -8.0, uWindZ));
  vec3 side = cross(streakDir, vec3(0.0, 1.0, 0.0));
  if (dot(side, side) < 0.0001) side = vec3(1.0, 0.0, 0.0);
  side = normalize(side);

  vec3 head = uCenter + vec3(
    aRainOffset.x + uWindX * (1.0 - fall) * 0.35,
    uBottomY + fall * height,
    aRainOffset.z + uWindZ * (1.0 - fall) * 0.35
  );
  vec3 worldPosition = head
    + side * position.x * aRainShape.y
    + streakDir * position.y * aRainShape.x;

  vUv = uv;
  vFade = smoothstep(0.02, 0.16, fall) * (1.0 - smoothstep(0.84, 1.0, fall));
  gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
}
`;

const RAIN_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uIntensity;
varying vec2 vUv;
varying float vFade;

void main() {
  float center = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float width = smoothstep(0.0, 0.55, center);
  float tail = smoothstep(0.0, 0.2, vUv.y) * (1.0 - smoothstep(0.82, 1.0, vUv.y));
  float alpha = width * tail * vFade * uOpacity * clamp(uIntensity, 0.0, 1.6);
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(uColor, alpha);
}
`;

const SNOW_VERTEX = /* glsl */ `
attribute vec4 aSnowOffset;
attribute vec4 aSnowShape;
uniform vec3 uCenter;
uniform float uTime;
uniform float uIntensity;
uniform float uWindX;
uniform float uWindZ;
uniform float uTopY;
uniform float uBottomY;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;

void main() {
  float height = max(0.001, uTopY - uBottomY);
  float fall = fract(aSnowOffset.y - uTime * aSnowOffset.w * max(uIntensity, 0.05) / height);
  float gust = sin(uTime * (0.7 + aSnowShape.w * 0.6) + aSnowShape.w * 6.28318530718);
  float lateral = aSnowShape.z * gust;
  vec3 center = uCenter + vec3(
    aSnowOffset.x + uWindX * (1.0 - fall) * 1.8 + lateral,
    uBottomY + fall * height,
    aSnowOffset.z + uWindZ * (1.0 - fall) * 1.8 + cos(uTime * 0.8 + aSnowShape.w * 12.56637061436) * aSnowShape.z * 0.55
  );
  vec3 worldPosition = center + position * aSnowShape.x;

  vUv = uv;
  vSeed = aSnowShape.w;
  vAlpha = aSnowShape.y * smoothstep(0.03, 0.18, fall) * (1.0 - smoothstep(0.86, 1.0, fall));
  gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
}
`;

const SNOW_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uIntensity;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.05) discard;
  float core = 1.0 - smoothstep(0.18, 0.92, r);
  float axis = min(abs(p.x), abs(p.y));
  float diag = min(abs(p.x + p.y), abs(p.x - p.y)) * 0.72;
  float arms = (1.0 - smoothstep(0.035, 0.16, min(axis, diag))) * (1.0 - smoothstep(0.24, 1.0, r));
  float edge = 1.0 - smoothstep(0.76, 1.05, r);
  float sparkle = 0.88 + 0.12 * sin(vSeed * 37.0 + p.x * 7.0 + p.y * 11.0);
  float alpha = (core * 0.82 + arms * 0.46) * edge * sparkle * vAlpha * uOpacity * clamp(uIntensity, 0.0, 1.6);
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(uColor, alpha);
}
`;

const SANDSTORM_VERTEX = /* glsl */ `
attribute vec4 aSandOffset;
attribute vec4 aSandShape;
uniform vec3 uCenter;
uniform float uTime;
uniform float uIntensity;
uniform float uWindX;
uniform float uWindZ;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;

void main() {
  vec3 windBase = vec3(uWindX, 0.0, uWindZ);
  float windLength = max(length(windBase), 0.001);
  vec3 windDir = windBase / windLength;
  vec3 side = vec3(-windDir.z, 0.0, windDir.x);
  float travel = fract(aSandOffset.y + uTime * aSandShape.z * max(uIntensity, 0.05) / max(aSandOffset.w, 0.001));
  float along = (0.5 - travel) * aSandOffset.w;
  float waveA = sin(along * 0.48 + aSandOffset.x * 0.82 + uTime * 2.35 + aSandShape.w * 0.011);
  float waveB = sin(along * 0.19 - aSandOffset.x * 0.43 - uTime * 1.18 + aSandShape.w * 0.017);
  float wave = smoothstep(0.08, 0.92, waveA * 0.35 + waveB * 0.25 + 0.5);
  float gust = sin(uTime * (1.25 + aSandShape.w * 0.0009) + aSandShape.w) * mix(0.35, 1.0, wave);
  float lift = sin(uTime * 1.65 + aSandShape.w * 1.37) * mix(0.025, 0.11, wave);
  vec3 center = uCenter
    + windDir * along
    + side * (aSandOffset.x + gust * 0.42)
    + vec3(0.0, aSandOffset.z + lift, 0.0);

  vec3 worldPosition = center
    + side * position.x * aSandShape.x * 1.18
    + vec3(0.0, position.y * aSandShape.x * 0.52, 0.0)
    + windDir * position.z * aSandShape.x * 2.65;

  vUv = uv;
  vSeed = aSandShape.w;
  vAlpha = aSandShape.y
    * mix(0.16, 1.18, wave)
    * smoothstep(0.02, 0.12, travel)
    * (1.0 - smoothstep(0.88, 1.0, travel));
  gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
}
`;

const SANDSTORM_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uIntensity;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float d = length(vec2(p.x * 0.82, p.y * 1.18));
  if (d > 1.05) discard;
  float body = 1.0 - smoothstep(0.12, 0.92, d);
  float soft = 1.0 - smoothstep(0.0, 0.46, d);
  float grain = 0.64 + 0.36 * sin(vSeed * 11.7 + p.x * 31.0 + p.y * 17.0);
  float alpha = (body * 0.60 + soft * 0.24) * grain * vAlpha * uOpacity * clamp(uIntensity, 0.0, 1.6);
  if (alpha < 0.01) discard;
  vec3 warm = vec3(0.93, 0.79, 0.54);
  vec3 color = mix(uColor, warm, soft * 0.35);
  gl_FragColor = vec4(color, alpha);
}
`;

const SANDSTORM_HAZE_VERTEX = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SANDSTORM_HAZE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uIntensity;
uniform float uOpacity;
varying vec2 vUv;

void main() {
  float edgeFade = smoothstep(0.0, 0.12, vUv.x) * (1.0 - smoothstep(0.88, 1.0, vUv.x));
  edgeFade *= smoothstep(0.0, 0.10, vUv.y) * (1.0 - smoothstep(0.86, 1.0, vUv.y));
  float waveA = sin(vUv.x * 8.0 + uTime * 0.42) * 0.5 + 0.5;
  float waveB = sin(vUv.y * 18.0 + uTime * 0.55 + waveA * 1.7) * 0.5 + 0.5;
  float waveC = sin((vUv.x + vUv.y) * 15.0 - uTime * 0.36) * 0.5 + 0.5;
  float haze = smoothstep(0.52, 1.0, waveA * 0.42 + waveB * 0.42 + waveC * 0.16);
  float alpha = haze * edgeFade * uOpacity * clamp(uIntensity, 0.0, 1.6);
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(uColor, alpha);
}
`;

const SPLASH_VERTEX = /* glsl */ `
attribute vec3 aSplashCenter;
attribute vec3 aSplashNormal;
attribute vec4 aSplashParams;
uniform float uTime;
uniform float uRate;
varying vec2 vLocal;
varying float vAge;
varying float vActive;

void main() {
  float age = fract(uTime * uRate + aSplashParams.y);
  float grow = smoothstep(0.0, 0.72, age);
  float scale = aSplashParams.x * mix(0.16, 1.0, grow);
  float c = cos(aSplashParams.z);
  float s = sin(aSplashParams.z);
  vec2 local = vec2(
    position.x * c - position.y * s,
    position.x * s + position.y * c
  );

  vec3 n = normalize(aSplashNormal);
  vec3 ref = abs(n.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 tangent = normalize(cross(ref, n));
  vec3 bitangent = normalize(cross(n, tangent));
  vec3 worldPosition = aSplashCenter + (tangent * local.x + bitangent * local.y) * scale + n * 0.035;

  vLocal = position.xy;
  vAge = age;
  vActive = aSplashParams.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
}
`;

const HARD_SPLASH_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uIntensity;
varying vec2 vLocal;
varying float vAge;
varying float vActive;

void main() {
  float r = length(vLocal);
  if (r > 1.04) discard;
  float radius = mix(0.18, 0.78, smoothstep(0.0, 0.78, vAge));
  float ring = 1.0 - smoothstep(0.018, 0.075, abs(r - radius));
  float axis = min(abs(vLocal.x), abs(vLocal.y));
  float diag = min(abs(vLocal.x + vLocal.y), abs(vLocal.x - vLocal.y)) * 0.7;
  float ray = (1.0 - smoothstep(0.025, 0.13, min(axis, diag)))
    * smoothstep(0.08, 0.24, r)
    * (1.0 - smoothstep(0.52, 1.0, r));
  float center = 1.0 - smoothstep(0.02, 0.16, r);
  float fade = (1.0 - smoothstep(0.58, 1.0, vAge)) * smoothstep(0.0, 0.08, vAge);
  float alpha = (ring * 0.62 + ray * 0.55 + center * 0.32) * fade * vActive * uOpacity * clamp(uIntensity, 0.0, 1.6);
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(uColor, alpha);
}
`;

const WATER_SPLASH_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uIntensity;
varying vec2 vLocal;
varying float vAge;
varying float vActive;

void main() {
  float r = length(vLocal);
  if (r > 1.04) discard;
  float radiusA = mix(0.14, 0.86, smoothstep(0.0, 0.9, vAge));
  float radiusB = mix(0.04, 0.54, smoothstep(0.14, 0.96, vAge));
  float ringA = 1.0 - smoothstep(0.015, 0.055, abs(r - radiusA));
  float ringB = 1.0 - smoothstep(0.012, 0.045, abs(r - radiusB));
  float center = (1.0 - smoothstep(0.03, 0.13, r)) * (1.0 - smoothstep(0.0, 0.35, vAge));
  float fade = (1.0 - smoothstep(0.62, 1.0, vAge)) * smoothstep(0.0, 0.07, vAge);
  float alpha = (ringA * 0.76 + ringB * 0.42 + center * 0.18) * fade * vActive * uOpacity * clamp(uIntensity, 0.0, 1.6);
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(uColor, alpha);
}
`;

export function createRainShaderMaterial(): RainWeatherShaderHandle {
  const uniforms = {
    uCenter: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uIntensity: { value: 1 },
    uWindX: { value: -1.05 },
    uWindZ: { value: 0.28 },
    uTopY: { value: 20 },
    uBottomY: { value: -12 },
    uColor: { value: new THREE.Color(0xb9dcff) },
    uOpacity: { value: 0.46 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: RAIN_VERTEX,
    fragmentShader: RAIN_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });
  material.name = "weather-rain-shader";
  return {
    material,
    setTime: (time) => { uniforms.uTime.value = time; },
    setIntensity: (intensity) => { uniforms.uIntensity.value = intensity; },
    setCenter: (center) => { uniforms.uCenter.value.copy(center); },
    setWind: (x, z) => { uniforms.uWindX.value = x; uniforms.uWindZ.value = z; },
    dispose: () => { material.dispose(); },
  };
}

export function createSnowShaderMaterial(): RainWeatherShaderHandle {
  const uniforms = {
    uCenter: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uIntensity: { value: 1 },
    uWindX: { value: -0.62 },
    uWindZ: { value: 0.21 },
    uTopY: { value: 18 },
    uBottomY: { value: -8 },
    uColor: { value: new THREE.Color(0xf1f7ff) },
    uOpacity: { value: 0.76 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SNOW_VERTEX,
    fragmentShader: SNOW_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });
  material.name = "weather-snow-shader";
  return {
    material,
    setTime: (time) => { uniforms.uTime.value = time; },
    setIntensity: (intensity) => { uniforms.uIntensity.value = intensity; },
    setCenter: (center) => { uniforms.uCenter.value.copy(center); },
    setWind: (x, z) => { uniforms.uWindX.value = x; uniforms.uWindZ.value = z; },
    dispose: () => { material.dispose(); },
  };
}

export function createSandstormShaderMaterial(): RainWeatherShaderHandle {
  const uniforms = {
    uCenter: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uIntensity: { value: 1 },
    uWindX: { value: -1.8 },
    uWindZ: { value: 0.24 },
    uColor: { value: new THREE.Color(0xb99757) },
    uOpacity: { value: 0.84 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SANDSTORM_VERTEX,
    fragmentShader: SANDSTORM_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });
  material.name = "weather-sandstorm-shader";
  return {
    material,
    setTime: (time) => { uniforms.uTime.value = time; },
    setIntensity: (intensity) => { uniforms.uIntensity.value = intensity; },
    setCenter: (center) => { uniforms.uCenter.value.copy(center); },
    setWind: (x, z) => { uniforms.uWindX.value = x; uniforms.uWindZ.value = z; },
    dispose: () => { material.dispose(); },
  };
}

export function createSandstormHazeShaderMaterial(): RainWeatherShaderHandle {
  const uniforms = {
    uCenter: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uIntensity: { value: 1 },
    uWindX: { value: -1.8 },
    uWindZ: { value: 0.24 },
    uColor: { value: new THREE.Color(0xffdc95) },
    uOpacity: { value: 0.11 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SANDSTORM_HAZE_VERTEX,
    fragmentShader: SANDSTORM_HAZE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  material.name = "weather-sandstorm-haze-shader";
  return {
    material,
    setTime: (time) => { uniforms.uTime.value = time; },
    setIntensity: (intensity) => { uniforms.uIntensity.value = intensity; },
    setCenter: (center) => { uniforms.uCenter.value.copy(center); },
    setWind: (x, z) => { uniforms.uWindX.value = x; uniforms.uWindZ.value = z; },
    dispose: () => { material.dispose(); },
  };
}

export function createSplashShaderMaterial(kind: "hard" | "water"): RainWeatherShaderHandle {
  const uniforms = {
    uCenter: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uRate: { value: kind === "hard" ? 1.72 : 1.18 },
    uIntensity: { value: 1 },
    uWindX: { value: 0 },
    uWindZ: { value: 0 },
    uColor: { value: new THREE.Color(kind === "hard" ? 0xd9efff : 0x9fe6ff) },
    uOpacity: { value: kind === "hard" ? 0.84 : 0.48 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SPLASH_VERTEX,
    fragmentShader: kind === "hard" ? HARD_SPLASH_FRAGMENT : WATER_SPLASH_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });
  material.name = `weather-${kind}-splash-shader`;
  return {
    material,
    setTime: (time) => { uniforms.uTime.value = time; },
    setIntensity: (intensity) => { uniforms.uIntensity.value = intensity; },
    setCenter: (center) => { uniforms.uCenter.value.copy(center); },
    setWind: (x, z) => { uniforms.uWindX.value = x; uniforms.uWindZ.value = z; },
    dispose: () => { material.dispose(); },
  };
}
