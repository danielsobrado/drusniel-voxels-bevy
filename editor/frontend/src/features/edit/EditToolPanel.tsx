import { Box, Circle, Eraser, Paintbrush, Pencil, Square } from "lucide-react";
import { PanelTitleBar } from "../../components/editor/PanelTitleBar";
import { useEditorStore } from "../../state/editorStore";
import type { BrushSettings } from "../../types/editor";
import type { CanonicalBlockType } from "../../types/world";

const materialOptions: readonly { readonly value: CanonicalBlockType; readonly label: string; readonly color: string }[] = [
  { value: "topSoil", label: "Top Soil", color: "#4d8f4e" },
  { value: "subSoil", label: "Sub Soil", color: "#80613c" },
  { value: "rock", label: "Rock", color: "#7f8792" },
  { value: "sand", label: "Sand", color: "#d5bd82" },
  { value: "clay", label: "Clay", color: "#b07f61" },
  { value: "water", label: "Water", color: "#2a8ecf" },
  { value: "wood", label: "Wood", color: "#8a5a2b" },
  { value: "leaves", label: "Leaves", color: "#4f9e47" },
  { value: "dungeonWall", label: "Dungeon Wall", color: "#706a7a" },
  { value: "dungeonFloor", label: "Dungeon Floor", color: "#8a7460" },
];

const actionOptions: readonly { readonly value: BrushSettings["action"]; readonly label: string; readonly icon: typeof Pencil }[] = [
  { value: "set", label: "Set", icon: Pencil },
  { value: "paint", label: "Paint", icon: Paintbrush },
  { value: "delete", label: "Delete", icon: Eraser },
];

const shapeOptions: readonly { readonly value: BrushSettings["brushShape"]; readonly label: string; readonly icon: typeof Square }[] = [
  { value: "single", label: "Single", icon: Square },
  { value: "box", label: "Box", icon: Box },
  { value: "sphere", label: "Sphere", icon: Circle },
  { value: "cylinder", label: "Cylinder", icon: Circle },
];

const maskOptions: readonly { readonly value: BrushSettings["mask"]; readonly label: string }[] = [
  { value: "any", label: "Any" },
  { value: "empty", label: "Empty" },
  { value: "occupied", label: "Occupied" },
  { value: "material", label: "Material" },
];

const clampSize = (value: number) => Math.min(32, Math.max(1, Math.round(value)));

export function EditToolPanel() {
  const brush = useEditorStore((state) => state.brushSettings);
  const updateBrushSettings = useEditorStore((state) => state.updateBrushSettings);

  const updateSize = (axis: 0 | 1 | 2, value: number) => {
    const nextSize: [number, number, number] = [brush.size[0], brush.size[1], brush.size[2]];
    nextSize[axis] = clampSize(value);
    updateBrushSettings({ size: nextSize });
  };

  return (
    <section className="panel-shell edit-tool-panel" data-testid="panel-edit-tool" aria-labelledby="edit-tool-title">
      <PanelTitleBar title="Edit Tool" titleId="edit-tool-title" />
      <div className="panel-body edit-tool-body">
        <section className="edit-tool-section" aria-label="Action">
          <h3 className="inspector-section-title">Action</h3>
          <div className="viewport-controls-tool-grid" role="toolbar" aria-label="Edit action">
            {actionOptions.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                className={`toolbar-button viewport-tool-button ${brush.action === value ? "toolbar-button-active" : ""}`}
                aria-pressed={brush.action === value}
                data-testid={`edit-action-${value}`}
                onClick={() => updateBrushSettings({ action: value })}
              >
                <Icon size={14} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="edit-tool-section" aria-label="Shape">
          <h3 className="inspector-section-title">Shape</h3>
          <div className="viewport-controls-tool-grid" role="toolbar" aria-label="Brush shape">
            {shapeOptions.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                className={`toolbar-button viewport-tool-button ${brush.brushShape === value ? "toolbar-button-active" : ""}`}
                aria-pressed={brush.brushShape === value}
                data-testid={`edit-shape-${value}`}
                onClick={() => updateBrushSettings({ brushShape: value })}
              >
                <Icon size={14} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="edit-tool-section edit-tool-grid" aria-label="Brush dimensions">
          <label className="toolbar-field">
            Radius
            <input type="range" min={1} max={16} value={brush.radius} onChange={(event) => updateBrushSettings({ radius: Number(event.target.value) })} />
            <span>{brush.radius}</span>
          </label>
          <label className="toolbar-field">
            X
            <input type="number" min={1} max={32} value={brush.size[0]} onChange={(event) => updateSize(0, Number(event.target.value))} />
          </label>
          <label className="toolbar-field">
            Y
            <input type="number" min={1} max={32} value={brush.size[1]} onChange={(event) => updateSize(1, Number(event.target.value))} />
          </label>
          <label className="toolbar-field">
            Z
            <input type="number" min={1} max={32} value={brush.size[2]} onChange={(event) => updateSize(2, Number(event.target.value))} />
          </label>
          <label className="toolbar-field edit-tool-toggle">
            <input type="checkbox" checked={brush.continuous} onChange={(event) => updateBrushSettings({ continuous: event.target.checked })} />
            Continuous
          </label>
        </section>

        <section className="edit-tool-section" aria-label="Material">
          <h3 className="inspector-section-title">Material</h3>
          <div className="edit-tool-material-grid">
            {materialOptions.map((material) => (
              <button
                key={material.value}
                type="button"
                className={`toolbar-button edit-tool-material ${brush.materialBlockId === material.value ? "toolbar-button-active" : ""}`}
                data-testid={`edit-material-${material.value}`}
                onClick={() => updateBrushSettings({ materialBlockId: material.value })}
              >
                <span className="edit-tool-swatch" style={{ backgroundColor: material.color }} aria-hidden="true" />
                {material.label}
              </button>
            ))}
          </div>
        </section>

        <section className="edit-tool-section edit-tool-grid" aria-label="Mask">
          <label className="toolbar-field">
            Mask
            <select value={brush.mask} onChange={(event) => updateBrushSettings({ mask: event.target.value as BrushSettings["mask"] })}>
              {maskOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="toolbar-field">
            Mask material
            <select value={brush.maskBlockId} disabled={brush.mask !== "material"} onChange={(event) => updateBrushSettings({ maskBlockId: event.target.value as CanonicalBlockType })}>
              {materialOptions.map((material) => (
                <option key={material.value} value={material.value}>
                  {material.label}
                </option>
              ))}
            </select>
          </label>
        </section>
      </div>
    </section>
  );
}
