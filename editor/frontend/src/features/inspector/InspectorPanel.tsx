import type { ChangeEvent, ReactNode } from "react";
import { toast } from "sonner";
import { PanelTitleBar } from "../../components/editor/PanelTitleBar";
import { useEditorClients } from "../../app/providers";
import { useCommandRunner } from "../../commands/useCommandRunner";
import { useEditorStore } from "../../state/editorStore";
import { MaterialInspector } from "../materials/MaterialInspector";
import { getCurrentInspectorKind, getProtectedAreaWarnings, getSelectedObject } from "../../state/editorSelectors";
import type {
  BillboardMode,
  ChunkSummary,
  MaterialAsset,
  PropInstance,
  PropLodState,
  ProtectedArea,
  WaterBody,
  WaterBodyKind,
  MockWaterRuntimeSnapshot,
  WaterReflectionDebugViewMode,
  VoxelBlock,
} from "../../types/world";
import type { Selection } from "../../types/editor";

const toDisplaySummary = (selectionLabel: string, selectedObject: unknown): string =>
  typeof selectedObject === "object" && selectedObject !== null && "name" in selectedObject ? `${selectionLabel} / ${(selectedObject as { name: string }).name}` : selectionLabel;

const formatCoordinates = (values: readonly number[]): string => values.join(", ");
const selectionId = (selection: Selection): string => (selection.kind === "voxel" ? selection.chunkId : selection.id);

export function InspectorPanel() {
  const editorState = useEditorStore();
  const { backendClient, runtimeClient } = useEditorClients();
  const { runCommandById } = useCommandRunner({ backendClient, runtimeClient });
  const selectedObject = getSelectedObject(editorState);
  const inspectorKind = getCurrentInspectorKind(editorState);
  const currentSelectionId = selectionId(editorState.selection);
  const isEmptySelection = currentSelectionId === "selection-empty" && editorState.selection.label === "No selection";
  const selectedSummary = toDisplaySummary(editorState.selection.label, selectedObject);
  const materials = editorState.materials;
  const chunkRebuildPending = editorState.pendingCommandIds.includes("editor.world.rebuildSelectedChunk");
  const dirtyChunkRebuildPending = editorState.pendingCommandIds.includes("editor.world.rebuildDirtyChunks");
  const waterDebugPending = editorState.pendingCommandIds.some((commandId) => commandId.startsWith("editor.water.setDebug") || commandId === "editor.water.toggleReflectionMask");
  const waterProbePending = editorState.pendingCommandIds.includes("editor.water.runVisualProbe");
  const areaUpdatePending = editorState.pendingCommandIds.includes("editor.area.updateSelected");
  const runRebuildSelectedChunk = () => void runCommandById("editor.world.rebuildSelectedChunk");
  const runRebuildDirtyChunks = () => void runCommandById("editor.world.rebuildDirtyChunks");

  const inspectorContent: ReactNode = (() => {
    if (isEmptySelection) {
      return <EmptyInspector />;
    }

    if (inspectorKind === "chunk" && selectedObject && "meshMode" in selectedObject) {
      return (
        <ChunkInspector
          chunk={selectedObject as ChunkSummary}
          dirtyRebuildPending={dirtyChunkRebuildPending}
          onRebuildSelected={runRebuildSelectedChunk}
          onRebuildDirty={runRebuildDirtyChunks}
          selectedRebuildPending={chunkRebuildPending}
        />
      );
    }

    if (inspectorKind === "area" && selectedObject && "rules" in selectedObject) {
      const area = selectedObject as ProtectedArea;
      const updateProtectedArea = async (patch: Partial<ProtectedArea>) => {
        const commandId = "editor.area.updateSelected";
        editorState.beginCommand(commandId);
        try {
          const candidate = { ...area, ...patch };
          const validation = await runtimeClient.validateProtectedAreaConflicts(candidate);
          if (!validation.ok) {
            throw new Error(validation.message);
          }
          const result = await runtimeClient.updateProtectedArea(area.id, patch);
          if (!result.ok) {
            throw new Error(result.message);
          }
          editorState.updateProtectedArea(area.id, result.data.area);
          editorState.pushCommandHistory(commandId, "Update selected protected area", "success");
          editorState.pushAgentTimelineEvent({
            kind: validation.data.clear ? "command" : "warning",
            message: validation.data.clear
              ? `${result.data.area.name} runtime update accepted; conflict status clear.`
              : `${result.data.area.name} runtime update accepted with conflicts: ${validation.data.conflicts.map((conflict) => conflict.message).join(", ")}`,
          });
          toast.success("Protected area updated.");
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown protected area update failure.";
          editorState.pushCommandHistory(commandId, "Update selected protected area", "failure", message);
          editorState.pushAgentTimelineEvent({ kind: "warning", message: `Protected area runtime update failed: ${message}` });
          useEditorStore.setState((state) => ({
            consoleMessages: [
              {
                id: `console-area-update-${Date.now()}`,
                level: "error",
                message: `editor.area.updateSelected: ${message}`,
                time: new Date().toLocaleTimeString(),
              },
              ...state.consoleMessages,
            ],
          }));
          toast.error("Protected area update failed.");
        } finally {
          editorState.finishCommand(commandId);
        }
      };
      return (
        <ProtectedAreaInspector
          area={area}
          pending={areaUpdatePending}
          warnings={getProtectedAreaWarnings(editorState)[area.id] ?? []}
          onUpdate={(patch) => void updateProtectedArea(patch)}
        />
      );
    }

    if (inspectorKind === "water" && selectedObject && "waveAmplitude" in selectedObject) {
      const waterBody = selectedObject as WaterBody;
      const snapshot = editorState.waterRuntimeSnapshot;
      return (
        <WaterBodyInspector
          waterBody={waterBody}
          snapshot={snapshot}
          debugPending={waterDebugPending}
          onFocusNearest={() => void runCommandById("editor.water.focusNearestWaterBody")}
          onApplyPreset={(commandId) => void runCommandById(commandId)}
          onSetDebugMode={(mode) => {
            const commandByMode: Record<WaterReflectionDebugViewMode, string> = {
              Off: "editor.water.setDebugOff",
              Mask: "editor.water.setDebugMask",
              ReflectionOnly: "editor.water.setDebugReflectionOnly",
              BlendFactor: "editor.water.setDebugBlendFactor",
            };

            void runCommandById(commandByMode[mode]);
          }}
          onRunVisualProbe={() => void runCommandById("editor.water.runVisualProbe")}
          onOpenReflectionDebug={() => void runCommandById("editor.water.openReflectionDebug")}
          probePending={waterProbePending}
          onUpdate={(patch) => {
            editorState.updateWaterBody(waterBody.id, patch);
          }}
        />
      );
    }

    if (inspectorKind === "prop" && selectedObject && "transform" in selectedObject) {
      return (
        <PropInspector
          prop={selectedObject as PropInstance}
          materials={materials}
          onUpdate={(patch) => editorState.updateProp((selectedObject as PropInstance).id, patch)}
        />
      );
    }

    if (inspectorKind === "material" && selectedObject && "sourcePath" in selectedObject) {
      return <MaterialInspector material={selectedObject as MaterialAsset} atlasMapping={editorState.atlasMapping} />;
    }

    if (inspectorKind === "voxel" && selectedObject && "displayName" in selectedObject) {
      return <VoxelInspector voxel={selectedObject as VoxelBlock} />;
    }

    if (inspectorKind === "debug_resource") {
      return <DebugInspector selection={editorState.selection} />;
    }

    return <EmptyInspector />;
  })();

  return (
    <section className="panel-shell" data-testid="panel-inspector" aria-labelledby="inspector-title">
      <PanelTitleBar title="Inspector" />
      <div className="panel-body">
        <h2 id="inspector-title" className="placeholder-heading">
          Inspector
        </h2>
        <p className="agent-hint">Agent Hint: selection changes update active inspector and mocked summary state.</p>
        <div className="inspector-card">
          <span className="inspector-kicker">Selected {inspectorKind}</span>
          <strong data-testid="inspector-selection-header">{editorState.selection.label}</strong>
          <small>Selection payload: {selectedSummary}</small>
        </div>
        <div className="inspector-card">
          <span className="inspector-kicker">Mode</span>
          <strong>{editorState.activeMode}</strong>
          <small>Runtime edits are mocked until Sprint integration completes.</small>
        </div>
        {inspectorContent}
      </div>
    </section>
  );
}

