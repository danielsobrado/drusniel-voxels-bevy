import * as THREE from "three";

export interface PostProcessSettings {
  enabled: boolean;
  opacity: number;
  exposure: number;
  contrast: number;
  saturation: number;
  vignette: number;
  debugMode: "output" | "copy" | "off";
}

export const DEFAULT_POST_PROCESS_SETTINGS: PostProcessSettings = {
  enabled: true,
  opacity: 1.0,
  exposure: 1.0,
  contrast: 1.0,
  saturation: 1.0,
  vignette: 0.0,
  debugMode: "output",
};

const FULLSCREEN_VERT = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const COPY_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uOpacity;
  varying vec2 vUv;

  void main() {
    vec4 color = texture2D(tDiffuse, vUv);
    gl_FragColor = vec4(color.rgb, color.a * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const OUTPUT_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uExposure;
  uniform float uContrast;
  uniform float uSaturation;
  uniform float uVignette;
  varying vec2 vUv;

  void main() {
    vec4 sampled = texture2D(tDiffuse, vUv);
    vec3 color = sampled.rgb * uExposure;
    color = (color - 0.5) * uContrast + 0.5;

    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(vec3(luma), color, uSaturation);

    vec2 center = vUv - 0.5;
    float vignetteMask = smoothstep(0.2, 0.75, length(center));
    color *= 1.0 - uVignette * vignetteMask;
    color = max(color, vec3(0.0));

    gl_FragColor = vec4(color, sampled.a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const POSTPROCESS_SHADER_TEST_HOOKS = {
  fullscreenVertex: FULLSCREEN_VERT,
  copyFragment: COPY_FRAG,
  outputFragment: OUTPUT_FRAG,
} as const;

function createFullscreenTriangle(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  return geometry;
}

export class PostProcessPipeline {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly target: THREE.WebGLRenderTarget;
  private readonly fullscreenScene = new THREE.Scene();
  private readonly fullscreenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly fullscreenGeometry = createFullscreenTriangle();
  private readonly copyMaterial: THREE.ShaderMaterial;
  private readonly outputMaterial: THREE.ShaderMaterial;
  private readonly fullscreenMesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly drawingBufferSize = new THREE.Vector2();
  private settings: PostProcessSettings;

  constructor(renderer: THREE.WebGLRenderer, settings: PostProcessSettings) {
    this.renderer = renderer;
    this.settings = { ...settings };
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.target.texture.name = "clod-poc-postprocess-color";

    this.copyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.target.texture },
        uOpacity: { value: settings.opacity },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: COPY_FRAG,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      toneMapped: true,
    });
    this.outputMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.target.texture },
        uExposure: { value: settings.exposure },
        uContrast: { value: settings.contrast },
        uSaturation: { value: settings.saturation },
        uVignette: { value: settings.vignette },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: OUTPUT_FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: true,
    });

    this.fullscreenMesh = new THREE.Mesh(this.fullscreenGeometry, this.outputMaterial);
    this.fullscreenMesh.frustumCulled = false;
    this.fullscreenScene.add(this.fullscreenMesh);
    this.updateSettings(settings);
  }

  setSize(width: number, height: number): void {
    // The render target uses physical pixels so it tracks renderer pixel ratio without
    // changing the public resize API, which continues to receive CSS pixel dimensions.
    this.renderer.getDrawingBufferSize(this.drawingBufferSize);
    const pixelRatio = this.renderer.getPixelRatio();
    const targetWidth = this.drawingBufferSize.x || Math.floor(width * pixelRatio);
    const targetHeight = this.drawingBufferSize.y || Math.floor(height * pixelRatio);
    this.target.setSize(Math.max(1, targetWidth), Math.max(1, targetHeight));
  }

  updateSettings(settings: Partial<PostProcessSettings>): void {
    this.settings = { ...this.settings, ...settings };
    this.copyMaterial.uniforms.uOpacity.value = this.settings.opacity;
    this.outputMaterial.uniforms.uExposure.value = this.settings.exposure;
    this.outputMaterial.uniforms.uContrast.value = this.settings.contrast;
    this.outputMaterial.uniforms.uSaturation.value = this.settings.saturation;
    this.outputMaterial.uniforms.uVignette.value = this.settings.vignette;
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (!this.settings.enabled || this.settings.debugMode === "off") {
      this.renderer.setRenderTarget(null);
      this.renderer.render(scene, camera);
      return;
    }

    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);

    this.renderer.setRenderTarget(null);
    this.fullscreenMesh.material = this.settings.debugMode === "copy"
      ? this.copyMaterial
      : this.outputMaterial;
    this.renderer.render(this.fullscreenScene, this.fullscreenCamera);
  }

  dispose(): void {
    this.target.dispose();
    this.fullscreenGeometry.dispose();
    this.copyMaterial.dispose();
    this.outputMaterial.dispose();
  }
}
