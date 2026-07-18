import type * as THREE from "three";
import {
  WaterClipmap as BaseWaterClipmap,
  type WaterClipmapOptions,
  type WaterClipmapUpdateStats,
  type WaterRect,
} from "./waterClipmap.js";
import type { WaterDebugModeId, WaterVisualConfig } from "./waterConfig.js";
import type { WaterMaterialHandle, WaterMaterialParams } from "./waterMaterial.js";
import { resolveWaterReflectionTierVisual } from "./water_reflection_tiers.js";

export type WaterMaterialFactory = (params: WaterMaterialParams) => WaterMaterialHandle;

export function waterMaterialLevelCellSize(params: WaterMaterialParams): number | null {
  return params.atlasGrid?.levelCellSize ?? params.staticGrid?.cellSize ?? null;
}

export function createTieredWaterMaterialFactory(
  createMaterial: WaterMaterialFactory,
): WaterMaterialFactory {
  return (params) => {
    const levelCellSizeM = waterMaterialLevelCellSize(params);
    const resolveVisual = (visual: WaterVisualConfig) => (
      resolveWaterReflectionTierVisual(visual, levelCellSizeM)
    );
    const handle = createMaterial({
      ...params,
      visual: resolveVisual(params.visual),
    });
    const updateVisual = handle.updateVisual.bind(handle);
    handle.updateVisual = (visual) => updateVisual(resolveVisual(visual));
    return handle;
  };
}

export class TieredWaterClipmap {
  private readonly base: BaseWaterClipmap;

  constructor(options: WaterClipmapOptions) {
    this.base = new BaseWaterClipmap({
      ...options,
      createMaterial: createTieredWaterMaterialFactory(options.createMaterial),
    });
  }

  update(deltaSeconds: number, cameraPosition: THREE.Vector3): void {
    this.base.update(deltaSeconds, cameraPosition);
  }

  setVisible(visible: boolean): void {
    this.base.setVisible(visible);
  }

  setDebugMode(mode: WaterDebugModeId): void {
    this.base.setDebugMode(mode);
  }

  setClipmapTint(enabled: boolean): void {
    this.base.setClipmapTint(enabled);
  }

  setWireframe(enabled: boolean): void {
    this.base.setWireframe(enabled);
  }

  updateVisual(visual: WaterVisualConfig): void {
    this.base.updateVisual(visual);
  }

  updateSunDirection(direction: THREE.Vector3): void {
    this.base.updateSunDirection(direction);
  }

  getLevelRect(index: number): WaterRect | null {
    return this.base.getLevelRect(index);
  }

  get debugModeId(): WaterDebugModeId {
    return this.base.debugModeId;
  }

  get levelCount(): number {
    return this.base.levelCount;
  }

  get visibleLevelCount(): number {
    return this.base.visibleLevelCount;
  }

  get updateCostStats(): WaterClipmapUpdateStats {
    return this.base.updateCostStats;
  }

  get isEnabled(): boolean {
    return this.base.isEnabled;
  }

  dispose(): void {
    this.base.dispose();
  }
}
