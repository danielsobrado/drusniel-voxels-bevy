import type { WaterClipmap } from "../../water/index.js";

export interface WaterFoamTimeFreezeState {
  readonly frozen: boolean;
}

export interface WaterFoamTimeFreezeController {
  setFrozen(frozen: boolean): WaterFoamTimeFreezeState;
  getState(): WaterFoamTimeFreezeState;
}

const controllers = new WeakMap<WaterClipmap, WaterFoamTimeFreezeController>();

export function installWaterFoamTimeFreeze(
  clipmap: WaterClipmap,
): WaterFoamTimeFreezeController {
  const existing = controllers.get(clipmap);
  if (existing) return existing;

  let frozen = false;
  const originalUpdate = clipmap.update.bind(clipmap);
  clipmap.update = (deltaSeconds, cameraPosition) => {
    originalUpdate(frozen ? 0 : deltaSeconds, cameraPosition);
  };

  const controller: WaterFoamTimeFreezeController = {
    setFrozen(value) {
      frozen = value;
      return { frozen };
    },
    getState() {
      return { frozen };
    },
  };
  controllers.set(clipmap, controller);
  return controller;
}
