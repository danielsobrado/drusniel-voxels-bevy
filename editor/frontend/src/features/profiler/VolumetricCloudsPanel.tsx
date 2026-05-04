import { useEditorStore } from "../../state/editorStore";

export function VolumetricCloudsPanel() {
  const clouds = useEditorStore((state) => state.runtimeMetrics.volumetricClouds);

  const setClouds = (patch: Partial<typeof clouds>) => {
    const state = useEditorStore.getState();
    useEditorStore.setState({
      runtimeMetrics: {
        ...state.runtimeMetrics,
        volumetricClouds: {
          ...state.runtimeMetrics.volumetricClouds,
          ...patch,
        },
      },
    });
  };

  return (
    <section className="inspector-section" data-testid="profiler-volumetric-clouds">
      <div className="inspector-section-title">Volumetric clouds</div>
      <label>
        Coverage
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={clouds.coverage}
          onChange={(event) => setClouds({ coverage: Number(event.target.value) })}
        />
      </label>
      <label>
        Render scale
        <input
          type="range"
          min={0.1}
          max={1.5}
          step={0.01}
          value={clouds.renderScale}
          onChange={(event) => setClouds({ renderScale: Number(event.target.value) })}
        />
      </label>
      <label>
        Primary steps
        <input type="number" min={0} max={128} value={clouds.primarySteps} onChange={(event) => setClouds({ primarySteps: Number(event.target.value) })} />
      </label>
      <label>
        Light steps
        <input type="number" min={0} max={128} value={clouds.lightSteps} onChange={(event) => setClouds({ lightSteps: Number(event.target.value) })} />
      </label>
    </section>
  );
}
