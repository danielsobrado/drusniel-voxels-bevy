import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AcceptanceConfig } from "./acceptanceTypes.js";

export interface ScreenshotSpec {
  name: string;
  filename: string;
  description: string;
}

export function defineScreenshots(
  sceneName: string,
  lodDeltas: number[],
): ScreenshotSpec[] {
  const specs: ScreenshotSpec[] = [
    { name: `${sceneName}_overview`, filename: `${sceneName}_overview.png`, description: "High-angle overview" },
  ];

  for (const delta of lodDeltas) {
    specs.push({
      name: `${sceneName}_grazing_delta${delta}`,
      filename: `${sceneName}_grazing_delta${delta}.png`,
      description: `Grazing angle at neighbor LOD delta ${delta}`,
    });
  }

  specs.push(
    { name: `${sceneName}_wireframe`, filename: `${sceneName}_wireframe.png`, description: "Wireframe overlay" },
    { name: `${sceneName}_locked_vertices`, filename: `${sceneName}_locked_vertices.png`, description: "Locked border vertices highlighted" },
  );

  return specs;
}

export function writeVisualSweepUnavailable(
  runDir: string,
  config: AcceptanceConfig,
  specs: ScreenshotSpec[],
): string[] {
  const debugDir = join(runDir, "debug");
  const path = join(debugDir, "visual_sweep_unavailable.json");
  const data = {
    visualSweepAvailable: false,
    reason: "headless renderer not implemented",
    configuredVisualEnabled: config.visual.enabled,
    requestedScreenshots: specs.map((s) => s.filename),
  };
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
  return [path];
}
