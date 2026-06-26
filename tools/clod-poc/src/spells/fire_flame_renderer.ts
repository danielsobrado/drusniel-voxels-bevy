import type { FireSpellVfxConfig } from "./spell_config.js";

const VERTEX_SHADER_SOURCE = `
attribute vec2 aPosition;
varying vec2 vUv;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SOURCE = `
precision highp float;

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

interface FlameProgramState {
  program: WebGLProgram;
  buffer: WebGLBuffer;
  aPosition: number;
  uResolution: WebGLUniformLocation;
  uTime: WebGLUniformLocation;
  uProgress: WebGLUniformLocation;
  uScale: WebGLUniformLocation;
}

export class FireFlameRenderer {
  private layer: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGLRenderingContext | null = null;
  private state: FlameProgramState | null = null;
  private frameRequest = 0;
  private startMs = 0;
  private durationMs = 0;

  constructor(private readonly config: FireSpellVfxConfig) {}

  play(durationMs: number): void {
    this.durationMs = Math.max(250, durationMs);
    this.startMs = performance.now();
    this.ensureLayer();

    if (!this.layer || !this.canvas) return;
    this.layer.dataset.active = "true";
    delete this.layer.dataset.fallback;

    if (!this.ensureWebGl()) {
      this.runFallback(this.durationMs);
      return;
    }

    if (this.frameRequest) cancelAnimationFrame(this.frameRequest);
    this.frameRequest = requestAnimationFrame(this.renderFrame);
  }

  dispose(): void {
    if (this.frameRequest) cancelAnimationFrame(this.frameRequest);
    this.frameRequest = 0;
    this.state = null;
    this.gl = null;
    this.canvas?.remove();
    this.layer?.remove();
    this.canvas = null;
    this.layer = null;
  }

  private readonly renderFrame = (now: number): void => {
    if (!this.gl || !this.canvas || !this.state || !this.layer) return;

    const progress = Math.min(1, Math.max(0, (now - this.startMs) / this.durationMs));
    if (progress >= 1) {
      delete this.layer.dataset.active;
      this.frameRequest = 0;
      return;
    }

    this.resizeCanvas();
    const elapsedSeconds = (now - this.startMs) / 1000;
    const gl = this.gl;
    const state = this.state;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(state.program);
    gl.uniform2f(state.uResolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(state.uTime, elapsedSeconds);
    gl.uniform1f(state.uProgress, progress);
    gl.uniform1f(state.uScale, this.config.flameScale);
    gl.bindBuffer(gl.ARRAY_BUFFER, state.buffer);
    gl.enableVertexAttribArray(state.aPosition);
    gl.vertexAttribPointer(state.aPosition, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    this.frameRequest = requestAnimationFrame(this.renderFrame);
  };

  private ensureLayer(): void {
    if (this.layer && this.canvas) return;

    let layer = document.getElementById(this.config.layerId);
    if (!layer) {
      layer = document.createElement("div");
      layer.id = this.config.layerId;
      document.body.appendChild(layer);
    }
    layer.classList.add("spell-vfx-layer");

    let canvas = document.getElementById(this.config.canvasId) as HTMLCanvasElement | null;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.id = this.config.canvasId;
      layer.appendChild(canvas);
    }
    canvas.classList.add("spell-vfx-canvas");
    canvas.style.width = `${this.config.widthPx}px`;
    canvas.style.height = `${this.config.heightPx}px`;

    this.layer = layer;
    this.canvas = canvas;
    this.resizeCanvas();
  }

  private ensureWebGl(): boolean {
    if (this.gl && this.state) return true;
    if (!this.canvas) return false;

    const gl = this.canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      premultipliedAlpha: false,
      stencil: false,
    });
    if (!gl) return false;

    const vertex = this.compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
    const fragment = this.compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
    if (!vertex || !fragment) return false;

    const program = gl.createProgram();
    const buffer = gl.createBuffer();
    if (!program || !buffer) return false;

    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn("[spells] Fire shader link failed.", gl.getProgramInfoLog(program));
      return false;
    }

    const aPosition = gl.getAttribLocation(program, "aPosition");
    const uResolution = gl.getUniformLocation(program, "uResolution");
    const uTime = gl.getUniformLocation(program, "uTime");
    const uProgress = gl.getUniformLocation(program, "uProgress");
    const uScale = gl.getUniformLocation(program, "uScale");
    if (aPosition < 0 || !uResolution || !uTime || !uProgress || !uScale) {
      console.warn("[spells] Fire shader uniforms are incomplete.");
      return false;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      -1, 1,
      1, -1,
      1, 1,
    ]), gl.STATIC_DRAW);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.disable(gl.DEPTH_TEST);

    this.gl = gl;
    this.state = { program, buffer, aPosition, uResolution, uTime, uProgress, uScale };
    return true;
  }

  private compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn("[spells] Fire shader compile failed.", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  private resizeCanvas(): void {
    if (!this.canvas) return;
    const dpr = Math.min(this.config.maxDpr, Math.max(1, window.devicePixelRatio || 1));
    const width = Math.max(1, Math.floor(this.config.widthPx * dpr));
    const height = Math.max(1, Math.floor(this.config.heightPx * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  private runFallback(durationMs: number): void {
    if (!this.layer) return;
    this.layer.dataset.active = "true";
    this.layer.dataset.fallback = "true";
    window.setTimeout(() => {
      if (this.layer) delete this.layer.dataset.active;
    }, durationMs);
  }
}
