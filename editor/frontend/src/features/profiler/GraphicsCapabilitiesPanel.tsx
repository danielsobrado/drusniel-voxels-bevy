import { useEditorClients } from "../../app/providers";
import { useEditorStore } from "../../state/editorStore";
import { useCommandRunner } from "../../commands/useCommandRunner";

export function GraphicsCapabilitiesPanel() {
  const capabilities = useEditorStore((state) => state.runtimeMetrics.graphicsCapabilities);
  const { backendClient, runtimeClient } = useEditorClients();
  const { runCommandById } = useCommandRunner({ backendClient, runtimeClient });

  return (
    <section className="panel-shell" data-testid="panel-graphics-capabilities" aria-labelledby="graphics-capabilities-title">
      <div className="panel-body">
        <h2 id="graphics-capabilities-title" className="placeholder-heading">
          Graphics Capabilities
        </h2>
        <section className="inspector-section">
          <div className="inspector-section-title">GPU</div>
          <div className="inspector-readonly-row">
            <span>Adapter</span>
            <strong>{capabilities.adapterName}</strong>
          </div>
          <div className="inspector-readonly-row">
            <span>Integrated GPU</span>
            <strong>{capabilities.integratedGPU ? "yes" : "no"}</strong>
          </div>
          <div className="inspector-readonly-row">
            <span>TAA supported</span>
            <strong>{capabilities.taaSupported ? "yes" : "no"}</strong>
          </div>
          <div className="inspector-readonly-row">
            <span>Ray tracing supported</span>
            <strong data-testid="profiler-ray-tracing">{capabilities.rayTracingSupported ? "yes" : "no"}</strong>
          </div>
        </section>
        <section className="inspector-section">
          <button
            type="button"
            className="toolbar-button"
            data-testid="profiler-toggle-ray-tracing"
            onClick={() => void runCommandById("editor.debug.toggleRayTracingMock")}
          >
            {capabilities.rayTracingSupported ? "Disable ray tracing mock" : "Enable ray tracing mock"}
          </button>
        </section>
      </div>
    </section>
  );
}
