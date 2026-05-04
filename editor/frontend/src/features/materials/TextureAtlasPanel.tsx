import { PanelTitleBar } from "../../components/editor/PanelTitleBar";
import { useEditorClients } from "../../app/providers";
import { useCommandRunner } from "../../commands/useCommandRunner";
import { useEditorStore } from "../../state/editorStore";
import { BlockFaceMappingEditor } from "./BlockFaceMappingEditor";
import { BlockPreview3D } from "./BlockPreview3D";
import { AtlasYamlPreview } from "./AtlasYamlPreview";
import { TextureAtlasGrid } from "./TextureAtlasGrid";
import { VoxelPalette } from "./VoxelPalette";
import type { BlockType } from "../../types/world";

const materialFaceCommands: Record<BlockType, { readonly top: string; readonly side: string; readonly bottom: string }> = {
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

export function TextureAtlasPanel() {
  const editorState = useEditorStore();
  const { backendClient, runtimeClient } = useEditorClients();
  const { runCommandById } = useCommandRunner({ backendClient, runtimeClient });
  const selectedTileId = editorState.selectedAtlasTileId;
  const selectedTileIndex = Number.parseInt(selectedTileId.replace("tile-", ""), 10);
  const selectedMaterial = editorState.brushSettings.materialBlockId;
  const atlasMapping = editorState.atlasMapping;
  const atlasMappingPending = editorState.pendingCommandIds.some((commandId) => commandId.startsWith("editor.atlas.assign"));
  const atlasRebuildPending = editorState.pendingCommandIds.includes("editor.atlas.rebuildTextureArray");
  const atlasSavePending = editorState.pendingCommandIds.includes("editor.atlas.saveMapping");

  const normalizedTileIndex = Number.isNaN(selectedTileIndex) ? 0 : selectedTileIndex;

  return (
    <section className="panel-shell" data-testid="panel-texture-atlas" aria-labelledby="texture-atlas-title">
      <PanelTitleBar title="Texture Atlas" />
      <div className="panel-body">
        <h2 id="texture-atlas-title" className="placeholder-heading">
          Texture Atlas
        </h2>
        <p className="agent-hint">Mocked texture atlas workflow: click a tile, then assign it to block faces.</p>

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
              tileTop={atlasMapping[selectedMaterial].top}
              tileSide={atlasMapping[selectedMaterial].side}
              tileBottom={atlasMapping[selectedMaterial].bottom}
            />
            <AtlasYamlPreview atlasMapping={atlasMapping} />
          </section>
        </div>
      </div>
    </section>
  );
}