function InspectorHeader({ title, badge, note }: { readonly badge: string; readonly note: string; readonly title: string }) {
  return (
    <div className="inspector-section" data-testid={`inspector-${badge}-header`}>
      <div className="inspector-section-title">Inspector Context</div>
      <div className="inspector-metric-grid">
        <ReadOnlyMetricRow label="Kind" value={badge} />
        <ReadOnlyMetricRow label="Title" value={title} />
      </div>
      <p className="inspector-subnote">{note}</p>
    </div>
  );
}

function InspectorSection({ title, children, testId }: { readonly children: ReactNode; readonly title: string; readonly testId?: string }) {
  return (
    <section className="inspector-section" data-testid={testId}>
      <div className="inspector-section-title">{title}</div>
      <div className="inspector-section-body">{children}</div>
    </section>
  );
}

function PropertyRow({ label, description, children }: { readonly children: ReactNode; readonly label: string; readonly description?: string }) {
  return (
    <label className="inspector-property">
      <span className="inspector-property-label">
        {label}
        {description ? <small>{description}</small> : null}
      </span>
      <span>{children}</span>
    </label>
  );
}

function TextField({ label, value, onChange, testId, readOnly, description }: { readonly description?: string; readonly label: string; readonly onChange: (next: string) => void; readonly readOnly?: boolean; readonly testId?: string; readonly value: string }) {
  return (
    <PropertyRow label={label} description={description}>
      <input
        type="text"
        className="inspector-input"
        value={value}
        data-testid={testId}
        readOnly={readOnly}
        disabled={readOnly}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
      />
    </PropertyRow>
  );
}

