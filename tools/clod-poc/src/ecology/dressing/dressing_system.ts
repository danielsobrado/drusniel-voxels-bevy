import type { VegetationGpuBackend } from "../../runtime/vegetation/vegetation_gpu_backend.js";
import type { DressingDiagnostics } from "./diagnostics.js";
import type { DressingSystemOptions as DressingSystemBaseOptions } from "./dressing_system_base.js";
import { CpuDressingSystem } from "./dressing_system_cpu.js";
import { GpuDressingSystem, type DressingSystemLike } from "./gpu/system.js";

export interface DressingSystemOptions extends DressingSystemBaseOptions {
  readonly gpuDevice?: GPUDevice | null;
  readonly gpuBackend?: VegetationGpuBackend | null;
  readonly useWebGpuMaterials?: boolean;
}

export class DressingSystem implements DressingSystemLike {
  private delegate: DressingSystemLike;
  private disposed = false;

  constructor(private readonly options: DressingSystemOptions) {
    if (options.config.enabled && options.gpuDevice && options.gpuBackend) {
      try {
        let gpu: GpuDressingSystem;
        gpu = new GpuDressingSystem({
          scene: options.scene,
          worldCells: options.worldCells,
          worldSeed: options.worldSeed,
          config: options.config,
          quality: options.quality ?? "balanced",
          hydrologySystem: options.hydrologySystem,
          gpuDevice: options.gpuDevice,
          gpuBackend: options.gpuBackend,
          unboundedWorld: options.unboundedWorld,
        }, (error) => {
          console.error("[dressing-gpu] initialization failed; falling back to CPU", error);
          if (this.disposed || this.delegate !== gpu) return;
          gpu.dispose();
          this.delegate = new CpuDressingSystem(options);
        });
        this.delegate = gpu;
        return;
      } catch (error) {
        console.error("[dressing-gpu] unsupported; falling back to CPU", error);
      }
    }
    this.delegate = new CpuDressingSystem(options);
  }

  update(center: { readonly x: number; readonly z: number }): void {
    this.delegate.update(center);
  }

  getStats(): DressingDiagnostics {
    return this.delegate.getStats();
  }

  get enabled(): boolean {
    return this.delegate.enabled;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.delegate.dispose();
  }
}
