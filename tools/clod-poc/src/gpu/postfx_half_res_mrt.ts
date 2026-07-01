/**
 * One half-res MRT quad pass for the screen-space layers that do not need full
 * resolution: GTAO and the screen-space bounce gather. Rendering them together
 * in a single multi-target raster replaces one round-trip per layer — one
 * encoder, shared depth fetches, no per-pass render-target churn. The cost of
 * these gathers scales with pixel count, so running at half resolution quarters
 * the sample work; the temporal resolve plus a joint-bilateral upsample absorb
 * the resolution loss.
 *
 * Mechanics mirror three's own screen-space pass nodes:
 * - `material.fragmentNode = mrt({...})` routes the multi-output path
 *   (MRTNode is an output-struct node); each entry maps to the attachment
 *   whose texture name matches the entry key.
 * - consumers pull per-attachment texture nodes via `getTextureNode(name)`;
 *   referencing one keeps this node's `updateBefore` scheduled in the frame.
 */

import { HalfFloatType, RedFormat, UnsignedByteType, Vector2 } from "three";
import type { NodeBuilder, NodeFrame, Renderer, TextureNode } from "three/webgpu";
import {
  NodeMaterial,
  NodeUpdateType,
  QuadMesh,
  RenderTarget,
  RendererUtils,
  TempNode,
} from "three/webgpu";
import { mrt, passTexture, uniform } from "three/tsl";
import { tagGpu } from "../core/gpu_profiler.js";
import type { TslAny } from "./webgpu_postprocess_nodes.js";

export interface HalfResEntry {
  name: string;
  /** TSL node producing this attachment (vec4-compatible). */
  node: TslAny;
  /** Single-channel r8 attachment (e.g. AO) instead of rgba16f. */
  red?: boolean;
}

type RendererState = unknown;

const _size = new Vector2();

export class HalfResMrtNode extends TempNode {
  /** Live half-res dimensions; the GTAO noise tiling reads this. */
  readonly resolution = uniform(new Vector2()) as unknown as { value: Vector2 };

  private readonly rt: RenderTarget;
  private readonly material = new NodeMaterial();
  private readonly quad = new QuadMesh();
  private readonly entries: HalfResEntry[];
  private readonly scale: number;
  private readonly texNodes = new Map<string, TextureNode>();
  private rendererState: RendererState;

  constructor(entries: HalfResEntry[], scale = 0.5) {
    super("vec4");
    if (entries.length === 0) throw new Error("HalfResMrtNode needs at least one entry");
    this.entries = entries;
    this.scale = scale;
    this.updateBeforeType = NodeUpdateType.FRAME;

    this.rt = new RenderTarget(1, 1, {
      count: entries.length,
      depthBuffer: false,
      type: HalfFloatType,
    });
    tagGpu(this.rt, "postfxHalfRes");
    entries.forEach((entry, index) => {
      const tex = this.rt.textures[index];
      if (!tex) return;
      tex.name = entry.name;
      if (entry.red === true) {
        tex.format = RedFormat;
        tex.type = UnsignedByteType;
      }
    });
    this.material.name = "PostFxHalfResMRT";
  }

  getTextureNode(name: string): TextureNode {
    let node = this.texNodes.get(name);
    if (!node) {
      const index = this.entries.findIndex((entry) => entry.name === name);
      const tex = this.rt.textures[index];
      if (index < 0 || !tex) throw new Error(`HalfResMrtNode: no entry '${name}'`);
      node = passTexture(
        this as unknown as Parameters<typeof passTexture>[0],
        tex,
      ) as unknown as TextureNode;
      this.texNodes.set(name, node);
    }
    return node;
  }

  private setSize(width: number, height: number): void {
    const w = Math.max(2, Math.round(width * this.scale));
    const h = Math.max(2, Math.round(height * this.scale));
    this.resolution.value.set(w, h);
    this.rt.setSize(w, h); // no-op when unchanged
  }

  override updateBefore(frame: NodeFrame): boolean | undefined {
    const renderer = (frame as unknown as { renderer: Renderer }).renderer;
    const size = renderer.getDrawingBufferSize(_size);
    this.setSize(size.width, size.height);

    this.rendererState = RendererUtils.resetRendererState(
      renderer,
      this.rendererState as Parameters<typeof RendererUtils.resetRendererState>[1],
    );
    renderer.setRenderTarget(this.rt);
    this.quad.material = this.material;
    this.quad.name = "PostFxHalfResMRT";
    this.quad.render(renderer);
    RendererUtils.restoreRendererState(
      renderer,
      this.rendererState as Parameters<typeof RendererUtils.restoreRendererState>[1],
    );
    return undefined;
  }

  override setup(_builder: NodeBuilder): TextureNode {
    const outputs: Record<string, unknown> = {};
    for (const entry of this.entries) outputs[entry.name] = entry.node;
    // The MRTNode must be the fragmentNode directly: NodeMaterial only routes
    // the multi-output path when `fragmentNode.isOutputStructNode` is set.
    // Wrapping it hides that flag and the builder collapses it to a single
    // vec4, dropping the struct members.
    this.material.fragmentNode = mrt(outputs as Parameters<typeof mrt>[0]) as never;
    this.material.needsUpdate = true;
    return this.getTextureNode(this.entries[0]?.name ?? "");
  }

  override dispose(): void {
    this.rt.dispose();
    this.material.dispose();
  }
}
