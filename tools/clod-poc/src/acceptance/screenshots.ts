import { writeFileSync, mkdirSync } from "node:fs";
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

export function writeScreenshotPlaceholder(
  dir: string,
  filename: string,
  width: number,
  height: number,
): void {
  const path = join(dir, "screenshots", filename);
  const header = Buffer.alloc(54);
  const pixelDataSize = width * height * 3;
  const fileSize = 54 + pixelDataSize;
  header.write("BM", 0);
  header.writeUInt32LE(fileSize, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(24, 28);
  header.writeUInt32LE(pixelDataSize, 34);

  const pixels = Buffer.alloc(pixelDataSize, 0x33);

  writeFileSync(path, Buffer.concat([header, pixels]));
}

export function writeScreenshotNotAvailable(
  runDir: string,
  specs: ScreenshotSpec[],
  config: AcceptanceConfig,
): string[] {
  const paths: string[] = [];
  for (const spec of specs) {
    writeScreenshotPlaceholder(
      runDir,
      spec.filename,
      config.visual.screenshotWidth,
      config.visual.screenshotHeight,
    );
    paths.push(join("screenshots", spec.filename));
  }
  return paths;
}
