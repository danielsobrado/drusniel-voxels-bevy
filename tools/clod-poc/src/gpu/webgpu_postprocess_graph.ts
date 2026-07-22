import * as THREE from "three";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { screenUV, vec4 } from "three/tsl";
import type { EnvironmentLighting } from "../environment/environment.js";
import type { PostProcessSettings } from "../environment/postprocess.js";
import { buildDustGodRays, projectSunToScreen, sunScreenFade } from "./god_rays_screen.js";
import type { PostFxFroxelDebugMode } from "./postfx_atmosphere.js";
import type { PostFxBounceSettings } from "./postfx_bounce.js";
import type { PostFxCloudSettings } from "./postfx_clouds.js";
import {
  createVolumetricCloudCompositeNode,
  createVolumetricCloudLayerNode,
} from "./postfx_cloud_nodes.js";
import type { PostFxGtaoSettings } from "./postfx_gtao.js";
import { HalfResMrtNode, type HalfResEntry } from "./postfx_half_res_mrt.js";
import type { PostFxStage } from "./postfx_stage_flags.js";
import {
  createBounceCompositeNode,
  createBounceHalfResLayerNode,
  createBouncePostProcessNode,
  createContactShadowPostProcessNode,
  createGradePostProcessNode,
  createGtaoBilateralUpsampleNode,
  createGtaoHalfResLayerNode,
  createGtaoPostProcessNode,
  createTraaPostProcessNode,
  type TslAny,
} from "./webgpu_postprocess_nodes.js";

const DEFAULT_ALPHA = 1.0;

type NumericUniform = { value: number };
type MatrixUniform = { value: THREE.Matrix4 };
type VectorUniform = { value: THREE.Vector3 };
type Vector2Uniform = { value: THREE.Vector2 };

export interface WebGpuPostProcessGraphUniforms {
  uExposure: NumericUniform;
  uContrast: NumericUniform;
  uSaturation: NumericUniform;
  uVignette: NumericUniform;
  uOpacity: NumericUniform;
  uWhiteBalance: VectorUniform;
  uShadowTint: VectorUniform;
  uHighlightTint: VectorUniform;
  uShadowAmount: NumericUniform;
  uHighlightAmount: NumericUniform;
  uSunDirection: VectorUniform;
  uContactStrength: NumericUniform;
  uContactRadius: NumericUniform;
  uContactDepthBias: NumericUniform;
  uBounceStrength: NumericUniform;
  uBounceRadius: NumericUniform;
  uBounceMaxDistance: NumericUniform;
  uBounceDepthTolerance: NumericUniform;
  uBounceMinUvRadius: NumericUniform;
  uBounceMaxUvRadius: NumericUniform;
  uGtaoStrength: NumericUniform;
  uGtaoRadius: NumericUniform;
  uGtaoMaxDistance: NumericUniform;
  uGtaoFadeEnd: NumericUniform;
  uGtaoDepthBias: NumericUniform;
  uGtaoDepthTolerance: NumericUniform;
  uGtaoMinUvRadius: NumericUniform;
  uGtaoMaxUvRadius: NumericUniform;
  uProjectionInverse: MatrixUniform;
  uCameraWorld: MatrixUniform;
  uCameraPosition: VectorUniform;
  uProjection: MatrixUniform;
  uView: MatrixUniform;
  uPrevView: MatrixUniform;
  uPrevProjection: MatrixUniform;
  uSunScreenUv: Vector2Uniform;
  uGodRaysIntensity: NumericUniform;
  uGodRaysDensity: NumericUniform;
  uGodRaysDecay: NumericUniform;
  uGodRaysWeight: NumericUniform;
  uGodRaysExposure: NumericUniform;
  uGodRaysDustStrength: NumericUniform;
  uGodRaysDustScale: NumericUniform;
  uGodRaysDustSpeed: NumericUniform;
  uGodRaysTint: VectorUniform;
}

/** Stage-graph host: façade supplies live settings, flags, froxel aerial, and exposure node. */
export interface WebGpuPostProcessGraphHost {
  settings: Required<PostProcessSettings>;
  bounce: PostFxBounceSettings;
  clouds: PostFxCloudSettings;
  gtao: PostFxGtaoSettings;
  bounceEnabled: boolean;
  gtaoEnabled: boolean;
  halfResEnabled: boolean;
  godRaysFullRes: boolean;
  froxelDebugMode: PostFxFroxelDebugMode;
  exposureNode: TslAny;
  stageEnabled(stage: PostFxStage): boolean;
  shouldRunClouds(): boolean;
  godRaysEnabled(): boolean;
  godRaysSamples(): number;
  effectiveFroxelsEnabled(): boolean;
  createAerialNode(sourceRgb: TslAny, depthTex: TslAny): TslAny;
}

