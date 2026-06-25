import type { EnvironmentLighting, EnvironmentSettings } from "../environment/environment.js";

export interface AppSky {
  lighting(): EnvironmentLighting;
  setVisible(visible: boolean): void;
  updateCamera(camera: import("three").Camera): void;
  updateSettings(settings: Partial<EnvironmentSettings>): void;
  dispose(): void;
}
