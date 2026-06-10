import { useEditorStore } from "../../state/editorStore";
import type { RenderQualityPreset } from "../../types/editor";

interface RenderingSettingsPanelProps {
  readonly render: (commandId: string) => Promise<void>;
}

export function RenderingSettingsPanel({ render }: RenderingSettingsPanelProps) {
  const metrics = useEditorStore((state) => state.runtimeMetrics);
  const pendingCommandIds = useEditorStore((state) => state.pendingCommandIds);
  const qualityPending = pendingCommandIds.some((commandId) => commandId.startsWith("editor.rendering.setQuality") || commandId.startsWith("editor.quality."));
  const hexPending = pendingCommandIds.some((commandId) => commandId.startsWith("editor.rendering.toggleHexTiling"));
  const terrainTexturing = metrics.terrainTexturing;
  const hexGateHint = terrainTexturing.gatedByIntegratedGpu
    ? "Off: integrated GPU gate"
    : terrainTexturing.gatedByLowQuality
      ? "Off: Low / Performance100 gate"
      : terrainTexturing.configured.enabled && !terrainTexturing.effective.enabled
        ? "Configured on, runtime off"
        : terrainTexturing.effective.enabled
          ? "Active in runtime"
          : "Off";

  return (
    <section className="inspector-section" data-testid="profiler-rendering-settings">
      <div className="inspector-section-title">Rendering settings</div>
      <label>
        Render preset
        <select
          data-testid="profiler-render-quality"
          value={metrics.renderQualityPreset}
          disabled={qualityPending}
          onChange={(event) => void render(`editor.rendering.setQuality${event.target.value as RenderQualityPreset}`)}
        >
          <option value="Low">Low</option>
          <option value="Medium">Medium</option>
          <option value="High">High</option>
          <option value="Performance100">Performance100</option>
        </select>
      </label>

      <div className="inspector-section-title">Terrain hex tiling</div>
      <label>
        <input
          type="checkbox"
          data-testid="profiler-hex-tiling-albedo"
          checked={terrainTexturing.configured.enabled}
          disabled={hexPending}
          onChange={() => void render("editor.rendering.toggleHexTiling")}
        />
        Hex tiling (albedo)
      </label>
      <label>
        <input
          type="checkbox"
          data-testid="profiler-hex-tiling-normal"
          checked={terrainTexturing.configured.normalEnabled}
          disabled={hexPending || !terrainTexturing.configured.enabled}
          onChange={() => void render("editor.rendering.toggleHexTilingNormal")}
        />
        Hex tiling normals
      </label>
      <p className="inspector-subnote" data-testid="profiler-hex-tiling-status">
        {hexGateHint}
        {terrainTexturing.effective.normalEnabled ? " · normals active" : ""}
      </p>

      <button type="button" className="toolbar-button" onClick={() => void render("editor.debug.openRenderTimings")}>
        Open render timing table
      </button>

      <div className="inspector-metric-grid">
        <ReadOnlyMetric label="Prop LOD distance scale" value={metrics.renderQualityReadouts.propLodDistanceScale} testId="profiler-prop-lod-distance-scale" />
        <ReadOnlyMetric
          label="Prop shadow distance scale"
          value={metrics.renderQualityReadouts.propShadowDistanceScale}
          testId="profiler-prop-shadow-distance-scale"
        />
        <ReadOnlyMetric
          label="Terrain material LOD distance"
          value={metrics.renderQualityReadouts.terrainMaterialLodDistance}
          testId="profiler-terrain-material-lod-distance"
        />
        <ReadOnlyMetric
          label="Water reflection scale"
          value={metrics.renderQualityReadouts.waterReflectionResolutionScale}
          testId="profiler-water-reflection-resolution-scale"
        />
        <ReadOnlyMetric
          label="Water reflection interval"
          value={metrics.renderQualityReadouts.waterReflectionUpdateInterval}
          testId="profiler-water-reflection-update-interval"
        />
        <ReadOnlyMetric
          label="Water reflection distance"
          value={metrics.renderQualityReadouts.waterReflectionDistance}
          testId="profiler-water-reflection-distance"
        />
        <ReadOnlyMetric
          label="Water reflection quality"
          value={metrics.renderQualityReadouts.waterReflectionQualityCode}
          testId="profiler-water-reflection-quality-code"
        />
        <ReadOnlyMetric
          label="Shadow quality"
          value={metrics.renderQualityReadouts.shadowQualityCode}
          testId="profiler-shadow-quality-code"
        />
      </div>
    </section>
  );
}

function ReadOnlyMetric({ label, value, testId }: { readonly label: string; readonly testId: string; readonly value: number }) {
  return (
    <div data-testid={testId}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
