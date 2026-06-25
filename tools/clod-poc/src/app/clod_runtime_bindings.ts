export interface ClodRuntimeBindings {
  refreshTerraformSwatches: () => void;
  syncTerraformMenu: () => void;
  refreshGrassStats: () => void;
  refreshTreeStats: () => void;
  refreshUnderstoryStats: () => void;
  resetPlayerInput: () => void;
  updatePlayerModeUi: () => void;
}

export function createClodRuntimeBindings(): ClodRuntimeBindings {
  return {
    refreshTerraformSwatches: () => {},
    syncTerraformMenu: () => {},
    refreshGrassStats: () => {},
    refreshTreeStats: () => {},
    refreshUnderstoryStats: () => {},
    resetPlayerInput: () => {},
    updatePlayerModeUi: () => {},
  };
}
