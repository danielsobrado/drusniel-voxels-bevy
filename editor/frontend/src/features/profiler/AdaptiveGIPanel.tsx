import { useEditorStore } from "../../state/editorStore";

export function AdaptiveGIPanel() {
  const adaptiveGI = useEditorStore((state) => state.runtimeMetrics.adaptiveGI);

  const setAdaptiveGI = (patch: Partial<typeof adaptiveGI>) => {
    const state = useEditorStore.getState();
    useEditorStore.setState({
      runtimeMetrics: {
        ...state.runtimeMetrics,
        adaptiveGI: {
          ...state.runtimeMetrics.adaptiveGI,
          ...patch,
        },
      },
    });
  };

  return (
    <section className="inspector-section" data-testid="profiler-adaptive-gi">
      <div className="inspector-section-title">Adaptive GI</div>
      <label>
        Adaptive GI quality
        <input
          type="number"
          min={0}
          max={5}
          value={adaptiveGI.adaptiveGiQuality}
          onChange={(event) => setAdaptiveGI({ adaptiveGiQuality: Number(event.target.value) })}
        />
      </label>
      <label>
        Probe count
        <input
          type="number"
          min={1}
          max={32}
          value={adaptiveGI.probeSelectionCount}
          onChange={(event) => setAdaptiveGI({ probeSelectionCount: Number(event.target.value) })}
        />
      </label>
      <label>
        Stochastic probe selection
        <input
          type="checkbox"
          checked={adaptiveGI.stochasticProbeSelection}
          onChange={(event) => setAdaptiveGI({ stochasticProbeSelection: event.target.checked })}
        />
      </label>
      <label>
        SDF shadows
        <input type="checkbox" checked={adaptiveGI.sdfShadows} onChange={(event) => setAdaptiveGI({ sdfShadows: event.target.checked })} />
      </label>
      <label>
        Contact shadows
        <input type="checkbox" checked={adaptiveGI.contactShadows} onChange={(event) => setAdaptiveGI({ contactShadows: event.target.checked })} />
      </label>
    </section>
  );
}
