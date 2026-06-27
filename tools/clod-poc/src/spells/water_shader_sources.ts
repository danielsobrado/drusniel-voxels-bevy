export const WATER_VERTEX_SHADER_SOURCE = `
attribute vec2 aPosition;
varying vec2 vUv;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const WATER_FRAGMENT_SHADER_SOURCE = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 uResolution;
uniform vec2 uOrigin;
uniform vec2 uTarget;
uniform float uTime;
uniform float uProgress;
uniform float uScale;
varying vec2 vUv;

float hash(float n) {
  return fract(sin(n) * 43758.5453123);
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
    p = p * 2.02 + vec3(9.7, 5.1, 12.4);
    amp *= 0.5;
  }
  return value;
}

float ring(float d, float radius, float thickness) {
  return 1.0 - smoothstep(thickness, thickness * 2.0, abs(d - radius));
}

void main() {
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = vec2((vUv.x - 0.5) * aspect, vUv.y - 0.5);

  vec2 origin = vec2(uOrigin.x * aspect, uOrigin.y);
  vec2 target = vec2(uTarget.x * aspect, uTarget.y);
  vec2 dir = normalize(target - origin);
  vec2 perp = vec2(-dir.y, dir.x);
  vec2 rel = p - origin;

  float along = dot(rel, dir);
  float side = dot(rel, perp);
  float castIn = smoothstep(0.0, 0.08, uProgress);
  float castOut = 1.0 - smoothstep(0.76, 1.0, uProgress);
  float life = castIn * castOut;
  float reach = mix(0.30, 1.38, smoothstep(0.0, 0.24, uProgress)) * max(uScale, 0.001);
  float t = along / max(reach, 0.001);

  float flow = fbm(vec3(t * 2.6, uTime * 2.1, 6.0));
  float wave = sin(t * 28.0 - uTime * 18.0 + flow * 4.0) * 0.018;
  float sideWarp = (flow - 0.5) * 0.10 * smoothstep(0.06, 0.82, t) + wave;
  float warpedSide = side + sideWarp;
  float pathMask = smoothstep(-0.02, 0.07, t) * (1.0 - smoothstep(0.98, 1.18, t));
  float streamWidth = mix(0.035, 0.18, pow(max(t, 0.0), 0.78));
  streamWidth *= 1.0 - 0.35 * smoothstep(0.72, 1.05, t);
  streamWidth = max(streamWidth, 0.018);

  vec3 q = vec3(warpedSide / streamWidth, t * 3.4, uTime * 2.6);
  float ribbonNoise = fbm(q * vec3(1.0, 1.7, 1.0) + vec3(0.0, -uTime * 4.5, 2.0));
  float foamNoise = fbm(q * vec3(2.4, 3.2, 1.0) + vec3(8.0, -uTime * 7.2, 4.0));
  float body = 1.0 - abs(warpedSide) / streamWidth - t * 0.30 + ribbonNoise * 0.42;
  float stream = smoothstep(0.08, 0.78, body) * pathMask * life;
  float core = smoothstep(0.58, 1.16, body + 0.20 * (1.0 - t)) * pathMask * life;
  float foam = smoothstep(0.70, 1.05, foamNoise + body * 0.28) * pathMask * life * smoothstep(0.10, 0.85, t);

  float handDist = length(vec2(side * 0.72, along * 1.35));
  float handGlow = (1.0 - smoothstep(0.04, 0.25, handDist)) * life;
  float waterRing = ring(handDist, 0.14 + 0.015 * sin(uTime * 6.0), 0.010) * life;
  float outerRing = ring(handDist, 0.22 + 0.018 * sin(uTime * 3.4), 0.008) * life * 0.45;

  vec2 dropletCell = floor(vec2((warpedSide + 0.55) * 92.0, t * 78.0));
  float dropletNoise = noise(vec3(dropletCell, floor(uTime * 30.0)));
  float droplets = step(0.985, dropletNoise) * smoothstep(0.16, 0.95, t) * (1.0 - smoothstep(1.0, 1.16, t)) * life;
  float mist = smoothstep(0.28, 0.72, fbm(vec3(p * vec2(2.2, 3.0), uTime * 1.8))) * pathMask * life * 0.10;

  vec3 deep = vec3(0.02, 0.24, 0.50);
  vec3 water = vec3(0.05, 0.62, 0.95);
  vec3 foamColor = vec3(0.72, 0.96, 1.0);
  vec3 glow = vec3(0.30, 0.86, 1.0);
  vec3 color = mix(deep, water, stream);
  color = mix(color, foamColor, core * 0.55 + foam * 0.65);
  color += glow * (handGlow * 0.42 + waterRing * 0.55 + outerRing * 0.35);
  color += foamColor * droplets * 0.55;
  color += vec3(0.16, 0.48, 0.72) * mist;

  float alpha = clamp(
    stream * 0.58
    + core * 0.32
    + foam * 0.36
    + handGlow * 0.30
    + waterRing * 0.44
    + outerRing * 0.25
    + droplets * 0.30
    + mist,
    0.0,
    0.88
  );
  gl_FragColor = vec4(color, alpha);
}
`;
