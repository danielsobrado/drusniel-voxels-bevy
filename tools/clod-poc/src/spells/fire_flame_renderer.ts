import type { FireSpellVfxConfig } from "./spell_config.js";
import { FIRE_FRAGMENT_SHADER_SOURCE, FIRE_VERTEX_SHADER_SOURCE } from "./fire_shader_sources.js";

const MIN_CAST_DURATION_MS = 250;
const WEBGL_CONTEXT_OPTIONS: WebGLContextAttributes = {
  alpha: true,
  antialias: false,
  depth: false,
  premultipliedAlpha: false,
  preserveDrawingBuffer: false,
  stencil: false,
};

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
  private fallbackReset = 0;
  private startMs = 0;
  private durationMs = 0;
  private contextLost = false;

  constructor(private readonly config: FireSpellVfxConfig) {}

  play(durationMs: number): void {
    this.durationMs = Math.max(MIN_CAST_DURATION_MS, durationMs);
    this.startMs = performance.now();
    this.clearFallbackReset();
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
    this.clearFallbackReset();
    this.releaseWebGlResources();
    this.canvas?.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas?.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.canvas?.remove();
    this.layer?.remove();
    this.canvas = null;
    this.layer = null;
    this.contextLost = false;
  }

  private readonly renderFrame = (now: number): void => {
    if (!this.gl || !this.canvas || !this.state || !this.layer) return;

    const progress = Math.min(1, Math.max(0, (now - this.startMs) / this.durationMs));
    if (progress >= 1) {
      this.deactivateLayer();
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

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    if (this.frameRequest) cancelAnimationFrame(this.frameRequest);
    this.frameRequest = 0;
    this.state = null;
    this.gl = null;
    this.runFallback(Math.max(MIN_CAST_DURATION_MS, this.durationMs));
  };

  private readonly onContextRestored = (): void => {
    this.contextLost = false;
    this.gl = null;
    this.state = null;
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
    layer.style.width = `min(${this.config.widthPx}px, calc(100vw - 28px))`;
    layer.style.height = `${this.config.heightPx}px`;

    let canvas = document.getElementById(this.config.canvasId) as HTMLCanvasElement | null;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.id = this.config.canvasId;
      layer.appendChild(canvas);
    }
    canvas.classList.add("spell-vfx-canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.addEventListener("webglcontextlost", this.onContextLost, false);
    canvas.addEventListener("webglcontextrestored", this.onContextRestored, false);

    this.layer = layer;
    this.canvas = canvas;
    this.resizeCanvas();
  }

  private ensureWebGl(): boolean {
    if (this.contextLost) return false;
    if (this.gl && this.state) return true;
    if (!this.canvas) return false;

    const gl = (
      this.canvas.getContext("webgl", WEBGL_CONTEXT_OPTIONS)
      ?? this.canvas.getContext("experimental-webgl", WEBGL_CONTEXT_OPTIONS)
    ) as WebGLRenderingContext | null;
    if (!gl) return false;

    const state = this.createProgramState(gl);
    if (!state) return false;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.disable(gl.DEPTH_TEST);

    this.gl = gl;
    this.state = state;
    return true;
  }

  private createProgramState(gl: WebGLRenderingContext): FlameProgramState | null {
    const vertex = this.compileShader(gl, gl.VERTEX_SHADER, FIRE_VERTEX_SHADER_SOURCE);
    const fragment = this.compileShader(gl, gl.FRAGMENT_SHADER, FIRE_FRAGMENT_SHADER_SOURCE);
    if (!vertex || !fragment) {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      return null;
    }

    const program = gl.createProgram();
    const buffer = gl.createBuffer();
    if (!program || !buffer) {
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (program) gl.deleteProgram(program);
      if (buffer) gl.deleteBuffer(buffer);
      return null;
    }

    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn("[spells] Fire shader link failed.", gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      gl.deleteBuffer(buffer);
      return null;
    }

    const aPosition = gl.getAttribLocation(program, "aPosition");
    const uResolution = gl.getUniformLocation(program, "uResolution");
    const uTime = gl.getUniformLocation(program, "uTime");
    const uProgress = gl.getUniformLocation(program, "uProgress");
    const uScale = gl.getUniformLocation(program, "uScale");
    if (aPosition < 0 || !uResolution || !uTime || !uProgress || !uScale) {
      console.warn("[spells] Fire shader uniforms are incomplete.");
      gl.deleteProgram(program);
      gl.deleteBuffer(buffer);
      return null;
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

    return { program, buffer, aPosition, uResolution, uTime, uProgress, uScale };
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

  private releaseWebGlResources(): void {
    if (this.gl && this.state) {
      this.gl.deleteBuffer(this.state.buffer);
      this.gl.deleteProgram(this.state.program);
    }
    this.state = null;
    this.gl = null;
  }

  private resizeCanvas(): void {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(this.config.maxDpr, Math.max(1, window.devicePixelRatio || 1));
    const width = Math.max(1, Math.floor((rect.width || this.config.widthPx) * dpr));
    const height = Math.max(1, Math.floor((rect.height || this.config.heightPx) * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  private runFallback(durationMs: number): void {
    if (!this.layer) return;
    this.layer.dataset.active = "true";
    this.layer.dataset.fallback = "true";
    this.clearFallbackReset();
    this.fallbackReset = window.setTimeout(() => this.deactivateLayer(), durationMs);
  }

  private deactivateLayer(): void {
    this.clearFallbackReset();
    if (!this.layer) return;
    delete this.layer.dataset.active;
    delete this.layer.dataset.fallback;
  }

  private clearFallbackReset(): void {
    if (!this.fallbackReset) return;
    window.clearTimeout(this.fallbackReset);
    this.fallbackReset = 0;
  }
}
