import type GUI from "lil-gui";

export interface CustomPropsGuiDeps {
  initiallyEnabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

export function createCustomPropsGui(gui: GUI, deps: CustomPropsGuiDeps): void {
  const folder = gui.addFolder("custom props (GLB)");
  const state = { enabled: deps.initiallyEnabled };
  folder
    .add(state, "enabled")
    .name("enabled")
    .onChange((enabled: boolean) => deps.setEnabled(enabled));
}
