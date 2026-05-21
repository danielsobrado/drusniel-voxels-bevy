import { useEffect, useMemo, useState } from "react";
import { PanelTitleBar } from "../../components/editor/PanelTitleBar";
import { useEditorClients } from "../../app/providers";
import { useCommandRunner } from "../../commands/useCommandRunner";
import { useEditorStore } from "../../state/editorStore";
import { BlockFaceMappingEditor } from "./BlockFaceMappingEditor";
import { BlockPreview3D } from "./BlockPreview3D";
import { AtlasYamlPreview } from "./AtlasYamlPreview";
import { TextureAtlasGrid } from "./TextureAtlasGrid";
import { VoxelPalette } from "./VoxelPalette";
import type { AtlasBlockType, CanonicalBlockType, MaterialAsset, MaterialCatalog, MaterialPatch } from "../../types/world";
import type { RuntimeMaterialReplaceResult } from "../../runtime/runtimeSchemas";

const materialFaceCommands: Record<AtlasBlockType, { readonly top: string; readonly side: string; readonly bottom: string }> = {
  grass: {
    top: "editor.atlas.assignGrassTop",
    side: "editor.atlas.assignGrassSide",
    bottom: "editor.atlas.assignGrassBottom",
  },
  dirt: {
    top: "editor.atlas.assignDirtTop",
    side: "editor.atlas.assignDirtSide",
    bottom: "editor.atlas.assignDirtBottom",
  },
  rock: {
    top: "editor.atlas.assignRockTop",
    side: "editor.atlas.assignRockSide",
    bottom: "editor.atlas.assignRockBottom",
  },
  sand: {
    top: "editor.atlas.assignSandTop",
    side: "editor.atlas.assignSandSide",
    bottom: "editor.atlas.assignSandBottom",
  },
};

const fallbackMaterialCatalog = (materials: readonly MaterialAsset[]): MaterialCatalog => ({
  materialTypes: [{ id: "catalog", name: "Catalog", materialIds: materials.map((material) => material.id) }],
  materials,
  palettes: [{ id: "default", name: "Default", materialIds: materials.map((material) => material.id) }],
  activeMaterialId: materials[0]?.id ?? "mat-1",
});

const blockForMaterial = (material: MaterialAsset): CanonicalBlockType => {
  switch (material.defaultVoxel) {
    case "Rock":
      return "rock";
    case "Sand":
      return "sand";
    case "Clay":
      return "clay";
    case "Water":
      return "water";
    case "Wood":
      return "wood";
    case "Leaves":
      return "leaves";
    case "DungeonWall":
      return "dungeonWall";
    case "DungeonFloor":
      return "dungeonFloor";
    case "SubSoil":
      return "subSoil";
    default:
      return "topSoil";
  }
};

const materialColor = (material: MaterialAsset): string => {
  const [r, g, b] = material.colorRgb ?? [92, 112, 132];
  return `rgb(${r}, ${g}, ${b})`;
};

function MaterialSwatchButton({
  active,
  material,
  onSelect,
}: {
  readonly active: boolean;
  readonly material: MaterialAsset;
  readonly onSelect: (material: MaterialAsset) => void;
}) {
  return (
    <button type="button" className={`toolbar-button ${active ? "toolbar-button-active" : ""}`} data-testid={`material-swatch-${material.id}`} onClick={() => onSelect(material)}>
      <span className="material-swatch-chip" style={{ backgroundColor: materialColor(material) }} />
      {material.name}
    </button>
  );
}

