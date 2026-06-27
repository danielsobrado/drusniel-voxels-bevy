export const FIRE_VERTEX_SHADER_SOURCE = `
attribute vec2 aPosition;
varying vec2 vUv;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const FIRE_FRAGMENT_SHADER_SOURCE = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 uResolution;
uniform float uTime;
uniform float uProgress;
uniform float uScale;
varying vec2 vUv;

float hash(float n) {
  return fract(sin(n) * 753.5453123);
}

float noise(vec3 x) {
  vec3 p = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float n = p.x + p.y * 157.0 + 113.0 * p.z;
  return mix(
    mix(mix(hash(n + 0.0), hash(n + 1.0), f.x), mix(hash(n + 157.0), hash(n + 158.0), f.x), f.y),
    mix(mix(hash(n + 113.0), hash(n + 114.0), f.x), mix(hash(n + 270.0), hash(n + 271.0), f.x), f.y),
    f.z
  );
}

float fbm(vec3 p) {
  float value = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amp * noise(p);
    p = p * 2.03 + vec3(13.7, 7.1, 4.8);
    amp *= 0.5;
  }
  return value;
}

float ring(float d, float radius, float thickness) {
  return 1.0 - smoothstep(thickness, thickness * 1.85, abs(d - radius));
}

void main() {
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = vec2((vUv.x - 0.5) * aspect, vUv.y - 0.5);

  vec2 origin = vec2(0.33 * aspect, -0.47);
  vec2 target = vec2(0.0, 0.055);
  vec2 dir = normalize(target - origin);
  vec2 perp = vec2(-dir.y, dir.x);
  vec2 rel = p - origin;

  float along = dot(rel, dir);
  float side = dot(rel, perp);
  float castIn = smoothstep(0.0, 0.07, uProgress);
  float castOut = 1.0 - smoothstep(0.78, 1.0, uProgress);
  float life = castIn * castOut;
  float flameVar = sin(uTime * 0.55) + 0.56 * sin(uTime * 0.134) + 0.22 * sin(uTime * 0.095);
  float reach = mix(0.38, 1.47, smoothstep(0.0, 0.24, uProgress)) * max(uScale, 0.001);
  float t = along / max(reach, 0.001);

  float centerNoise = fbm(vec3(t * 2.2, uTime * 1.7, 3.0));
  float sideWarp = (centerNoise - 0.5) * 0.115 * smoothstep(0.08, 0.86, t);
  float warpedSide = side + sideWarp;
  float baseMask = smoothstep(-0.02, 0.08, t) * (1.0 - smoothstep(0.92, 1.13, t));
  float coneWidth = mix(0.035, 0.255, pow(max(t, 0.0), 0.74));
  coneWidth *= 1.0 - 0.58 * smoothstep(0.68, 1.05, t);
  coneWidth = max(coneWidth, 0.022);

  vec3 q = vec3(warpedSide / coneWidth, t * 3.15, uTime * 2.3);
  float rolling = fbm(q * vec3(0.86, 1.42, 1.0) + vec3(0.0, -uTime * 3.2, uTime * 0.25));
  float fine = fbm(q * vec3(2.3, 3.0, 1.0) + vec3(5.0, -uTime * 6.5, 1.0));
  float body = 1.0 - abs(warpedSide) / coneWidth - t * 0.46 + rolling * 0.68 + fine * 0.20;
  float density = smoothstep(0.10, 0.86, body) * baseMask * life;
  float core = smoothstep(0.82, 1.28, body + 0.26 * (1.0 - t)) * baseMask * life;

  float palmDist = length(vec2(side * 0.72, along * 1.24));
  float palmGlow = (1.0 - smoothstep(0.04, 0.28, palmDist)) * life;
  float magicRing = ring(palmDist, 0.145 + 0.016 * sin(uTime * 7.0), 0.010) * life;
  float runePulse = ring(palmDist, 0.215 + 0.020 * sin(uTime * 4.2), 0.008) * life * 0.55;

  vec2 cell = floor(vec2((warpedSide + 0.52) * 92.0, t * 74.0));
  float sparkNoise = noise(vec3(cell, floor(uTime * 32.0)));
  float sparkLine = smoothstep(0.18, 0.96, t) * (1.0 - smoothstep(1.0, 1.14, t));
  float sparks = step(0.986, sparkNoise) * sparkLine * life;
  float emberTrail = step(0.993, noise(vec3(cell + 17.0, floor(uTime * 18.0)))) * smoothstep(0.08, 0.58, t) * life;

  float heat = fbm(vec3(p * vec2(2.0, 3.0), uTime * 2.0));
  float heatVeil = smoothstep(0.16, 0.88, body + heat * 0.25) * baseMask * life * 0.11;

  vec3 ember = vec3(0.85, 0.12, 0.025);
  vec3 flame = vec3(1.0, 0.42, 0.07);
  vec3 hot = vec3(1.0, 0.88, 0.36);
  vec3 arcane = vec3(1.0, 0.37, 0.12);
  vec3 color = mix(ember, flame, density);
  color = mix(color, hot, core);
  color += hot * palmGlow * 0.78;
  color += arcane * (magicRing + runePulse) * 0.95;
  color += vec3(1.0, 0.55, 0.12) * sparks * 0.75;
  color += vec3(1.0, 0.22, 0.06) * emberTrail * 0.36;
  color += vec3(0.70, 0.23, 0.08) * heatVeil;

  float alpha = clamp(
    density * 0.72
    + core * 0.34
    + palmGlow * 0.48
    + magicRing * 0.55
    + runePulse * 0.34
    + sparks * 0.38
    + emberTrail * 0.18
    + heatVeil,
    0.0,
    0.96
  );
  gl_FragColor = vec4(color, alpha);
}
`;
