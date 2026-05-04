import { useEditorStore } from "../../state/editorStore";

interface FogGodRaysPanelProps {
  readonly render: (commandId: string) => Promise<void>;
}

export function FogGodRaysPanel({ render }: FogGodRaysPanelProps) {
  const metrics = useEditorStore((state) => state.runtimeMetrics.lightingAtmosphere);

  const setLighting = (patch: Partial<typeof metrics>) => {
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
    <section className="inspector-section" data-testid="profiler-fog-god-rays">
      <div className="inspector-section-title">Fog and god rays</div>
      <button type="button" className="toolbar-button" data-testid="profiler-toggle-god-rays" onClick={() => void render("editor.debug.toggleGodRays")}>
        {metrics.godRaysEnabled ? "Disable god rays" : "Enable god rays"}
      </button>
      <label>
        God ray intensity
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={metrics.godRayIntensity}
          onChange={(event) => setLighting({ godRayIntensity: Number(event.target.value) })}
        />
      </label>
      <div className="inspector-readonly-row" data-testid="profiler-god-ray-state">
        <span>god rays active</span>
        <strong>{metrics.godRaysEnabled ? "yes" : "no"}</strong>
      </div>
    </section>
  );
}