function MaterialTypesPanel({ activeMaterialId, catalog, onSelect }: { readonly activeMaterialId: string; readonly catalog: MaterialCatalog; readonly onSelect: (material: MaterialAsset) => void }) {
  const groups = useMemo(() => {
    const byId = new Map(catalog.materials.map((material) => [material.id, material] as const));
    return catalog.materialTypes.map((type) => ({
      type,
      materials: type.materialIds.map((id) => byId.get(id)).filter((material): material is MaterialAsset => Boolean(material)),
    }));
  }, [catalog]);

  return (
    <section className="atlas-editor-column" data-testid="materials-type-list">
      <h3 className="inspector-section-title">Material Types</h3>
      {groups.map(({ type, materials }) => (
        <div className="atlas-face-block" key={type.id}>
          <strong>{type.name}</strong>
          <div className="voxel-palette-row">
            {materials.map((material) => (
              <MaterialSwatchButton key={material.id} active={activeMaterialId === material.id} material={material} onSelect={onSelect} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function MaterialProperties({ material, onUpdate }: { readonly material: MaterialAsset; readonly onUpdate: (patch: MaterialPatch) => void }) {
  const updateNumber = (key: keyof MaterialPatch, value: string) => {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      onUpdate({ [key]: parsed } as MaterialPatch);
    }
  };

  return (
    <section className="atlas-editor-column" data-testid="material-property-editor">
      <h3 className="inspector-section-title">Properties</h3>
      <label className="inspector-field">
        <span>Name</span>
        <input value={material.name} onChange={(event) => onUpdate({ name: event.target.value })} />
      </label>
      <div className="inspector-metric-grid">
        <label className="inspector-field">
          <span>Metallic</span>
          <input type="number" min="0" max="1" step="0.01" value={material.metallic ?? 0} onChange={(event) => updateNumber("metallic", event.target.value)} />
        </label>
        <label className="inspector-field">
          <span>Smooth</span>
          <input type="number" min="0" max="1" step="0.01" value={material.smooth ?? 0} onChange={(event) => updateNumber("smooth", event.target.value)} />
        </label>
        <label className="inspector-field">
          <span>Emissive</span>
          <input type="number" min="0" step="0.01" value={material.emissive ?? 0} onChange={(event) => updateNumber("emissive", event.target.value)} />
        </label>
        <label className="inspector-field">
          <span>Transmission</span>
          <input type="number" min="0" max="1" step="0.01" value={material.surfaceTransmission ?? 0} onChange={(event) => updateNumber("surfaceTransmission", event.target.value)} />
        </label>
        <label className="inspector-field">
          <span>IOR</span>
          <input type="number" min="1" max="3" step="0.01" value={material.indexOfRefraction ?? 1} onChange={(event) => updateNumber("indexOfRefraction", event.target.value)} />
        </label>
        <label className="inspector-field">
          <span>Strength</span>
          <input type="number" value={material.strength ?? 0} readOnly />
        </label>
      </div>
      <p className="inspector-subnote">Id {material.id}. Changes affect every voxel using this material.</p>
    </section>
  );
}

export function TextureAtlasPanel() {
  const editorState = useEditorStore();
  const { backendClient, runtimeClient } = useEditorClients();
  const { runCommandById } = useCommandRunner({ backendClient, runtimeClient });
  const [catalog, setCatalog] = useState<MaterialCatalog>(() => fallbackMaterialCatalog(editorState.materials));
  const [replaceFromId, setReplaceFromId] = useState("mat-1");
  const [replaceToId, setReplaceToId] = useState("mat-3");
  const [replaceSummary, setReplaceSummary] = useState("");
  const selectedTileId = editorState.selectedAtlasTileId;
  const selectedTileIndex = Number.parseInt(selectedTileId.replace("tile-", ""), 10);
  const selectedMaterial = editorState.brushSettings.materialBlockId;
  const atlasMapping = editorState.atlasMapping;
  const selectedAtlasBlock: AtlasBlockType = selectedMaterial in atlasMapping ? (selectedMaterial as AtlasBlockType) : "grass";
  const atlasMappingPending = editorState.pendingCommandIds.some((commandId) => commandId.startsWith("editor.atlas.assign"));
  const atlasRebuildPending = editorState.pendingCommandIds.includes("editor.atlas.rebuildTextureArray");
  const atlasSavePending = editorState.pendingCommandIds.includes("editor.atlas.saveMapping");

  const normalizedTileIndex = Number.isNaN(selectedTileIndex) ? 0 : selectedTileIndex;
  const activeMaterial = catalog.materials.find((material) => material.id === catalog.activeMaterialId) ?? catalog.materials[0];

  useEffect(() => {
    let cancelled = false;
    void runtimeClient.getRuntimeSnapshot().then((result) => {
      if (cancelled || !result.ok) {
        return;
      }
      setCatalog(result.data.materialCatalog);
      setReplaceFromId(result.data.materialCatalog.activeMaterialId);
      setReplaceToId(result.data.materialCatalog.materials.find((material) => material.id !== result.data.materialCatalog.activeMaterialId)?.id ?? result.data.materialCatalog.activeMaterialId);
    });
    return () => {
      cancelled = true;
    };
  }, [runtimeClient]);

  const selectMaterial = async (material: MaterialAsset) => {
    const result = await runtimeClient.setActiveMaterial(material.id);
    setCatalog(result.ok ? result.data.catalog : { ...catalog, activeMaterialId: material.id });
    editorState.updateBrushSettings({ materialBlockId: blockForMaterial(material) });
    editorState.setSelection({ kind: "material", id: material.id, label: material.name });
  };

  const updateMaterial = async (material: MaterialAsset, patch: MaterialPatch) => {
    const optimisticMaterial = { ...material, ...patch };
    setCatalog((current) => ({
      ...current,
      materials: current.materials.map((candidate) => (candidate.id === material.id ? optimisticMaterial : candidate)),
    }));
    const result = await runtimeClient.updateMaterial(material.id, patch);
    if (result.ok) {
      setCatalog(result.data.catalog);
    }
  };

  const pickMaterial = async () => {
    if (editorState.selection.kind !== "voxel") {
      return;
    }
    const result = await runtimeClient.pickVoxelMaterial(editorState.selection.position);
    if (result.ok) {
      await selectMaterial(result.data.material);
    }
  };

  const paintSelectedVoxel = async () => {
    if (!activeMaterial || editorState.selection.kind !== "voxel") {
      return;
    }
    const result = await runtimeClient.paintVoxelMaterial(editorState.selection.position, activeMaterial.id);
    if (result.ok) {
      result.data.dirtyChunkIds.forEach((chunkId) => editorState.markDirty(chunkId));
    }
  };

  const applyReplaceProgress = (data: RuntimeMaterialReplaceResult) => {
    data.dirtyChunkIds.forEach((chunkId) => editorState.markDirty(chunkId));
    const progress = data.totalChunks > 0 ? ` (${data.processedChunks}/${data.totalChunks} chunks)` : "";
    const prefix = data.completed ? "" : "Queued: ";
    setReplaceSummary(`${prefix}${data.changedCount} changed, ${data.skippedCount} skipped${progress}`);
  };

  const pollReplaceJob = async (jobId: string) => {
    for (;;) {
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      const result = await runtimeClient.getMaterialReplaceJob(jobId);
      if (!result.ok) {
        setReplaceSummary(result.message);
        return;
      }
      applyReplaceProgress(result.data);
      if (result.data.completed) {
        return;
      }
    }
  };

  const replaceMaterial = async () => {
    const result = await runtimeClient.replaceMaterial(replaceFromId, replaceToId);
    if (!result.ok) {
      return;
    }
    applyReplaceProgress(result.data);
    if (!result.data.completed && result.data.jobId) {
      void pollReplaceJob(result.data.jobId);
    }
  };

  return (
    <section className="panel-shell" data-testid="panel-texture-atlas" aria-labelledby="texture-atlas-title">
      <PanelTitleBar title="Materials" />
      <div className="panel-body">
        <h2 id="texture-atlas-title" className="placeholder-heading">
          Materials
        </h2>
        <p className="agent-hint">Runtime material catalog, palettes, pick/paint, replace, and atlas mapping.</p>

        {activeMaterial ? (
          <div className="atlas-content-grid">
            <MaterialTypesPanel activeMaterialId={catalog.activeMaterialId} catalog={catalog} onSelect={(material) => void selectMaterial(material)} />
            <section className="atlas-editor-column">
              <section className="voxel-palette" data-testid="material-palette-default">
                <h3 className="inspector-section-title">{catalog.palettes[0]?.name ?? "Default"} Palette</h3>
                <div className="voxel-palette-row">
                  {(catalog.palettes[0]?.materialIds ?? []).map((id) => {
                    const material = catalog.materials.find((candidate) => candidate.id === id);
                    return material ? <MaterialSwatchButton key={material.id} active={catalog.activeMaterialId === material.id} material={material} onSelect={(next) => void selectMaterial(next)} /> : null;
                  })}
                </div>
              </section>
              <div className="atlas-actions-row">
                <button type="button" className="toolbar-button" data-testid="material-pick" disabled={editorState.selection.kind !== "voxel"} onClick={() => void pickMaterial()}>
                  Pick
                </button>
                <button type="button" className="toolbar-button" data-testid="material-paint-selected" disabled={editorState.selection.kind !== "voxel"} onClick={() => void paintSelectedVoxel()}>
                  Paint Selected
                </button>
              </div>
              <div className="atlas-face-block" data-testid="material-replace-tool">
                <strong>Replace Material</strong>
                <select value={replaceFromId} onChange={(event) => setReplaceFromId(event.target.value)}>
                  {catalog.materials.map((material) => (
                    <option key={material.id} value={material.id}>{material.name}</option>
                  ))}
                </select>
                <select value={replaceToId} onChange={(event) => setReplaceToId(event.target.value)}>
                  {catalog.materials.map((material) => (
                    <option key={material.id} value={material.id}>{material.name}</option>
                  ))}
                </select>
                <button type="button" className="toolbar-button" onClick={() => void replaceMaterial()}>
                  Replace
                </button>
                {replaceSummary ? <p className="inspector-subnote">{replaceSummary}</p> : null}
              </div>
            </section>
            <MaterialProperties material={activeMaterial} onUpdate={(patch) => void updateMaterial(activeMaterial, patch)} />
          </div>
        ) : null}

        <TextureAtlasGrid selectedTileId={selectedTileId} onSelectTile={(tileId) => editorState.setSelectedAtlasTile(tileId)} />

        <div className="atlas-toolbar">
          <div className="atlas-selected" data-testid="atlas-selected-tile-label">
            Selected tile: <strong>tile-{normalizedTileIndex}</strong>
          </div>
          <p className="inspector-subnote">
            Rebuild needed: <span data-testid="atlas-dirty-state">{editorState.dirtyState.dirtyAtlas ? "yes" : "no"}</span>
          </p>
        </div>

        <div className="atlas-actions-row">
          <button type="button" className="toolbar-button" data-testid="atlas-rebuild" disabled={atlasRebuildPending} onClick={() => void runCommandById("editor.atlas.rebuildTextureArray")}>
            {atlasRebuildPending ? "Rebuild Queued" : "Rebuild Texture Array"}
          </button>
          <button type="button" className="toolbar-button" data-testid="atlas-save" disabled={atlasSavePending} onClick={() => void runCommandById("editor.atlas.saveMapping")}>
            {atlasSavePending ? "Saving Mapping" : "Save Mapping"}
          </button>
          <button type="button" className="toolbar-button" data-testid="atlas-open" onClick={() => void runCommandById("editor.material.openTextureAtlas")}>
            Open Texture Atlas
          </button>
        </div>

        <div className="atlas-content-grid">
          <section className="atlas-editor-column">
            <VoxelPalette
              selectedMaterial={selectedMaterial}
              onMaterialChange={(material) =>
                editorState.updateBrushSettings({
                  materialBlockId: material,
                })
              }
            />
            <BlockFaceMappingEditor
              disabled={atlasMappingPending}
              selectedTileId={selectedTileId}
              onAssign={(block, face) => void runCommandById(materialFaceCommands[block][face])}
            />
          </section>
          <section className="atlas-editor-column">
            <BlockPreview3D
              label={selectedMaterial}
              tileTop={atlasMapping[selectedAtlasBlock].top}
              tileSide={atlasMapping[selectedAtlasBlock].side}
              tileBottom={atlasMapping[selectedAtlasBlock].bottom}
            />
            <AtlasYamlPreview atlasMapping={atlasMapping} />
          </section>
        </div>
      </div>
    </section>
  );
}
