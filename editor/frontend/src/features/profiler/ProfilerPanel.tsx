import { useEditorClients } from "../../app/providers";
import { PanelTitleBar } from "../../components/editor/PanelTitleBar";
import { useCommandRunner } from "../../commands/useCommandRunner";
import { useEditorStore } from "../../state/editorStore";
import { AmbientOcclusionPanel } from "./AmbientOcclusionPanel";
import { AdaptiveGIPanel } from "./AdaptiveGIPanel";
import { CinematicPhotoModePanel } from "./CinematicPhotoModePanel";
import { FogGodRaysPanel } from "./FogGodRaysPanel";
import { LightingAtmospherePanel } from "./LightingAtmospherePanel";
import { RenderTimingTable } from "./RenderTimingTable";
import { RenderingSettingsPanel } from "./RenderingSettingsPanel";
import { ShadowBudgetPanel } from "./ShadowBudgetPanel";
import { VolumetricCloudsPanel } from "./VolumetricCloudsPanel";

export function ProfilerPanel() {
  const metrics = useEditorStore((state) => state.runtimeMetrics);
  const { backendClient, runtimeClient } = useEditorClients();
  const { runCommandById } = useCommandRunner({ backendClient, runtimeClient });

  return (
    <section className="panel-shell" data-testid="panel-profiler" aria-labelledby="profiler-title">
      <PanelTitleBar title="Profiler" />
      <div className="panel-body">
        <h2 id="profiler-title" className="placeholder-heading">Profiler</h2>
        <p className="agent-hint">Agent Hint: profiler values refresh from the active runtime snapshot.</p>
        <dl className="metric-grid">
          <div><dt>FPS</dt><dd>{metrics.fps}</dd></div>
          <div><dt>Frame</dt><dd>{metrics.frameMs} ms</dd></div>
          <div><dt>Chunk mesh</dt><dd>{metrics.chunkMeshMs} ms</dd></div>
          <div><dt>Water reflection</dt><dd>{metrics.waterReflectionMs} ms</dd></div>
          <div><dt>Props</dt><dd>{metrics.propBillboardMs} ms</dd></div>
        </dl>

        <RenderTimingTable samples={metrics.timingSamples} />
        <div className="inspector-card">
          <div className="inspector-section-title">Water render debug</div>
          <div className="inspector-metric-grid">
            <ReadOnlyMetric label="Reflection active" value={metrics.waterRenderDebug.reflectionActive ? "yes" : "no"} />
            <ReadOnlyMetric label="Water mask pixels" value={metrics.waterRenderDebug.waterMaskPixels} />
            <ReadOnlyMetric label="Displacement enabled" value={metrics.waterRenderDebug.displacementEnabled ? "yes" : "no"} />
            <ReadOnlyMetric label="Visual probe status" value={metrics.waterRenderDebug.visualProbeStatus} />
          </div>
        </div>
        <RenderingSettingsPanel render={runCommandById} />
        <LightingAtmospherePanel render={runCommandById} />
        <FogGodRaysPanel render={runCommandById} />
        <ShadowBudgetPanel render={runCommandById} />
        <VolumetricCloudsPanel />
        <AdaptiveGIPanel />
        <AmbientOcclusionPanel render={runCommandById} />
        <CinematicPhotoModePanel render={runCommandById} />
      </div>
    </section>
  );
}

function ReadOnlyMetric({ label, value }: { readonly label: string; readonly value: string | number }) {
  return (
    <div className="inspector-readonly-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