/** Builds the post-process TSL output graph (god-rays / GTAO / clouds / TRAA / grade wiring). */
export class WebGpuPostProcessGraphBuilder {
  private halfResPass: HalfResMrtNode | null = null;

  constructor(
    private readonly host: WebGpuPostProcessGraphHost,
    private readonly uniforms: WebGpuPostProcessGraphUniforms,
  ) {}

  disposeHalfRes(): void {
    this.halfResPass?.dispose();
    this.halfResPass = null;
  }

  createOutputNode(beauty: TslAny, depthTex: TslAny, camera: THREE.Camera): TslAny {
    const { host, uniforms: u } = this;
    const shouldRunAerial = host.froxelDebugMode !== "off"
      || host.effectiveFroxelsEnabled()
      || (host.settings.aerialPerspectiveEnabled && host.stageEnabled("aerial"));
    const aerialRgb = shouldRunAerial
      ? host.createAerialNode(beauty.rgb, depthTex)
      : beauty.rgb;
    if (host.froxelDebugMode !== "off") return aerialRgb;
    const wantsHalfResGodRays = host.godRaysEnabled() && !host.godRaysFullRes;
    const wantsHalfRes = host.gtaoEnabled || host.bounceEnabled || host.shouldRunClouds() || wantsHalfResGodRays;
    const halfRes = host.halfResEnabled && wantsHalfRes
      ? this.buildHalfResPass(beauty, depthTex)
      : null;
    const cloudRgb = host.shouldRunClouds()
      ? this.createCloudCompositeNode(
          aerialRgb,
          halfRes?.cloudTex ?? this.createCloudLayerNode(depthTex),
        )
      : aerialRgb;
    const aoRgb = host.gtaoEnabled
      ? cloudRgb.mul(
          halfRes?.aoTex
            ? this.createGtaoUpsampleNode(halfRes.aoTex, beauty.rgb, depthTex)
            : this.createGtaoNode(cloudRgb, depthTex),
        )
      : cloudRgb;
    // Shafts are added in linear before TRAA so the temporal resolve smooths both the IGN
    // start jitter and the dust noise for free when TAA is enabled.
    const shaftRgb = host.godRaysEnabled()
      ? aoRgb.add(
          (halfRes?.godRaysTex
            ? halfRes.godRaysTex.rgb
            : this.createGodRaysLayerNode(beauty, depthTex)
          ).mul(u.uGodRaysTint as unknown as TslAny),
        )
      : aoRgb;
    const temporalColor = host.settings.taaEnabled && host.stageEnabled("taa")
      ? this.createTraaNode(shaftRgb, depthTex, camera)
      : vec4(shaftRgb, DEFAULT_ALPHA);
    const temporalRgb = (temporalColor as TslAny).rgb;
    const bloomRgb = host.settings.bloomEnabled && host.stageEnabled("bloom")
      ? temporalRgb.add((bloom(
          temporalColor,
          host.settings.bloomThreshold,
          host.settings.bloomStrength,
          host.settings.bloomRadius,
        ) as TslAny).rgb)
      : temporalRgb;
    const contactRgb = host.settings.contactShadowsEnabled && host.stageEnabled("contact")
      ? bloomRgb.mul(this.createContactShadowNode(depthTex))
      : bloomRgb;
    const bounceRgb = host.bounceEnabled
      ? (halfRes?.bounceTex
          ? createBounceCompositeNode({
              sourceRgb: contactRgb,
              bounceTex: halfRes.bounceTex,
              strength: u.uBounceStrength as unknown as TslAny,
            })
          : this.createBounceNode(contactRgb, beauty, depthTex))
      : contactRgb;
    return this.createGradeNode(beauty.rgb, bounceRgb);
  }

