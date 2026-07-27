import "./minimap.css";
import { surfaceHeight, getTerrainFieldConfig } from "../terrain/terrain.js";
import { BiomeRegionField } from "../world_source/biome_region_field.js";
import { biomeRgbForId } from "../world_source/biome_colors.js";
import {
  selectMinimapBurgs,
  type MinimapBurgMarker,
  type MinimapCampaign,
} from "./minimap_burgs.js";

export const MINIMAP_SIZE = 192;
const MINIMAP_HEIGHT_SHADE = 0.025;
const MINIMAP_MINIMUM_SHADE = 0.55;
const MINIMAP_MAXIMUM_SHADE = 1.25;
const MINIMAP_HEADING_EPSILON = 0.004;
const DEFAULT_CELLS = 192;
const RECENTER_FRACTION = 0.2;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export interface MinimapSample {
  height: number;
  biomeId: number;
}

export interface CircularMinimapOptions {
  parent?: HTMLElement;
  size?: number;
  cells?: number;
  sample?: (x: number, z: number) => MinimapSample;
  getPose?: () => { p: [number, number, number]; yaw: number } | null;
  enabled?: boolean;
}

export interface CircularMinimap {
  readonly root: HTMLElement;
  setEnabled(enabled: boolean): void;
  setHeading(heading: number): void;
  setCenter(x: number, z: number): void;
  setCampaign(campaign: MinimapCampaign | null): void;
  setSample(sample: (x: number, z: number) => MinimapSample): void;
  queueRedraw(): void;
  redraw(): void;
  tick(): void;
  dispose(): void;
}

function defaultSample(x: number, z: number): MinimapSample {
  const terrain = getTerrainFieldConfig();
  const height = surfaceHeight(x, z);
  const biomes = new BiomeRegionField({
    seed: terrain.seed,
    seaLevel: terrain.seaLevel,
    islandShape: terrain.islandShape,
  });
  return { height, biomeId: biomes.sample(x, z, height).biome };
}

function styleNeedle(needle: HTMLDivElement): void {
  needle.className = "clod-minimap__needle";
  needle.setAttribute("aria-hidden", "true");
}

