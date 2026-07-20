import {
  activeForestLightingGpuTexture,
  registerForestLightingGpuDevice,
} from "../forest_lighting/index.js";

export interface TreeCanopyCompetitionParams {
  readonly worldCells: number;
  readonly resolution: number;
  readonly enabled: boolean;
}

export class TreeCanopyCompetitionBinding {
  private readonly fallbackTexture: GPUTexture;
  private texture: GPUTexture;
  private state: TreeCanopyCompetitionParams = {
    worldCells: 1,
    resolution: 1,
    enabled: false,
  };
  private rebinds = 0;

  constructor(device: GPUDevice) {
    registerForestLightingGpuDevice(device);
    this.fallbackTexture = device.createTexture({
      label: "tree canopy competition fallback",
      size: { width: 1, height: 1 },
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture: this.fallbackTexture },
      new Uint8Array([0, 0, 0, 0]),
      {},
      { width: 1, height: 1 },
    );
    this.texture = this.fallbackTexture;
    this.refresh();
  }

  refresh(): boolean {
    const source = activeForestLightingGpuTexture();
    if (
      source === null
      || !Number.isFinite(source.worldCells)
      || source.worldCells <= 1
      || !Number.isFinite(source.resolution)
      || source.resolution <= 1
    ) {
      return this.applySource(this.fallbackTexture, {
        worldCells: 1,
        resolution: 1,
        enabled: false,
      });
    }
    return this.applySource(source.detailTexture, {
      worldCells: source.worldCells,
      resolution: source.resolution,
      enabled: true,
    });
  }

  view(): GPUTextureView {
    return this.texture.createView();
  }

  params(): TreeCanopyCompetitionParams {
    return this.state;
  }

  rebindCount(): number {
    return this.rebinds;
  }

  destroy(): void {
    this.fallbackTexture.destroy();
  }

  private applySource(texture: GPUTexture, state: TreeCanopyCompetitionParams): boolean {
    const changed = texture !== this.texture;
    if (changed) {
      this.texture = texture;
      this.rebinds++;
    }
    this.state = state;
    return changed;
  }
}
