import { PanelTitleBar } from "../../components/editor/PanelTitleBar";
import { useEditorStore } from "../../state/editorStore";

export function ProfilerPanel() {
  const metrics = useEditorStore((state) => state.runtimeMetrics);

  return (
    <section className="panel-shell" data-testid="panel-profiler" aria-labelledby="profiler-title">
      <PanelTitleBar title="Profiler" />
      <div className="panel-body">
        <h2 id="profiler-title" className="placeholder-heading">Profiler</h2>
        <p className="agent-hint">Agent Hint: profiler values mirror mocked runtime metrics only.</p>
        <dl className="metric-grid">
          <div><dt>FPS</dt><dd>{metrics.fps}</dd></div>
          <div><dt>Frame</dt><dd>{metrics.frameMs} ms</dd></div>
          <div><dt>Chunk mesh</dt><dd>{metrics.chunkMeshMs} ms</dd></div>
          <div><dt>Water reflection</dt><dd>{metrics.waterReflectionMs} ms</dd></div>
          <div><dt>Props</dt><dd>{metrics.propBillboardMs} ms</dd></div>
        </dl>
        <div className="console-row">
          <span className="console-line">{metrics.timingSamples.map((sample) => `${sample.label}: ${sample.ms}ms`).join(" / ")}</span>
        </div>
      </div>
    </section>
  );
}