export function createCircularMinimap(options: CircularMinimapOptions = {}): CircularMinimap {
  const size = options.size ?? MINIMAP_SIZE;
  const cells = options.cells ?? DEFAULT_CELLS;
  let sample = options.sample ?? defaultSample;
  let campaign: MinimapCampaign | null = null;
  let heading = 0;
  let center = { x: 0, z: 0 };
  let enabled = options.enabled !== false;
  let redrawQueued = false;
  let biomeField: BiomeRegionField | null = null;

  const root = document.createElement("section");
  root.className = "clod-minimap";
  root.setAttribute("aria-label", "Local overview");
  root.hidden = !enabled;

  const frame = document.createElement("div");
  frame.className = "clod-minimap__frame";

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  canvas.className = "clod-minimap__canvas";
  canvas.setAttribute("data-role", "minimap");

  const burgsLayer = document.createElement("div");
  burgsLayer.className = "clod-minimap__burgs";
  burgsLayer.setAttribute("data-role", "minimap-burgs");
  burgsLayer.setAttribute("aria-hidden", "true");

  const needle = document.createElement("div");
  styleNeedle(needle);

  frame.append(canvas, burgsLayer, needle);
  root.append(frame);
  (options.parent ?? document.body).appendChild(root);

  const resolveSample = (x: number, z: number): MinimapSample => {
    if (options.sample || sample !== defaultSample) {
      return sample(x, z);
    }
    const terrain = getTerrainFieldConfig();
    if (
      !biomeField
      || biomeField.seed !== terrain.seed
      || biomeField.seaLevel !== terrain.seaLevel
    ) {
      biomeField = new BiomeRegionField({
        seed: terrain.seed,
        seaLevel: terrain.seaLevel,
        islandShape: terrain.islandShape,
      });
    }
    const height = surfaceHeight(x, z);
    return { height, biomeId: biomeField.sample(x, z, height).biome };
  };

  const renderBurgs = (markers: MinimapBurgMarker[]): void => {
    burgsLayer.replaceChildren();
    for (const marker of markers) {
      const el = document.createElement("span");
      el.className = "clod-minimap__burg"
        + (marker.capital ? " is-capital" : "")
        + (marker.offscreen ? " is-offscreen" : "");
      el.style.left = `${marker.u * 100}%`;
      el.style.top = `${marker.v * 100}%`;
      const dot = document.createElement("span");
      dot.className = "clod-minimap__burg-dot";
      dot.style.background = marker.color;
      const name = document.createElement("span");
      name.className = "clod-minimap__burg-name";
      name.textContent = marker.name;
      el.append(dot, name);
      burgsLayer.append(el);
    }
  };

  const redraw = (): void => {
    if (!enabled) return;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;
    const image = context.createImageData(size, size);
    const minimumX = center.x - Math.floor(cells / 2);
    const minimumZ = center.z - Math.floor(cells / 2);

    for (let pixelZ = 0; pixelZ < size; pixelZ += 1) {
      for (let pixelX = 0; pixelX < size; pixelX += 1) {
        const x = minimumX + Math.floor((pixelX * cells) / size);
        const z = minimumZ + Math.floor((pixelZ * cells) / size);
        const { height, biomeId } = resolveSample(x, z);
        const [r, g, b] = biomeRgbForId(biomeId);
        const shade = clamp(
          1 + height * MINIMAP_HEIGHT_SHADE,
          MINIMAP_MINIMUM_SHADE,
          MINIMAP_MAXIMUM_SHADE,
        );
        const offset = (pixelZ * size + pixelX) * 4;
        image.data[offset] = clamp(Math.round(r * 255 * shade), 0, 255);
        image.data[offset + 1] = clamp(Math.round(g * 255 * shade), 0, 255);
        image.data[offset + 2] = clamp(Math.round(b * 255 * shade), 0, 255);
        image.data[offset + 3] = 255;
      }
    }

    context.putImageData(image, 0, 0);
    context.strokeStyle = "#f0cf68";
    context.strokeRect(size / 2 - 2, size / 2 - 2, 4, 4);
    renderBurgs(selectMinimapBurgs({ campaign, center, cells }));
  };

  const queueRedraw = (): void => {
    if (redrawQueued) return;
    redrawQueued = true;
    requestAnimationFrame(() => {
      redrawQueued = false;
      redraw();
    });
  };

  const setHeading = (next: number): void => {
    if (!Number.isFinite(next)) return;
    if (Math.abs(next - heading) < MINIMAP_HEADING_EPSILON) return;
    heading = next;
    frame.style.setProperty("--minimap-heading", `${heading}rad`);
  };

  const setCenter = (x: number, z: number): void => {
    const next = { x: Math.floor(x), z: Math.floor(z) };
    const moved = Math.abs(next.x - center.x) > cells * RECENTER_FRACTION
      || Math.abs(next.z - center.z) > cells * RECENTER_FRACTION
      || (center.x === 0 && center.z === 0 && (next.x !== 0 || next.z !== 0));
    center = next;
    if (moved) queueRedraw();
  };

  redraw();

  return {
    root,
    setEnabled(next) {
      enabled = next;
      root.hidden = !next;
      if (next) queueRedraw();
    },
    setHeading,
    setCenter,
    setCampaign(next) {
      campaign = next;
      queueRedraw();
    },
    setSample(next) {
      sample = next;
      biomeField = null;
      queueRedraw();
    },
    queueRedraw,
    redraw,
    tick() {
      if (!enabled) return;
      const pose = options.getPose?.() ?? window.__drusnielClod?.getPose?.() ?? null;
      if (!pose) return;
      setHeading(pose.yaw);
      setCenter(pose.p[0], pose.p[2]);
    },
    dispose() {
      root.remove();
    },
  };
}
