import { useEditorStore } from "../../state/editorStore";

interface LightingAtmospherePanelProps {
  readonly render: (commandId: string) => Promise<void>;
}

export function LightingAtmospherePanel({ render }: LightingAtmospherePanelProps) {
  const metrics = useEditorStore((state) => state.runtimeMetrics);

  const setAtmosphere = (patch: Partial<typeof metrics.lightingAtmosphere>) => {
    const state = useEditorStore.getState();
    useEditorStore.setState({
      runtimeMetrics: {
        ...state.runtimeMetrics,
        lightingAtmosphere: {
          ...state.runtimeMetrics.lightingAtmosphere,
          ...patch,
        },
      },
    });
  };

  return (
    <section className="inspector-section" data-testid="profiler-lighting-atmosphere">
      <div className="inspector-section-title">Lighting and atmosphere</div>
      <label>
        Sun/time-of-day
        <input
          type="text"
          value={metrics.lightingAtmosphere.sunTimeOfDay}
          onChange={(event) => setAtmosphere({ sunTimeOfDay: event.target.value })}
          data-testid="profiler-sun-time"
        />
      </label>
      <label>
        Fog preset
        <input
          type="text"
          value={metrics.lightingAtmosphere.fogPreset}
          onChange={(event) => setAtmosphere({ fogPreset: event.target.value })}
          data-testid="profiler-fog-preset"
        />
      </label>
      <button
        type="button"
        className="toolbar-button"
        data-testid="profiler-toggle-fog"
        onClick={() => void render("editor.debug.toggleFog")}
      >
        {metrics.lightingAtmosphere.fogActive ? "Disable fog" : "Enable fog"}
      </button>
    </section>
  );
}