  private buildHalfResPass(beauty: TslAny, depthTex: TslAny): {
    aoTex: TslAny | null;
    bounceTex: TslAny | null;
    cloudTex: TslAny | null;
    godRaysTex: TslAny | null;
  } {
    const { host, uniforms: u } = this;
    const entries: HalfResEntry[] = [];
    const wantsGodRays = host.godRaysEnabled() && !host.godRaysFullRes;
    if (host.shouldRunClouds()) {
      entries.push({
        name: "clouds",
        node: this.createCloudLayerNode(depthTex),
      });
    }
    if (wantsGodRays) {
      entries.push({
        name: "godrays",
        node: this.createGodRaysLayerNode(beauty, depthTex),
      });
    }
    if (host.gtaoEnabled) {
      entries.push({
        name: "ao",
        red: true,
        node: createGtaoHalfResLayerNode({
          depthTex,
          projectionInverse: u.uProjectionInverse as unknown as TslAny,
          strength: u.uGtaoStrength as unknown as TslAny,
          radius: u.uGtaoRadius as unknown as TslAny,
          fadeEnd: u.uGtaoFadeEnd as unknown as TslAny,
          depthBias: u.uGtaoDepthBias as unknown as TslAny,
          depthTolerance: u.uGtaoDepthTolerance as unknown as TslAny,
          minUvRadius: u.uGtaoMinUvRadius as unknown as TslAny,
          maxUvRadius: u.uGtaoMaxUvRadius as unknown as TslAny,
          samples: host.gtao.samples,
        }),
      });
    }
    if (host.bounceEnabled) {
      entries.push({
        name: "bounce",
        node: createBounceHalfResLayerNode({
          beauty,
          depthTex,
          projectionInverse: u.uProjectionInverse as unknown as TslAny,
          radius: u.uBounceRadius as unknown as TslAny,
          maxDistance: u.uBounceMaxDistance as unknown as TslAny,
          depthTolerance: u.uBounceDepthTolerance as unknown as TslAny,
          minUvRadius: u.uBounceMinUvRadius as unknown as TslAny,
          maxUvRadius: u.uBounceMaxUvRadius as unknown as TslAny,
          taps: host.bounce.taps,
        }),
      });
    }
    if (entries.length === 0) return { aoTex: null, bounceTex: null, cloudTex: null, godRaysTex: null };
    this.halfResPass = new HalfResMrtNode(entries);
    return {
      aoTex: host.gtaoEnabled ? (this.halfResPass.getTextureNode("ao") as unknown as TslAny) : null,
      bounceTex: host.bounceEnabled ? (this.halfResPass.getTextureNode("bounce") as unknown as TslAny) : null,
      cloudTex: host.shouldRunClouds() ? (this.halfResPass.getTextureNode("clouds") as unknown as TslAny) : null,
      godRaysTex: wantsGodRays ? (this.halfResPass.getTextureNode("godrays") as unknown as TslAny) : null,
    };
  }

  /**
   * The dust god-rays accumulation layer (pre-tint). Rendered at half res inside the shared MRT
   * pass by default; the same builder also serves the `?godraysFullres=1` A/B path at full res.
   */
  private createGodRaysLayerNode(beauty: TslAny, depthTex: TslAny): TslAny {
    const { host, uniforms: u } = this;
    return buildDustGodRays({
      sceneTex: beauty,
      depthTex,
      uvNode: screenUV,
      sunUv: u.uSunScreenUv as unknown as TslAny,
      intensity: u.uGodRaysIntensity as unknown as TslAny,
      density: u.uGodRaysDensity as unknown as TslAny,
      decay: u.uGodRaysDecay as unknown as TslAny,
      weight: u.uGodRaysWeight as unknown as TslAny,
      exposure: u.uGodRaysExposure as unknown as TslAny,
      samples: host.godRaysSamples(),
      dustStrength: u.uGodRaysDustStrength as unknown as TslAny,
      dustScale: u.uGodRaysDustScale as unknown as TslAny,
      dustSpeed: u.uGodRaysDustSpeed as unknown as TslAny,
    });
  }

  private createGtaoUpsampleNode(aoTex: TslAny, beautyRgb: TslAny, depthTex: TslAny): TslAny {
    const u = this.uniforms;
    return createGtaoBilateralUpsampleNode({
      aoTex,
      depthTex,
      beautyRgb,
      projectionInverse: u.uProjectionInverse as unknown as TslAny,
      fadeStart: u.uGtaoMaxDistance as unknown as TslAny,
      fadeEnd: u.uGtaoFadeEnd as unknown as TslAny,
    });
  }

  private createCloudLayerNode(depthTex: TslAny): TslAny {
    const { host, uniforms: u } = this;
    return createVolumetricCloudLayerNode({
      depthTex,
      projectionInverse: u.uProjectionInverse as unknown as TslAny,
      cameraWorld: u.uCameraWorld as unknown as TslAny,
      cameraPosition: u.uCameraPosition as unknown as TslAny,
      sunDirection: u.uSunDirection as unknown as TslAny,
      settings: host.clouds,
    });
  }

  private createCloudCompositeNode(sourceRgb: TslAny, cloudTex: TslAny): TslAny {
    return createVolumetricCloudCompositeNode({ sourceRgb, cloudTex });
  }

  private createTraaNode(sourceRgb: TslAny, depthTex: TslAny, camera: THREE.Camera): TslAny {
    const u = this.uniforms;
    return createTraaPostProcessNode({
      sourceRgb,
      depthTex,
      camera,
      projectionInverse: u.uProjectionInverse as unknown as TslAny,
      cameraWorld: u.uCameraWorld as unknown as TslAny,
      prevView: u.uPrevView as unknown as TslAny,
      prevProjection: u.uPrevProjection as unknown as TslAny,
    });
  }

