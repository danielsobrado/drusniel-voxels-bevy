export async function runEarlyRoutes(searchParams: URLSearchParams): Promise<boolean> {
  const earlyScene = searchParams.get("scene");
  if (
    (earlyScene === "sanity" || earlyScene === "phase1-terrain") &&
    searchParams.get("webgpuSpike") !== "1" &&
    searchParams.get("webgpu") !== "1" &&
    searchParams.get("grassFirstInstanceSmoke") !== "1"
  ) {
    if (earlyScene === "phase1-terrain") {
      const { runPhase1TerrainScene } = await import("../../phase1/phase1_scene.js");
      await runPhase1TerrainScene();
    } else {
      const { runPhase0SanityScene } = await import("../../debug/sanity_scene.js");
      await runPhase0SanityScene();
    }
    return true;
  }

  if (searchParams.get("builder") === "1") {
    const { runBuilderViewer } = await import("../../clod/builderViewer.js");
    await runBuilderViewer();
    return true;
  }

  if (searchParams.get("webgpuSpike") === "1") {
    const { runWebGpuSpike } = await import("../../gpu/webgpu_spike.js");
    await runWebGpuSpike();
    return true;
  }

  if (searchParams.get("webgpu") === "1") {
    const { runWebGpuPreview } = await import("../../gpu/webgpu_preview.js");
    await runWebGpuPreview(searchParams);
    return true;
  }

  if (searchParams.get("grassFirstInstanceSmoke") === "1") {
    const { runGrassFirstInstanceSmoke } = await import("../../gpu/grass_first_instance_smoke.js");
    await runGrassFirstInstanceSmoke();
    return true;
  }

  return false;
}
