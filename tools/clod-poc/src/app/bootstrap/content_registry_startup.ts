import { loadContentRegistry, validateContentRegistry } from "../../content/index.js";

export function runContentRegistryStartup(info: HTMLElement): void {
  try {
    const searchParamsTemp = new URLSearchParams(location.search);
    const strictContent = searchParamsTemp.get("strict-content") === "true";
    const registry = loadContentRegistry({ strict: strictContent });
    const report = validateContentRegistry(registry, { strict: strictContent });

    console.log("[ContentRegistry] Load and Validation Summary:");
    console.log(`- Materials: ${registry.materials.size}`);
    console.log(`- Texture Slots: ${registry.textureSlots.size}`);
    console.log(`- Biomes: ${registry.biomes.size}`);
    console.log(`- Debug Presets: ${registry.clodDebugPresets.size}`);
    console.log(`- Snap Pieces: ${registry.snapPieces.size}`);

    if (report.ok) {
      console.log("[ContentRegistry] Validation Status: OK");
    } else {
      console.error(`[ContentRegistry] Validation Status: FAILED (${report.errors.length} errors, ${report.warnings.length} warnings)`);
      for (const err of report.errors) {
        console.error(`  [ERROR] [${err.code}] at ${err.path}: ${err.message}`);
      }
      if (strictContent) {
        throw new Error(`Content validation failed in strict mode: ${report.errors[0].message}`);
      }
      info.textContent = `Content Registry validation errors present (see dev console)`;
    }

    if (report.warnings.length > 0) {
      console.warn(`[ContentRegistry] Validation Warnings (${report.warnings.length}):`);
      for (const warn of report.warnings) {
        console.warn(`  [WARNING] [${warn.code}] at ${warn.path}: ${warn.message}`);
      }
    }
  } catch (err) {
    console.error("[ContentRegistry] Failed to initialize content registry:", err);
    info.textContent = `Content Registry load failed: ${err instanceof Error ? err.message : String(err)}`;
    const searchParamsTemp = new URLSearchParams(location.search);
    const strictContent = searchParamsTemp.get("strict-content") === "true";
    if (strictContent) {
      throw err;
    }
  }
}
