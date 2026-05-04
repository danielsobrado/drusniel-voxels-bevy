import { useEditorStore } from "../../state/editorStore";

interface CinematicPhotoModePanelProps {
  readonly render: (commandId: string) => Promise<void>;
}

export function CinematicPhotoModePanel({ render }: CinematicPhotoModePanelProps) {
  const cinematic = useEditorStore((state) => state.runtimeMetrics.cinematicPhotoMode);

  const setPhotoMode = (patch: Partial<typeof cinematic>) => {
    const state = useEditorStore.getState();
    useEditorStore.setState({
      runtimeMetrics: {
        ...state.runtimeMetrics,
        cinematicPhotoMode: {
          ...state.runtimeMetrics.cinematicPhotoMode,
          ...patch,
        },
      },
    });
  };

  return (
    <section className="inspector-section" data-testid="profiler-cinematic-photo">
      <div className="inspector-section-title">Cinematic / photo mode</div>
      <div className="inspector-action-row">
        <button type="button" className="toolbar-button" data-testid="profiler-toggle-photo-mode" onClick={() => void render("editor.debug.togglePhotoMode")}>
          {cinematic.photoModeActive ? "Disable photo mode" : "Enable photo mode"}
        </button>
        <button
          type="button"
          className="toolbar-button"
          data-testid="profiler-toggle-cinematic-mode"
          onClick={() => void render("editor.debug.toggleCinematicMode")}
        >
          {cinematic.cinematicModeActive ? "Disable cinematic mode" : "Enable cinematic mode"}
        </button>
      </div>

      <label>
        Focal distance
        <input
          type="number"
          min={0}
          value={cinematic.focalDistance}
          onChange={(event) => setPhotoMode({ focalDistance: Number(event.target.value) })}
        />
      </label>
      <label>
        Aperture
        <input
          type="number"
          min={0.5}
          max={20}
          step={0.1}
          value={cinematic.aperture}
          onChange={(event) => setPhotoMode({ aperture: Number(event.target.value) })}
        />
      </label>
      <label>
        Blur enabled
        <input
          type="checkbox"
          checked={cinematic.blurEnabled}
          onChange={(event) => setPhotoMode({ blurEnabled: event.target.checked })}
        />
      </label>
      <label>
        Depth of field mode
        <input
          type="text"
          value={cinematic.depthOfFieldMode}
          onChange={(event) => setPhotoMode({ depthOfFieldMode: event.target.value })}
        />
      </label>
      <label>
        Motion blur samples
        <input
          type="number"
          min={0}
          max={64}
          value={cinematic.motionBlurSamples}
          onChange={(event) => setPhotoMode({ motionBlurSamples: Number(event.target.value) })}
        />
      </label>
    </section>
  );
}
