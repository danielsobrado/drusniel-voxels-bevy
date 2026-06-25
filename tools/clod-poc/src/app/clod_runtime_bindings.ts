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
    refreshTerraformSwatches: unbound("refreshTerraformSwatches"),
    syncTerraformMenu: unbound("syncTerraformMenu"),
    refreshGrassStats: unbound("refreshGrassStats"),
    refreshTreeStats: unbound("refreshTreeStats"),
    refreshUnderstoryStats: unbound("refreshUnderstoryStats"),
    resetPlayerInput: unbound("resetPlayerInput"),
    updatePlayerModeUi: unbound("updatePlayerModeUi"),
  };
}
