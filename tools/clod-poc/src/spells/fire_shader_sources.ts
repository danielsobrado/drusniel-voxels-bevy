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
    p = p * 2.04 + vec3(13.7, 7.1, 4.8);
    amp *= 0.5;
  }
  return value;
}

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  p.x *= uResolution.x / max(uResolution.y, 1.0);
  p.y += 0.95;
  p /= max(uScale, 0.001);

  float castIn = smoothstep(0.0, 0.08, uProgress);
  float castOut = 1.0 - smoothstep(0.78, 1.0, uProgress);
  float life = castIn * castOut;
  float flameVar = sin(uTime * 0.55) + 0.56 * sin(uTime * 0.134) + 0.22 * sin(uTime * 0.095);
  float reach = mix(0.56, 1.28, smoothstep(0.0, 0.22, uProgress)) * (1.0 + 0.04 * flameVar);
  float y = p.y / max(reach, 0.001);

  float baseMask = smoothstep(-0.02, 0.08, y) * (1.0 - smoothstep(1.02, 1.26, y));
  float coneWidth = (0.04 + 0.25 * pow(max(y, 0.0), 0.75)) * (1.0 - 0.54 * smoothstep(0.58, 1.10, y));
  coneWidth = max(coneWidth, 0.018);

  vec3 q = vec3(p.x / coneWidth, y * 2.7, uTime * 2.1);
  float warp = fbm(q * vec3(0.82, 1.38, 1.0) + vec3(0.0, -uTime * 3.1, uTime * 0.32));
  float fine = fbm(q * vec3(1.9, 2.7, 1.0) + vec3(5.0, -uTime * 6.0, 1.0));
  float body = 1.0 - abs(p.x) / coneWidth - y * 0.60 + warp * 0.58 + fine * 0.18;
  float density = smoothstep(0.10, 0.84, body) * baseMask;
  float core = smoothstep(0.78, 1.20, body + 0.24 * (1.0 - y)) * baseMask;

  float sparkNoise = noise(vec3(floor(vUv.x * 86.0), floor(vUv.y * 58.0), floor(uTime * 28.0)));
  float sparks = step(0.988, sparkNoise) * smoothstep(0.20, 0.95, y) * (1.0 - smoothstep(1.0, 1.24, y));

  vec3 outer = vec3(0.85, 0.12, 0.025);
  vec3 mid = vec3(1.0, 0.43, 0.07);
  vec3 hot = vec3(1.0, 0.88, 0.38);
  vec3 color = mix(outer, mid, density);
  color = mix(color, hot, core);
  color += vec3(1.0, 0.45, 0.08) * sparks * 0.55;

  float alpha = clamp((density * 0.88 + core * 0.35 + sparks * 0.24) * life, 0.0, 0.94);
  gl_FragColor = vec4(color * life, alpha);
}
`;
