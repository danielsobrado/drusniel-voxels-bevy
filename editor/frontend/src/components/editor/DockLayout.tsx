import { useEffect, useMemo, useRef } from "react";
import { DockviewReact, Orientation, type DockviewApi, type DockviewReadyEvent, type IDockviewPanelProps, type SerializedDockview } from "dockview-react";
import { AgentWorkbenchPanel } from "../../features/agent/AgentWorkbenchPanel";
import { AssetBrowserPanel } from "../../features/assets/AssetBrowserPanel";
import { ConsolePanel } from "../../features/console/ConsolePanel";
import { EditToolPanel } from "../../features/edit/EditToolPanel";
import { InspectorPanel } from "../../features/inspector/InspectorPanel";
import { ProfilerPanel } from "../../features/profiler/ProfilerPanel";
import { GraphicsCapabilitiesPanel } from "../../features/profiler/GraphicsCapabilitiesPanel";
import { LightAtmospherePanel } from "../../features/light-atmosphere/LightAtmospherePanel";
import { TextureAtlasPanel } from "../../features/materials/TextureAtlasPanel";
import { WorldOutlinerPanel } from "../../features/outliner/WorldOutlinerPanel";
import { TerrainRecipePanel } from "../../features/terrain/TerrainRecipePanel";
import { ViewportPanel } from "../../features/viewport/ViewportPanel";
import { ViewportControlsPanel } from "../../features/viewport/ViewportControlsPanel";

const STORAGE_KEY = "drusniel.editor.dock-layout.v3";

const DEFAULT_LAYOUT = {
  grid: {
    root: {
      type: "branch",
      data: [
        { type: "leaf", data: { views: ["outliner"], activeView: "outliner", id: "left" }, size: 260 },
        {
          type: "branch",
          data: [
            { type: "leaf", data: { views: ["viewport"], activeView: "viewport", id: "center" }, size: 620 },
            { type: "leaf", data: { views: ["viewport-controls", "edit-tool", "light-atmosphere", "terrain-recipe", "assets", "atlas", "console", "profiler", "graphics-capabilities", "agent"], activeView: "viewport-controls", id: "bottom" }, size: 240 },
          ],
          size: 760,
        },
        { type: "leaf", data: { views: ["inspector"], activeView: "inspector", id: "right" }, size: 320 },
      ],
      size: 1200,
    },
    width: 1200,
    height: 760,
    orientation: Orientation.HORIZONTAL,
  },
  panels: {
    outliner: { id: "outliner", contentComponent: "outliner", title: "World Outliner" },
    viewport: { id: "viewport", contentComponent: "viewport", title: "Viewport" },
    inspector: { id: "inspector", contentComponent: "inspector", title: "Inspector" },
    assets: { id: "assets", contentComponent: "assets", title: "Asset Browser" },
    "viewport-controls": { id: "viewport-controls", contentComponent: "viewport-controls", title: "Viewport Controls" },
    "edit-tool": { id: "edit-tool", contentComponent: "edit-tool", title: "Edit Tool" },
    "light-atmosphere": { id: "light-atmosphere", contentComponent: "light-atmosphere", title: "Light and Atmosphere" },
    "terrain-recipe": { id: "terrain-recipe", contentComponent: "terrain-recipe", title: "Terrain Recipe" },
    atlas: { id: "atlas", contentComponent: "atlas", title: "Materials" },
    console: { id: "console", contentComponent: "console", title: "Console" },
    profiler: { id: "profiler", contentComponent: "profiler", title: "Profiler" },
    "graphics-capabilities": { id: "graphics-capabilities", contentComponent: "graphics-capabilities", title: "Graphics Capabilities" },
    agent: { id: "agent", contentComponent: "agent", title: "Agent Workbench" },
  },
  activeGroup: "center",
} satisfies SerializedDockview;

const safeReadLayout = (): SerializedDockview => {
  const stored = window.localStorage.getItem(STORAGE_KEY);

  if (!stored) {
    return DEFAULT_LAYOUT;
  }

  try {
    return JSON.parse(stored) as SerializedDockview;
  } catch {
    return DEFAULT_LAYOUT;
  }
};

const persistLayout = (api: DockviewApi): void => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(api.toJSON()));
};

interface DockLayoutProps {
  readonly resetRequestId: number;
  readonly runCommand: (commandId: string) => Promise<void>;
}

export function DockLayout({ resetRequestId, runCommand }: DockLayoutProps) {
  const apiRef = useRef<DockviewApi | null>(null);
  const lastResetRequestId = useRef(resetRequestId);
  const components = useMemo(
    () => ({
      viewport: (props: IDockviewPanelProps) => <ViewportPanel onClose={() => props.api.close()} />,
      "viewport-controls": (_props: IDockviewPanelProps) => <ViewportControlsPanel />,
      "edit-tool": (_props: IDockviewPanelProps) => <EditToolPanel />,
      "light-atmosphere": (_props: IDockviewPanelProps) => <LightAtmospherePanel />,
      "terrain-recipe": (_props: IDockviewPanelProps) => <TerrainRecipePanel />,
      outliner: (props: IDockviewPanelProps) => <WorldOutlinerPanel onClose={() => props.api.close()} />,
      inspector: (props: IDockviewPanelProps) => <InspectorPanel onClose={() => props.api.close()} />,
      assets: (_props: IDockviewPanelProps) => <AssetBrowserPanel />,
      atlas: (_props: IDockviewPanelProps) => <TextureAtlasPanel />,
      console: (_props: IDockviewPanelProps) => <ConsolePanel />,
      profiler: (_props: IDockviewPanelProps) => <ProfilerPanel />,
      "graphics-capabilities": (_props: IDockviewPanelProps) => <GraphicsCapabilitiesPanel />,
      agent: (_props: IDockviewPanelProps) => <AgentWorkbenchPanel />,
    }),
    [runCommand],
  );

  const handleReady = (event: DockviewReadyEvent) => {
    apiRef.current = event.api;
    event.api.fromJSON(safeReadLayout());
    event.api.onDidLayoutChange(() => persistLayout(event.api));
  };

  useEffect(() => {
    if (!apiRef.current || resetRequestId === lastResetRequestId.current) {
      return;
    }

    lastResetRequestId.current = resetRequestId;
    window.localStorage.removeItem(STORAGE_KEY);
    apiRef.current.fromJSON(DEFAULT_LAYOUT);
    persistLayout(apiRef.current);
  }, [resetRequestId]);

  useEffect(() => {
    const revealCameraControls = () => {
      apiRef.current?.getPanel("viewport-controls")?.api.setActive();
      window.setTimeout(() => window.dispatchEvent(new CustomEvent("drusniel:scroll-camera-controls")), 0);
    };
    window.addEventListener("drusniel:reveal-camera-controls", revealCameraControls);
    return () => window.removeEventListener("drusniel:reveal-camera-controls", revealCameraControls);
  }, []);

  useEffect(() => {
    const revealLightAtmosphere = () => {
      apiRef.current?.getPanel("light-atmosphere")?.api.setActive();
    };
    window.addEventListener("drusniel:reveal-light-atmosphere", revealLightAtmosphere);
    return () => window.removeEventListener("drusniel:reveal-light-atmosphere", revealLightAtmosphere);
  }, []);

  return (
    <main className="dock-layout-root" data-testid="dock-layout">
      <DockviewReact className="dockview-react dockview-theme-dark docklayout" components={components} onReady={handleReady} />
    </main>
  );
}
