export interface ClodRuntimeBindings {
  refreshTerraformSwatches: () => void;
  syncTerraformMenu: () => void;
  refreshGrassStats: () => void;
  refreshTreeStats: () => void;
  refreshUnderstoryStats: () => void;
  resetPlayerInput: () => void;
  updatePlayerModeUi: () => void;
}

const unbound = (name: string): (() => void) => () => {
  throw new Error(`Runtime binding not initialized: ${name}`);
};

export function createClodRuntimeBindings(): ClodRuntimeBindings {
  return {
    // Defaults to a no-op: terrain textures are applied (→ onTexturesApplied →
    // refreshTerraformSwatches) during runtime-systems startup, which runs
    // before texture-UI startup binds the real impl. A swatch refresh before the
    // terraform menu mounts is a no-op; the real binding takes over once mounted.
    refreshTerraformSwatches: () => {},
    syncTerraformMenu: unbound("syncTerraformMenu"),
    refreshGrassStats: unbound("refreshGrassStats"),
    refreshTreeStats: unbound("refreshTreeStats"),
    refreshUnderstoryStats: unbound("refreshUnderstoryStats"),
    resetPlayerInput: unbound("resetPlayerInput"),
    updatePlayerModeUi: unbound("updatePlayerModeUi"),
  };
}