function NumericField({
  label,
  value,
  onChange,
  testId,
  min,
  max,
  step,
  readOnly,
  description,
}: {
  readonly description?: string;
  readonly label: string;
  readonly max?: number;
  readonly min?: number;
  readonly onChange: (next: number) => void;
  readonly readOnly?: boolean;
  readonly step?: number;
  readonly testId?: string;
  readonly value: number;
}) {
  return (
    <PropertyRow label={label} description={description}>
      <input
        type="number"
        className="inspector-input"
        value={value}
        min={min}
        max={max}
        step={step}
        readOnly={readOnly}
        disabled={readOnly}
        data-testid={testId}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const value = Number(event.target.value);
          if (Number.isFinite(value)) {
            onChange(value);
          }
        }}
      />
    </PropertyRow>
  );
}

function Vector3Field({
  label,
  value,
  onChange,
  testId,
  disabled,
  description,
}: {
  readonly description?: string;
  readonly label: string;
  readonly onChange: (next: [number, number, number]) => void;
  readonly testId?: string;
  readonly disabled?: boolean;
  readonly value: [number, number, number];
}) {
  const updateAxis = (axis: 0 | 1 | 2, raw: string) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return;
    }

    const next: [number, number, number] = [value[0], value[1], value[2]];
    next[axis] = parsed;
    onChange(next);
  };

  return (
    <PropertyRow label={label} description={description}>
      <div className="inspector-vector3">
        <input
          type="number"
          className="inspector-input"
          value={value[0]}
          disabled={disabled}
          data-testid={testId ? `${testId}-x` : undefined}
          onChange={(event) => updateAxis(0, event.target.value)}
          aria-label={`${label} x`}
        />
        <input
          type="number"
          className="inspector-input"
          value={value[1]}
          disabled={disabled}
          data-testid={testId ? `${testId}-y` : undefined}
          onChange={(event) => updateAxis(1, event.target.value)}
          aria-label={`${label} y`}
        />
        <input
          type="number"
          className="inspector-input"
          value={value[2]}
          disabled={disabled}
          data-testid={testId ? `${testId}-z` : undefined}
          onChange={(event) => updateAxis(2, event.target.value)}
          aria-label={`${label} z`}
        />
      </div>
    </PropertyRow>
  );
}

function EnumSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  testId,
  disabled,
  description,
}: {
  readonly description?: string;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onChange: (next: T) => void;
  readonly options: readonly { readonly label: string; readonly value: T }[];
  readonly testId?: string;
  readonly value: T;
}) {
  return (
    <PropertyRow label={label} description={description}>
      <select
        className="inspector-select"
        value={value}
        disabled={disabled}
        data-testid={testId}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </PropertyRow>
  );
}

function BooleanToggle({
  label,
  checked,
  onChange,
  testId,
  description,
  disabled,
}: {
  readonly checked: boolean;
  readonly description?: string;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onChange: (next: boolean) => void;
  readonly testId?: string;
}) {
  return (
    <PropertyRow label={label} description={description}>
      <input
        type="checkbox"
        className="inspector-checkbox"
        data-testid={testId}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </PropertyRow>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  testId,
  description,
  disabled,
}: {
  readonly description?: string;
  readonly disabled?: boolean;
  readonly label: string;
  readonly max: number;
  readonly min: number;
  readonly onChange: (next: number) => void;
  readonly step: number;
  readonly testId?: string;
  readonly value: number;
}) {
  return (
    <PropertyRow label={label} description={description}>
      <div className="inspector-slider">
        <input
          type="range"
          className="inspector-range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          data-testid={testId}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span>{value.toFixed(2)}</span>
      </div>
    </PropertyRow>
  );
}

function ColorField({ label, value, onChange, testId, description, disabled }: { readonly description?: string; readonly disabled?: boolean; readonly label: string; readonly onChange: (next: string) => void; readonly testId?: string; readonly value: string }) {
  return (
    <PropertyRow label={label} description={description}>
      <input
        type="color"
        className="inspector-color"
        value={value}
        disabled={disabled}
        data-testid={testId}
        onChange={(event) => onChange(event.target.value)}
      />
    </PropertyRow>
  );
}

function RuleMatrix({ rules, onChange, testId, disabled }: { readonly disabled?: boolean; readonly onChange: (next: ProtectedArea["rules"]) => void; readonly rules: ProtectedArea["rules"]; readonly testId?: string }) {
  const items: Array<{ readonly key: keyof ProtectedArea["rules"]; readonly label: string }> = [
    { key: "canMine", label: "Can mine" },
    { key: "canPlace", label: "Can place" },
    { key: "canPaint", label: "Can paint" },
    { key: "canSpawnProps", label: "Can spawn props" },
    { key: "canEditWater", label: "Can edit water" },
    { key: "canSaveModify", label: "Can save modify" },
  ];

  return (
    <InspectorSection title="Rule matrix" testId={testId}>
      <div className="inspector-rule-matrix">
        {items.map((item) => (
          <BooleanToggle
            key={item.key}
            label={item.label}
            checked={rules[item.key]}
            disabled={disabled}
            onChange={(next) => onChange({ ...rules, [item.key]: next })}
            testId={testId ? `inspector-area-rules-${item.key}` : undefined}
          />
        ))}
      </div>
    </InspectorSection>
  );
}

function ReadOnlyMetricRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="inspector-readonly-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyInspector() {
  return (
    <div className="inspector-section" data-testid="inspector-empty">
      <div className="inspector-section-title">No selection</div>
      <p className="inspector-subnote">Click a row in the outliner to inspect it.</p>
    </div>
  );
}

function VoxelInspector({ voxel }: { readonly voxel: VoxelBlock }) {
  return (
    <div data-testid="inspector-voxel">
      <InspectorHeader title={voxel.displayName} badge="voxel" note="Voxel objects are mocked and read-only in Sprint 5." />
      <InspectorSection title="Voxel details">
        <ReadOnlyMetricRow label="Id" value={voxel.id} />
        <ReadOnlyMetricRow label="Display name" value={voxel.displayName} />
        <ReadOnlyMetricRow label="Solid" value={voxel.solid ? "true" : "false"} />
        <ReadOnlyMetricRow label="Default material" value={voxel.defaultMaterialId} />
      </InspectorSection>
    </div>
  );
}

function ChunkInspector({
  chunk,
  dirtyRebuildPending,
  onRebuildSelected,
  onRebuildDirty,
  selectedRebuildPending,
}: {
  readonly chunk: ChunkSummary;
  readonly dirtyRebuildPending: boolean;
  readonly onRebuildDirty: () => void;
  readonly onRebuildSelected: () => void;
  readonly selectedRebuildPending: boolean;
}) {
  return (
    <div data-testid="inspector-chunk">
      <InspectorHeader title={chunk.label} badge="chunk" note="Chunk actions are mocked and mutate local state only." />
      <InspectorSection title="Chunk metrics">
        <ReadOnlyMetricRow label="Coordinate" value={`(${formatCoordinates(chunk.coordinate)})`} />
        <ReadOnlyMetricRow label="Dirty" value={chunk.dirty ? "Dirty" : "Clean"} />
        <ReadOnlyMetricRow label="Biome" value={chunk.biome} />
        <ReadOnlyMetricRow label="Mesh mode" value={chunk.meshMode} />
        <ReadOnlyMetricRow label="Mesh status" value={chunk.meshStatus} />
        <ReadOnlyMetricRow label="Vertex count" value={chunk.vertexCount.toLocaleString()} />
        <ReadOnlyMetricRow label="Triangle count" value={chunk.triangleCount.toLocaleString()} />
        <ReadOnlyMetricRow label="Water mesh count" value={chunk.waterMeshCount.toLocaleString()} />
        <ReadOnlyMetricRow label="LOD group" value={String(chunk.lodGroup)} />
      </InspectorSection>
      <InspectorSection title="Chunk actions">
        <div className="inspector-action-row">
          <button type="button" className="toolbar-button" data-testid="inspector-chunk-rebuild-selected" disabled={selectedRebuildPending} onClick={onRebuildSelected}>
            {selectedRebuildPending ? "Queued selected chunk" : "Rebuild selected chunk"}
          </button>
          <button type="button" className="toolbar-button" data-testid="inspector-chunk-rebuild-dirty" disabled={dirtyRebuildPending} onClick={onRebuildDirty}>
            {dirtyRebuildPending ? "Queued dirty chunks" : "Rebuild dirty chunks"}
          </button>
        </div>
      </InspectorSection>
    </div>
  );
}

