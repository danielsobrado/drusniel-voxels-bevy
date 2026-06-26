import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { emitAudio } from "../audio/index.js";
import type { ClodPageNode } from "../types.js";
import type { ProjectPropInstance } from "../project/project_props.js";
import {
  createVoxelProjectArchive,
  parseVoxelProjectArchive,
  stageVoxelProjectImport,
  VOXEL_PROJECT_SCHEMA_VERSION,
  type VoxelProjectManifest,
} from "../project/voxel_project_archive.js";
import type { TerrainTextureController } from "../terrain/material/terrain_texture_controller.js";
import { getVoxelEditSnapshot } from "../terrain/terrain.js";
import { mapProjectSessionState, mapProjectWaterArchiveState, mapProjectWeatherArchiveState, type ProjectStateSource } from "./project_state_mapper.js";
import { validateProjectArchiveTextures } from "./project_texture_validator.js";

export interface ProjectArchiveControllerDeps {
  importButton: HTMLButtonElement;
  exportButton: HTMLButtonElement;
  projectImportInput: HTMLInputElement;
  buildProgress: HTMLElement;
  buildProgressPhase: HTMLElement;
  buildProgressPercent: HTMLElement;
  buildProgressBar: HTMLProgressElement;
  getState: () => ProjectStateSource;
  getWorldSize: () => number;
  getConfig: () => VoxelProjectManifest["config"];
  getNodesByLevel: () => Map<number, ClodPageNode[]>;
  getProps: () => ProjectPropInstance[];
  textureController: TerrainTextureController;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  flushAncestors: () => Promise<void>;
  setBuildStatus: (status: string) => void;
  updateOverlay: () => void;
  setLastArchiveSummary: (summary: string) => void;
  updateInfo: () => void;
}

export interface ProjectArchiveController {
  bindImportExportButtons: () => void;
}

export function createProjectArchiveController(deps: ProjectArchiveControllerDeps): ProjectArchiveController {
  const setProjectBusy = (busy: boolean, phase = "preparing", fraction = 0): void => {
    deps.importButton.disabled = busy;
    deps.exportButton.disabled = busy;
    deps.buildProgress.hidden = !busy;
    deps.buildProgressPhase.textContent = phase;
    deps.buildProgressPercent.textContent = `${Math.round(fraction * 100)}%`;
    deps.buildProgressBar.value = fraction;
    deps.setBuildStatus(busy ? phase : "ready");
    deps.updateOverlay();
  };

  const showProjectError = (operation: string, error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    deps.setLastArchiveSummary(`${operation} failed: ${message}`);
    deps.updateInfo();
    window.alert(`${operation} failed\n\n${message}`);
  };

  const collectCustomTextures = (): Map<string, Uint8Array> => {
    const customTextures = new Map<string, Uint8Array>();
    for (const texture of deps.textureController.projectTextureMetadata()) {
      if (texture.source === "custom" && texture.customPath) {
        const bytes = deps.textureController.slots[texture.index].customBytes;
        if (!bytes) throw new Error(`Custom texture slot ${texture.index} has no source bytes`);
        customTextures.set(texture.customPath, bytes);
      }
      if (texture.normalPath) {
        const bytes = deps.textureController.slots[texture.index].normalBytes;
        if (!bytes) throw new Error(`Normal-map slot ${texture.index} has no source bytes`);
        customTextures.set(texture.normalPath, bytes);
      }
    }
    return customTextures;
  };

  const downloadArchive = (archive: Uint8Array, filename: string): void => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(archive).buffer as ArrayBuffer], { type: "application/zip" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const bindImportExportButtons = (): void => {
    deps.importButton.addEventListener("click", () => {
      emitAudio("project.import.open");
      deps.projectImportInput.click();
    });

    deps.projectImportInput.addEventListener("change", async () => {
      const file = deps.projectImportInput.files?.[0];
      deps.projectImportInput.value = "";
      if (!file) return;
      try {
        setProjectBusy(true, "validating project archive", 0.2);
        const contents = await parseVoxelProjectArchive(new Uint8Array(await file.arrayBuffer()));
        await validateProjectArchiveTextures(contents);
        setProjectBusy(true, "staging project for rebuild", 0.65);
        const token = await stageVoxelProjectImport(contents);
        emitAudio("project.import.success");
        const next = new URLSearchParams(location.search);
        next.set("world", String(contents.manifest.worldSize));
        next.set("import", token);
        location.search = `?${next.toString()}`;
      } catch (error) {
        emitAudio("project.import.error");
        setProjectBusy(false);
        showProjectError("Project import", error);
      }
    });

    deps.exportButton.addEventListener("click", async () => {
      const startedAt = performance.now();
      try {
        setProjectBusy(true, "packing voxel project archive", 0.8);
        const worldSize = deps.getWorldSize();
        const manifest: VoxelProjectManifest = {
          schemaVersion: VOXEL_PROJECT_SCHEMA_VERSION,
          kind: "drusniel-clod-project",
          exportedAt: new Date().toISOString(),
          worldSize,
          config: structuredClone(deps.getConfig()),
          state: mapProjectSessionState(deps.getState()),
          water: mapProjectWaterArchiveState(deps.getState()),
          weather: mapProjectWeatherArchiveState(deps.getState()),
          voxelTerrainEdits: getVoxelEditSnapshot(),
          props: deps.getProps(),
          textures: deps.textureController.projectTextureMetadata(),
          camera: {
            position: deps.camera.position.toArray() as [number, number, number],
            target: deps.controls.target.toArray() as [number, number, number],
          },
        };
        const archive = await createVoxelProjectArchive(manifest, collectCustomTextures());
        const stamp = manifest.exportedAt.replace(/[:.]/g, "-");
        downloadArchive(archive, `drusniel-clod-world-${worldSize}-${stamp}.zip`);
        const elapsed = performance.now() - startedAt;
        const summary = `export: ${(archive.byteLength / 1048576).toFixed(1)} MiB voxel archive in ${(elapsed / 1000).toFixed(2)}s`;
        deps.setLastArchiveSummary(summary);
        console.info(`[project export] ${summary}; mesh caches omitted; props=${manifest.props.length}`);
        deps.updateInfo();
        emitAudio("project.export.success");
      } catch (error) {
        emitAudio("project.export.error");
        showProjectError("Project export", error);
      } finally {
        setProjectBusy(false);
      }
    });
  };

  return { bindImportExportButtons };
}
