import type * as THREE from "three";
import { attachDebugPanelChrome } from "../ui/debug_panel_chrome.js";
import type { DeepOceanRenderConfig } from "../terrain/border_coast_config.js";
import type { PlayerConfig } from "../player_controller.js";
import type { OceanSampler } from "./ocean_service.js";

export type BorderOceanZone = "playable" | "transition-gap" | "deep-ocean-ring" | "outside-visual-extent";

export interface BorderOceanDebugInput {
  worldCells: number;
  cameraPosition: THREE.Vector3;
  deepOcean: DeepOceanRenderConfig;
  deepOceanMeshPresent: boolean;
  oceanSampler: OceanSampler | null;
  playerConfig?: Readonly<PlayerConfig>;
}

export interface BorderOceanDebugSnapshot {
  enabled: boolean;
  zone: BorderOceanZone;
  cameraX: number;
  cameraZ: number;
  worldCells: number;
  startOutsideBorderM: number;
  extendCells: number;
  meshPresent: boolean;
  samplerPresent: boolean;
  samplerValidHere: boolean;
  waveCount: number;
  windSpeed: number;
  heightScale: number;
  choppiness: number;
  fogFarM: number;
  reflectionStrength: number;
  playerMarginM: number | null;
  pushbackBandM: number | null;
  pushbackAcceleration: number | null;
  softPushbackEnabled: boolean | null;
}

function insideRect(x: number, z: number, min: number, max: number): boolean {
  return x >= min && x <= max && z >= min && z <= max;
}

export function classifyBorderOceanZone(
  x: number,
  z: number,
  worldCells: number,
  startOutsideBorderM: number,
  extendCells: number,
): BorderOceanZone {
  if (insideRect(x, z, 0, worldCells)) return "playable";
  const start = Math.max(0, startOutsideBorderM);
  if (insideRect(x, z, -start, worldCells + start)) return "transition-gap";
  const extend = Math.max(start + 1, extendCells);
  if (insideRect(x, z, -extend, worldCells + extend)) return "deep-ocean-ring";
  return "outside-visual-extent";
}

export function buildBorderOceanDebugSnapshot(input: BorderOceanDebugInput): BorderOceanDebugSnapshot {
  const x = input.cameraPosition.x;
  const z = input.cameraPosition.z;
  const playerMarginM = input.playerConfig?.worldEdgeMargin ?? null;
  const pushbackBandM = input.playerConfig?.worldEdgePushbackBand ?? null;
  const pushbackAcceleration = input.playerConfig?.worldEdgePushbackAcceleration ?? null;
  const softPushbackEnabled = input.playerConfig
    ? input.playerConfig.worldEdgePushbackBand > 0 && input.playerConfig.worldEdgePushbackAcceleration > 0
    : null;

  return {
    enabled: input.deepOcean.enabled,
    zone: classifyBorderOceanZone(
      x,
      z,
      input.worldCells,
      input.deepOcean.startOutsideBorderM,
      input.deepOcean.extendCells,
    ),
    cameraX: x,
    cameraZ: z,
    worldCells: input.worldCells,
    startOutsideBorderM: input.deepOcean.startOutsideBorderM,
    extendCells: input.deepOcean.extendCells,
    meshPresent: input.deepOceanMeshPresent,
    samplerPresent: input.oceanSampler !== null,
    samplerValidHere: input.oceanSampler?.isInPlayableOcean(x, z) ?? false,
    waveCount: input.oceanSampler?.waves.length ?? 0,
    windSpeed: input.deepOcean.wave.windSpeed,
    heightScale: input.deepOcean.wave.heightScale,
    choppiness: input.deepOcean.wave.choppiness,
    fogFarM: input.deepOcean.shading.fogFarM,
    reflectionStrength: input.deepOcean.shading.reflectionStrength,
    playerMarginM,
    pushbackBandM,
    pushbackAcceleration,
    softPushbackEnabled,
  };
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function maybeMeters(value: number | null): string {
  return value === null ? "n/a" : `${value.toFixed(1)}m`;
}

function maybeNumber(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(1);
}

function maybeEnabled(value: boolean | null): string {
  return value === null ? "n/a" : yesNo(value);
}

export function formatBorderOceanDebug(snapshot: BorderOceanDebugSnapshot): string[] {
  return [
    `enabled: ${yesNo(snapshot.enabled)}`,
    `zone: ${snapshot.zone}`,
    `camera: ${snapshot.cameraX.toFixed(1)}, ${snapshot.cameraZ.toFixed(1)}`,
    `world: ${snapshot.worldCells}m`,
    `start gap: ${snapshot.startOutsideBorderM.toFixed(1)}m`,
    `extent: ${snapshot.extendCells.toFixed(1)}m`,
    `mesh: ${yesNo(snapshot.meshPresent)}`,
    `sampler: ${yesNo(snapshot.samplerPresent)} valid-here=${yesNo(snapshot.samplerValidHere)}`,
    `pushback: ${maybeEnabled(snapshot.softPushbackEnabled)} band=${maybeMeters(snapshot.pushbackBandM)}`,
    `clamp margin: ${maybeMeters(snapshot.playerMarginM)} accel=${maybeNumber(snapshot.pushbackAcceleration)}`,
    `waves: ${snapshot.waveCount} wind=${snapshot.windSpeed.toFixed(1)}`,
    `height: ${snapshot.heightScale.toFixed(2)} chop=${snapshot.choppiness.toFixed(2)}`,
    `fog far: ${snapshot.fogFarM.toFixed(0)}m`,
    `reflect: ${snapshot.reflectionStrength.toFixed(2)}`,
  ];
}

export class BorderOceanDebugPanel {
  private readonly chromeRoot: HTMLElement;
  private readonly pre: HTMLPreElement;
  private closed = false;

  constructor(container: HTMLElement) {
    const host = document.createElement("div");
    container.appendChild(host);

    this.pre = document.createElement("pre");
    this.pre.style.cssText = `
      color: #b9e8ff;
      font: 11px/1.4 monospace;
      margin: 0;
      white-space: pre-wrap;
    `;
    host.appendChild(this.pre);

    const chrome = attachDebugPanelChrome(host, {
      panelId: "border-ocean-debug",
      title: "Border Ocean",
      floating: true,
      defaultPosition: { left: 8, top: 96 },
      onClose: () => {
        this.closed = true;
        host.remove();
      },
    });
    chrome.body.style.padding = "6px 10px";
    this.chromeRoot = chrome.root;
  }

  update(input: BorderOceanDebugInput): void {
    if (this.closed || this.chromeRoot.hidden) return;
    this.pre.textContent = formatBorderOceanDebug(buildBorderOceanDebugSnapshot(input)).join("\n");
  }

  dispose(): void {
    this.closed = true;
    this.chromeRoot.parentElement?.remove();
  }
}

export function createBorderOceanDebugPanel(container: HTMLElement): BorderOceanDebugPanel {
  return new BorderOceanDebugPanel(container);
}