  private createGtaoNode(sourceRgb: TslAny, depthTex: TslAny): TslAny {
    const { host, uniforms: u } = this;
    return createGtaoPostProcessNode({
      sourceRgb,
      depthTex,
      projectionInverse: u.uProjectionInverse as unknown as TslAny,
      strength: u.uGtaoStrength as unknown as TslAny,
      radius: u.uGtaoRadius as unknown as TslAny,
      maxDistance: u.uGtaoMaxDistance as unknown as TslAny,
      fadeEnd: u.uGtaoFadeEnd as unknown as TslAny,
      depthBias: u.uGtaoDepthBias as unknown as TslAny,
      depthTolerance: u.uGtaoDepthTolerance as unknown as TslAny,
      minUvRadius: u.uGtaoMinUvRadius as unknown as TslAny,
      maxUvRadius: u.uGtaoMaxUvRadius as unknown as TslAny,
      samples: host.gtao.samples,
    });
  }

  private createContactShadowNode(depthTex: TslAny): TslAny {
    const { uniforms: u } = this;
    return createContactShadowPostProcessNode({
      depthTex,
      projectionInverse: u.uProjectionInverse as unknown as TslAny,
      projection: u.uProjection as unknown as TslAny,
      view: u.uView as unknown as TslAny,
      sunDirection: u.uSunDirection as unknown as TslAny,
      strength: u.uContactStrength as unknown as TslAny,
      radius: u.uContactRadius as unknown as TslAny,
      depthBias: u.uContactDepthBias as unknown as TslAny,
    });
  }

  private createBounceNode(sourceRgb: TslAny, beauty: TslAny, depthTex: TslAny): TslAny {
    const { host, uniforms: u } = this;
    return createBouncePostProcessNode({
      sourceRgb,
      beauty,
      depthTex,
      projectionInverse: u.uProjectionInverse as unknown as TslAny,
      strength: u.uBounceStrength as unknown as TslAny,
      radius: u.uBounceRadius as unknown as TslAny,
      maxDistance: u.uBounceMaxDistance as unknown as TslAny,
      depthTolerance: u.uBounceDepthTolerance as unknown as TslAny,
      minUvRadius: u.uBounceMinUvRadius as unknown as TslAny,
      maxUvRadius: u.uBounceMaxUvRadius as unknown as TslAny,
      taps: host.bounce.taps,
    });
  }

  private createGradeNode(sourceRgb: TslAny, postRgb: TslAny): TslAny {
    const { host, uniforms: u } = this;
    return createGradePostProcessNode({
      sourceRgb,
      postRgb,
      autoExposure: host.exposureNode,
      exposure: u.uExposure as unknown as TslAny,
      contrast: u.uContrast as unknown as TslAny,
      saturation: u.uSaturation as unknown as TslAny,
      vignette: u.uVignette as unknown as TslAny,
      opacity: u.uOpacity as unknown as TslAny,
      whiteBalance: u.uWhiteBalance as unknown as TslAny,
      shadowTint: u.uShadowTint as unknown as TslAny,
      shadowAmount: u.uShadowAmount as unknown as TslAny,
      highlightTint: u.uHighlightTint as unknown as TslAny,
      highlightAmount: u.uHighlightAmount as unknown as TslAny,
    });
  }
}

/**
 * Per-frame god-rays state: the sun's screen UV, the soft sun-behind/off-screen fade folded
 * into the intensity gain, and the transmittance tint from the live sun colour (warm at low
 * sun by construction — the shafts share the scene's atmosphere).
 */
export function updatePostProcessGodRaysUniforms(input: {
  enabled: boolean;
  camera: THREE.Camera;
  sunDirection: THREE.Vector3;
  lighting: EnvironmentLighting | null;
  uSunScreenUv: Vector2Uniform;
  uGodRaysIntensity: NumericUniform;
  uGodRaysTint: VectorUniform;
}): void {
  if (!input.enabled) {
    input.uGodRaysIntensity.value = 0;
    return;
  }
  const info = projectSunToScreen(input.sunDirection, input.camera);
  input.uSunScreenUv.value.set(info.u, info.v);
  input.uGodRaysIntensity.value = sunScreenFade(info);
  if (input.lighting) {
    const sun = input.lighting.sunColor;
    const peak = Math.max(sun.r, sun.g, sun.b, 1e-4);
    input.uGodRaysTint.value.set(sun.r / peak, sun.g / peak, sun.b / peak);
  }
}