function ProtectedAreaInspector({
  area,
  onUpdate,
  pending,
  warnings,
}: {
  readonly area: ProtectedArea;
  readonly onUpdate: (patch: Partial<ProtectedArea>) => void;
  readonly pending: boolean;
  readonly warnings: readonly string[];
}) {
  const shapeOptions: readonly { readonly value: ProtectedArea["shape"]; readonly label: string }[] = [
    { value: "box", label: "Box" },
    { value: "sphere", label: "Sphere" },
    { value: "cylinder", label: "Cylinder" },
    { value: "chunk_set", label: "Chunk Set" },
    { value: "polygon", label: "Polygon" },
  ];

  const kindOptions: readonly { readonly value: ProtectedArea["kind"]; readonly label: string }[] = [
    { value: "unbreakable", label: "Unbreakable" },
    { value: "spawn", label: "Spawn" },
    { value: "story_lock", label: "Story Lock" },
    { value: "quest_lock", label: "Quest Lock" },
    { value: "no_dig", label: "No-Dig" },
    { value: "no_build", label: "No-Build" },
    { value: "no_prop", label: "No-Prop" },
    { value: "custom", label: "Custom" },
  ];

  const areaRulePresets = [
    {
      id: "unbreakable",
      label: "Unbreakable",
      rules: { canMine: false, canPlace: false, canPaint: false, canSpawnProps: false, canEditWater: false, canSaveModify: false },
    },
    {
      id: "no-build",
      label: "No Build",
      rules: { canMine: true, canPlace: false, canPaint: false, canSpawnProps: false, canEditWater: true, canSaveModify: true },
    },
    {
      id: "no-dig",
      label: "No Dig",
      rules: { canMine: false, canPlace: true, canPaint: false, canSpawnProps: true, canEditWater: true, canSaveModify: true },
    },
    {
      id: "no-prop",
      label: "No Prop",
      rules: { canMine: true, canPlace: true, canPaint: true, canSpawnProps: false, canEditWater: true, canSaveModify: true },
    },
  ];

  return (
    <div data-testid="inspector-area">
      <InspectorHeader title={area.name} badge="area" note={pending ? "Runtime update pending." : "Runtime protected area rules are active."} />
      <InspectorSection title="Area properties">
        <TextField label="Name" value={area.name} readOnly={pending} testId="inspector-area-name" onChange={(name) => onUpdate({ name })} />
        <EnumSelect
          label="Kind"
          value={area.kind}
          options={kindOptions}
          disabled={pending}
          onChange={(kind) => onUpdate({ kind })}
        />
        <EnumSelect
          label="Shape"
          value={area.shape}
          options={shapeOptions}
          testId="inspector-area-shape"
          disabled={pending}
          onChange={(shape) => onUpdate({ shape })}
        />
        <NumericField
          label="Priority"
          value={area.priority}
          min={0}
          readOnly={pending}
          testId="inspector-area-priority"
          onChange={(priority) => onUpdate({ priority })}
        />
        <BooleanToggle
          label="Locked"
          checked={area.locked}
          disabled={pending}
          onChange={(locked) => onUpdate({ locked })}
          testId="inspector-area-locked"
        />
        <ColorField label="Debug Color" value={area.color} disabled={pending} onChange={(color) => onUpdate({ color })} testId="inspector-area-color" />
        <Vector3Field
          label="Bounds min"
          value={area.bounds.min}
          testId="inspector-area-bounds-min"
          disabled={pending}
          onChange={(next) => onUpdate({ bounds: { ...area.bounds, min: next } })}
        />
        <Vector3Field
          label="Bounds max"
          value={area.bounds.max}
          testId="inspector-area-bounds-max"
          disabled={pending}
          onChange={(next) => onUpdate({ bounds: { ...area.bounds, max: next } })}
        />
      </InspectorSection>
      <InspectorSection title="Area rule presets">
        <div className="inspector-rule-presets">
          {areaRulePresets.map((preset) => (
            <button
              type="button"
              key={preset.id}
              className="toolbar-button"
              disabled={pending}
              data-testid={`inspector-area-preset-${preset.id}`}
              onClick={() => onUpdate({ rules: preset.rules })}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </InspectorSection>
      <RuleMatrix rules={area.rules} disabled={pending} onChange={(rules) => onUpdate({ rules })} testId="inspector-area-rules" />
      <InspectorSection title="Runtime validation">
        {warnings.length === 0 ? <p className="inspector-subnote">No active warnings.</p> : warnings.map((warning) => <p key={warning} className="inspector-subnote">?? {warning}</p>)}
      </InspectorSection>
      <InspectorSection title="Audit log">
        <p className="inspector-subnote">{pending ? "Waiting for runtime result." : "Runtime accepts updates before local editor state changes."}</p>
      </InspectorSection>
    </div>
  );
}

function WaterBodyInspector({
  debugPending,
  waterBody,
  snapshot,
  onApplyPreset,
  onFocusNearest,
  onOpenReflectionDebug,
  onRunVisualProbe,
  onSetDebugMode,
  onUpdate,
  probePending,
}: {
  readonly debugPending: boolean;
  readonly onApplyPreset: (preset: string) => void;
  readonly onFocusNearest: () => void;
  readonly onOpenReflectionDebug: () => void;
  readonly onRunVisualProbe: () => void;
  readonly onSetDebugMode: (mode: WaterReflectionDebugViewMode) => void;
  readonly onUpdate: (patch: Partial<WaterBody>) => void;
  readonly probePending: boolean;
  readonly snapshot: MockWaterRuntimeSnapshot;
  readonly waterBody: WaterBody;
}) {
  const kindOptions: readonly { readonly value: WaterBodyKind; readonly label: string }[] = [
    { value: "Ocean", label: "Ocean" },
    { value: "Lake", label: "Lake" },
    { value: "River", label: "River" },
    { value: "Pond", label: "Pond" },
    { value: "Unknown", label: "Unknown" },
  ];

  const reflectionViewOptions: readonly { readonly value: WaterReflectionDebugViewMode; readonly label: string }[] = [
    { value: "Off", label: "Off" },
    { value: "Mask", label: "Mask" },
    { value: "ReflectionOnly", label: "ReflectionOnly" },
    { value: "BlendFactor", label: "BlendFactor" },
  ];

  return (
    <div data-testid="inspector-water">
      <InspectorHeader title={waterBody.name} badge="water" note="Water inspector edits body fields in local state." />
      <WaterDebugPanel
        debugMode={waterBody.reflectionStatus.debugViewMode}
        debugPending={debugPending}
        onOpenReflectionDebug={onOpenReflectionDebug}
        onRunVisualProbe={onRunVisualProbe}
        onSetDebugMode={onSetDebugMode}
        probePending={probePending}
      />
      <WaterReflectionStatusCard status={snapshot.reflectionStatus} presence={snapshot.waterPresence} />
      <WaterVisualProbePanel probe={snapshot.probe} />
      <InspectorSection title="Water identity">
        <TextField label="Name" value={waterBody.name} testId="inspector-water-name" onChange={(name) => onUpdate({ name })} />
        <EnumSelect
          label="Kind"
          value={waterBody.kind}
          onChange={(kind) => onUpdate({ kind })}
          testId="inspector-water-kind"
          options={kindOptions}
        />
        <TextField label="Body type" value={waterBody.bodyType} onChange={(bodyType) => onUpdate({ bodyType })} testId="inspector-water-body-type" />
      </InspectorSection>
      <InspectorSection title="Wave and mesh properties">
        <NumericField
          label="Wave amplitude"
          value={waterBody.waveAmplitude}
          step={0.01}
          onChange={(waveAmplitude) => onUpdate({ waveAmplitude })}
          testId="inspector-water-wave-amplitude"
        />
        <NumericField label="Wave speed" value={waterBody.waveSpeed} step={0.01} onChange={(waveSpeed) => onUpdate({ waveSpeed })} />
        <NumericField label="Wave scale" value={waterBody.waveScale} step={0.01} onChange={(waveScale) => onUpdate({ waveScale })} />
        <NumericField label="Wave count" value={waterBody.waveCount} step={1} onChange={(waveCount) => onUpdate({ waveCount })} />
        <NumericField label="Reflection strength" value={waterBody.reflectionStrength} step={0.01} onChange={(reflectionStrength) => onUpdate({ reflectionStrength })} />
        <NumericField label="Fresnel power" value={waterBody.fresnelPower} step={0.1} onChange={(fresnelPower) => onUpdate({ fresnelPower })} />
        <NumericField label="Distortion strength" value={waterBody.distortionStrength} step={0.01} onChange={(distortionStrength) => onUpdate({ distortionStrength })} />
        <NumericField label="Base alpha" value={waterBody.baseAlpha} step={0.01} onChange={(baseAlpha) => onUpdate({ baseAlpha })} />
        <NumericField label="Detail normal intensity" value={waterBody.detailNormalIntensity} step={0.01} onChange={(detailNormalIntensity) => onUpdate({ detailNormalIntensity })} />
        <NumericField label="Detail scroll speed" value={waterBody.detailScrollSpeed} step={0.01} onChange={(detailScrollSpeed) => onUpdate({ detailScrollSpeed })} />
      </InspectorSection>
      <InspectorSection title="Color and foam">
        <ColorField label="Shallow color" value={waterBody.shallowColor} onChange={(shallowColor) => onUpdate({ shallowColor })} testId="inspector-water-shallow-color" />
        <ColorField label="Deep color" value={waterBody.deepColor} onChange={(deepColor) => onUpdate({ deepColor })} testId="inspector-water-deep-color" />
        <SliderRow
          label="Clarity"
          value={waterBody.clarity}
          min={0}
          max={1}
          step={0.01}
          onChange={(clarity) => onUpdate({ clarity })}
          testId="inspector-water-clarity"
        />
        <SliderRow
          label="Murkiness"
          value={waterBody.murkiness}
          min={0}
          max={1}
          step={0.01}
          onChange={(murkiness) => onUpdate({ murkiness })}
          testId="inspector-water-murkiness"
        />
        <BooleanToggle
          label="Foam enabled"
          checked={waterBody.foamEnabled}
          onChange={(foamEnabled) => onUpdate({ foamEnabled })}
          testId="inspector-water-foam-enabled"
        />
        <NumericField label="Shore foam" value={waterBody.shoreFoam} step={0.01} onChange={(shoreFoam) => onUpdate({ shoreFoam })} />
        <NumericField label="Wave crest foam" value={waterBody.waveCrestFoam} step={0.01} onChange={(waveCrestFoam) => onUpdate({ waveCrestFoam })} />
      </InspectorSection>
      <WaterPresetCards onApplyPreset={onApplyPreset} onFocusNearest={onFocusNearest} />
      <InspectorSection title="Water status">
        <BooleanToggle
          label="Reflection enabled"
          checked={waterBody.reflectionStatus.enabled}
          onChange={(enabled) => onUpdate({ reflectionStatus: { ...waterBody.reflectionStatus, enabled } })}
        />
        <ReadOnlyMetricRow label="Probe valid" value={waterBody.reflectionStatus.probeValid ? "Yes" : "No"} />
        <ReadOnlyMetricRow label="Last probe" value={`${waterBody.reflectionStatus.lastProbeUpdateMs.toFixed(1)} ms`} />
      </InspectorSection>
    </div>
  );
}

function WaterDebugPanel({
  debugMode,
  debugPending,
  onOpenReflectionDebug,
  onRunVisualProbe,
  onSetDebugMode,
  probePending,
}: {
  readonly debugMode: WaterReflectionDebugViewMode;
  readonly debugPending: boolean;
  readonly onOpenReflectionDebug: () => void;
  readonly onRunVisualProbe: () => void;
  readonly onSetDebugMode: (mode: WaterReflectionDebugViewMode) => void;
  readonly probePending: boolean;
}) {
  const reflectionViewOptions: readonly { readonly value: WaterReflectionDebugViewMode; readonly label: string }[] = [
    { value: "Off", label: "Off" },
    { value: "Mask", label: "Mask" },
    { value: "ReflectionOnly", label: "ReflectionOnly" },
    { value: "BlendFactor", label: "BlendFactor" },
  ];

  return (
    <InspectorSection title="Water debug" testId="inspector-water-debug-card">
      <button type="button" className="toolbar-button" onClick={onOpenReflectionDebug}>
        Open reflection debug overlay
      </button>
      <EnumSelect
        label="Reflection debug mode"
        value={debugMode}
        options={reflectionViewOptions}
        disabled={debugPending}
        onChange={onSetDebugMode}
        testId="inspector-water-debug-mode"
      />
      <button type="button" className="toolbar-button" data-testid="inspector-water-run-probe" disabled={probePending} onClick={onRunVisualProbe}>
        {probePending ? "Probe running" : "Run visual probe"}
      </button>
    </InspectorSection>
  );
}

function WaterReflectionStatusCard({
  presence,
  status,
}: {
  readonly presence: MockWaterRuntimeSnapshot["waterPresence"];
  readonly status: MockWaterRuntimeSnapshot["reflectionStatus"];
}) {
  return (
    <InspectorSection title="Water reflection status" testId="inspector-water-reflection-status">
      <ReadOnlyMetricRow label="Active" value={status.active ? "Yes" : "No"} />
      <ReadOnlyMetricRow label="Sampled" value={status.sampleReflection ? "Yes" : "No"} />
      <ReadOnlyMetricRow label="Reason" value={status.reason} />
      <ReadOnlyMetricRow label="Resolution scale" value={String(status.resolutionScale)} />
      <ReadOnlyMetricRow label="Effective Hz" value={String(status.effectiveHz)} />
      <ReadOnlyMetricRow label="Nearest water distance" value={presence.nearestWaterDistance === null ? "n/a" : `${presence.nearestWaterDistance}m`} />
      <ReadOnlyMetricRow label="Visible meshes" value={String(presence.visibleMeshes)} />
      <ReadOnlyMetricRow label="Eligible meshes" value={String(presence.eligibleMeshes)} />
      <ReadOnlyMetricRow label="View visible meshes" value={String(presence.viewVisibleMeshes)} />
      <ReadOnlyMetricRow label="Total water meshes" value={String(presence.totalWaterMeshes)} />
    </InspectorSection>
  );
}

function WaterVisualProbePanel({ probe }: { readonly probe: MockWaterRuntimeSnapshot["probe"] }) {
  return (
    <InspectorSection title="Water visual probe output" testId="inspector-water-visual-probe">
      <ReadOnlyMetricRow label="Nearest body" value={probe.nearestBodyKind} />
      <ReadOnlyMetricRow label="Material mode" value={probe.materialMode} />
      <ReadOnlyMetricRow label="Max depth" value={`${probe.maxDepth}m`} />
      <ReadOnlyMetricRow label="Triangles" value={String(probe.triangles)} />
      <ReadOnlyMetricRow label="Reflection eligible" value={probe.reflectionEligible ? "Yes" : "No"} />
      <ReadOnlyMetricRow label="Reflection active" value={probe.reflectionActive ? "Yes" : "No"} />
      <ReadOnlyMetricRow label="Compositor pixel matched" value={probe.compositorPixelMatched ? "Yes" : "No"} />
    </InspectorSection>
  );
}

function WaterPresetCards({
  onApplyPreset,
  onFocusNearest,
}: {
  readonly onApplyPreset: (preset: string) => void;
  readonly onFocusNearest: () => void;
}) {
  return (
    <InspectorSection title="Water presets" testId="inspector-water-presets">
      <div className="water-preset-grid">
        <button type="button" className="toolbar-button" data-testid="water-preset-ocean" onClick={() => onApplyPreset("editor.water.applyOceanPreset")}>
          Apply Ocean Preset
        </button>
        <button type="button" className="toolbar-button" data-testid="water-preset-lake" onClick={() => onApplyPreset("editor.water.applyLakePreset")}>
          Apply Lake Preset
        </button>
        <button type="button" className="toolbar-button" data-testid="water-preset-river" onClick={() => onApplyPreset("editor.water.applyRiverPreset")}>
          Apply River Preset
        </button>
        <button type="button" className="toolbar-button" data-testid="water-preset-pond" onClick={() => onApplyPreset("editor.water.applyPondPreset")}>
          Apply Pond Preset
        </button>
        <button type="button" className="toolbar-button" data-testid="water-focus-nearest" onClick={onFocusNearest}>
          Focus nearest water body
        </button>
      </div>
    </InspectorSection>
  );
}

function PropInspector({
  prop,
  materials,
  onUpdate,
}: { readonly materials: readonly MaterialAsset[]; readonly onUpdate: (patch: Partial<PropInstance>) => void; readonly prop: PropInstance }) {
  const lodStateOptions: readonly { readonly value: PropLodState; readonly label: string }[] = [
    { value: "High", label: "High" },
    { value: "Medium", label: "Medium" },
    { value: "Low", label: "Low" },
    { value: "Culled", label: "Culled" },
  ];

  const billboardModeOptions: readonly { readonly value: BillboardMode; readonly label: string }[] = [
    { value: "SingleAxial", label: "SingleAxial" },
    { value: "Directional4", label: "Directional4" },
    { value: "Directional8", label: "Directional8" },
  ];

  return (
    <div data-testid="inspector-prop">
      <InspectorHeader title={prop.name} badge="prop" note="Prop edits affect mock state and dirty flags indirectly." />
      <InspectorSection title="Prop identity">
        <ReadOnlyMetricRow label="Id" value={prop.id} />
        <ReadOnlyMetricRow label="Type" value={prop.type} />
      </InspectorSection>
      <InspectorSection title="Transform">
        <Vector3Field
          label="Position"
          value={prop.transform.position}
          onChange={(position) => onUpdate({ transform: { ...prop.transform, position } })}
        />
        <Vector3Field
          label="Rotation"
          value={prop.transform.rotation}
          onChange={(rotation) => onUpdate({ transform: { ...prop.transform, rotation } })}
        />
        <Vector3Field
          label="Scale"
          value={prop.transform.scale}
          onChange={(scale) => onUpdate({ transform: { ...prop.transform, scale } })}
        />
      </InspectorSection>
      <InspectorSection title="Appearance">
        <EnumSelect
          label="Material"
          value={prop.material}
          onChange={(material) => onUpdate({ material })}
          testId="inspector-prop-material"
          options={materials.map((material) => ({ value: material.id, label: material.name }))}
        />
        <EnumSelect
          label="LOD state"
          value={prop.lodState}
          onChange={(lodState) => onUpdate({ lodState })}
          testId="inspector-prop-lod-state"
          options={lodStateOptions}
        />
        <EnumSelect
          label="Billboard mode"
          value={prop.billboardMode}
          onChange={(billboardMode) => onUpdate({ billboardMode })}
          testId="inspector-prop-billboard-mode"
          options={billboardModeOptions}
        />
        <BooleanToggle
          label="Collision"
          checked={prop.collision}
          onChange={(collision) => onUpdate({ collision })}
          testId="inspector-prop-collision"
        />
        <BooleanToggle
          label="Align to normal"
          checked={prop.placementRules.alignToNormal}
          onChange={(alignToNormal) =>
            onUpdate({
              placementRules: {
                ...prop.placementRules,
                alignToNormal,
              },
            })
          }
          testId="inspector-prop-terrain-conform"
        />
      </InspectorSection>
      <InspectorSection title="Placement rules">
        <BooleanToggle
          label="Avoid water"
          checked={prop.placementRules.avoidWater}
          onChange={(avoidWater) =>
            onUpdate({
              placementRules: {
                ...prop.placementRules,
                avoidWater,
              },
            })
          }
        />
        <NumericField
          label="Max slope"
          value={prop.placementRules.maxSlope}
          onChange={(maxSlope) =>
            onUpdate({
              placementRules: {
                ...prop.placementRules,
                maxSlope,
              },
            })
          }
        />
        <NumericField
          label="Min separation"
          value={prop.placementRules.minSeparation}
          onChange={(minSeparation) =>
            onUpdate({
              placementRules: {
                ...prop.placementRules,
                minSeparation,
              },
            })
          }
        />
      </InspectorSection>
    </div>
  );
}

function LegacyMaterialInspector({ atlasMapping, material }: { readonly atlasMapping: Record<string, { readonly top: string; readonly side: string; readonly bottom: string }>; readonly material: MaterialAsset }) {
  const selectedBlock =
    material.id.includes("grass") ? "grass" : material.id.includes("dirt") ? "dirt" : material.id.includes("rock") ? "rock" : material.id.includes("sand") ? "sand" : null;

  const shading = material.kind === "triplanar" ? "Triplanar" : material.kind === "building" ? "Building" : material.kind === "props" ? "Billboard props" : material.kind === "water" ? "Water shader" : "PBR block";

  return (
    <div data-testid="inspector-material">
      <InspectorHeader title={material.name} badge="material" note={`${material.kind} material profile is mocked.`} />
      <InspectorSection title="Material metadata">
        <ReadOnlyMetricRow label="Id" value={material.id} />
        <ReadOnlyMetricRow label="Kind" value={material.kind} />
        <ReadOnlyMetricRow label="Source path" value={material.sourcePath} />
      </InspectorSection>
      <InspectorSection title="Shading profile">
        <ReadOnlyMetricRow label="Mode" value={shading} />
        <ReadOnlyMetricRow label="Material block mapping" value={selectedBlock ?? "n/a"} />
      </InspectorSection>
      {selectedBlock ? (
        <InspectorSection title="Atlas faces">
          <ReadOnlyMetricRow label="Top" value={atlasMapping[selectedBlock].top} />
          <ReadOnlyMetricRow label="Side" value={atlasMapping[selectedBlock].side} />
          <ReadOnlyMetricRow label="Bottom" value={atlasMapping[selectedBlock].bottom} />
        </InspectorSection>
      ) : null}
    </div>
  );
}

function DebugInspector({ selection }: { readonly selection: Selection }) {
  const label = selection.label || selectionId(selection);
  const id = selectionId(selection);
  return (
    <div data-testid="inspector-debug_resource">
      <InspectorHeader title={label} badge="debug_resource" note="Debug resource inspector is read-only." />
      <InspectorSection title="Debug resource">
        <ReadOnlyMetricRow label="Resource id" value={id} />
      </InspectorSection>
    </div>
  );
}
