import type GUI from "lil-gui";
import type { BorderCoastOceanConfig } from "../config/borderCoastOceanConfig.js";
import type { DeepOcean } from "../water/deepOcean.js";
import type { SurfBand } from "../water/surfBand.js";

export interface OceanDebugStats {
  oceanDrawCalls: number;
  shaderTimeMs: string;
}

export interface OceanDebugController {
  stats: OceanDebugStats;
  update(): void;
  dispose(): void;
}

export function createOceanDebug(
  gui: GUI,
  config: BorderCoastOceanConfig,
  surf: SurfBand,
  ocean: DeepOcean,
): OceanDebugController {
  const state = {
    surfEnabled: config.surf.enabled,
    deepOceanEnabled: config.deep_ocean.enabled,
    heightScale: config.deep_ocean.wave.height_scale,
    choppiness: config.deep_ocean.wave.choppiness,
    foamIntensity: config.deep_ocean.wave.foam_intensity,
    fogDensity: config.deep_ocean.shading.fog_density,
  };
  const stats: OceanDebugStats = { oceanDrawCalls: 0, shaderTimeMs: "n/a" };
  const folder = gui.addFolder("Surf + deep ocean");
  folder.add(state, "surfEnabled").name("surf").onChange((enabled: boolean) => surf.setEnabled(enabled));
  folder.add(state, "deepOceanEnabled").name("deep ocean").onChange((enabled: boolean) => ocean.setEnabled(enabled));
  const applyLook = () => ocean.updateLook(
    state.heightScale,
    state.choppiness,
    state.foamIntensity,
    state.fogDensity,
  );
  folder.add(state, "heightScale", 0, 4, 0.01).name("height scale").onChange(applyLook);
  folder.add(state, "choppiness", 0, 4, 0.01).name("choppiness").onChange(applyLook);
  folder.add(state, "foamIntensity", 0, 4, 0.01).name("foam").onChange(applyLook);
  folder.add(state, "fogDensity", 0, 2, 0.01).name("fog").onChange(applyLook);
  folder.add(stats, "oceanDrawCalls").listen().disable();
  folder.add(stats, "shaderTimeMs").listen().disable();
  applyLook();

  return {
    stats,
    update() {
      const oceanStats = ocean.stats();
      stats.oceanDrawCalls = oceanStats.drawCalls;
      stats.shaderTimeMs = oceanStats.shaderTimeMs === null
        ? "n/a"
        : oceanStats.shaderTimeMs.toFixed(3);
    },
    dispose() {
      folder.destroy();
    },
  };
}
