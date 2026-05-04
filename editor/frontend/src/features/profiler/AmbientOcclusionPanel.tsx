import { useEditorStore } from "../../state/editorStore";

interface AmbientOcclusionPanelProps {
  readonly render: (commandId: string) => Promise<void>;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export function AmbientOcclusionPanel({ render }: AmbientOcclusionPanelProps) {
  const metrics = useEditorStore((state) => state.runtimeMetrics.ambientOcclusion);

  const setAmbient = (patch: Partial<typeof metrics>) => {
    const state = useEditorStore.getState();
    useEditorStore.setState({
      runtimeMetrics: {
        ...state.runtimeMetrics,
        ambientOcclusion: {
          ...state.runtimeMetrics.ambientOcclusion,
          ...patch,
        },
      },
    });
  };

  return (
    <section className="inspector-section" data-testid="profiler-ambient-occlusion">
      <div className="inspector-section-title">AO / GI</div>
      <div className="inspector-action-row">
        <button type="button" className="toolbar-button" data-testid="profiler-toggle-gtao" onClick={() => void render("editor.debug.toggleGtao")}>
          {metrics.gtaoEnabled ? "Disable GTAO" : "Enable GTAO"}
        </button>
        <button type="button" className="toolbar-button" data-testid="profiler-toggle-ssao" onClick={() => void render("editor.debug.toggleSsao")}>
          {metrics.ssaoEnabled ? "Disable SSAO" : "Enable SSAO"}
        </button>
        <button type="button" className="toolbar-button" data-testid="profiler-toggle-baked-ao" onClick={() => void render("editor.debug.toggleBakedAo")}>
          {metrics.bakedAoStrength > 0 ? "Disable baked AO" : "Enable baked AO"}
        </button>
      </div>

      <label>
        GTAO quality
        <select value={metrics.gtaoQuality} onChange={(event) => setAmbient({ gtaoQuality: event.target.value as typeof metrics.gtaoQuality })}>
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
        </select>
      </label>
      <label>
        GTAO slices
        <input type="number" value={metrics.gtaoSliceCount} min={1} max={64} onChange={(event) => setAmbient({ gtaoSliceCount: Number(event.target.value) })} />
      </label>
      <label>
        GTAO steps/slice
        <input
          type="number"
          value={metrics.gtaoStepsPerSlice}
          min={1}
          max={64}
          onChange={(event) => setAmbient({ gtaoStepsPerSlice: Number(event.target.value) })}
        />
      </label>
      <label>
        GTAO radius
        <input
          type="number"
          step={0.05}
          value={metrics.gtaoRadius}
          min={0}
          max={5}
          onChange={(event) => setAmbient({ gtaoRadius: clamp(Number(event.target.value), 0, 5) })}
        />
      </label>
      <label>
        Temporal denoise
        <input type="checkbox" checked={metrics.gtaoTemporalDenoise} onChange={(event) => setAmbient({ gtaoTemporalDenoise: event.target.checked })} />
      </label>
      <label>
        SSAO supported
        <input type="checkbox" checked={metrics.ssaoSupported} readOnly />
      </label>
      <label>
        Baked AO strength
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={metrics.bakedAoStrength}
          onChange={(event) => setAmbient({ bakedAoStrength: clamp(Number(event.target.value), 0, 1) })}
        />
      </label>
    </section>
  );
}
