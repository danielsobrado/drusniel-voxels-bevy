import { useEffect, useMemo, useRef } from "react";
import { DockviewReact, Orientation, type DockviewApi, type DockviewReadyEvent, type IDockviewPanelProps, type SerializedDockview } from "dockview-react";
import { AgentWorkbenchPanel } from "../../features/agent/AgentWorkbenchPanel";
import { AssetBrowserPanel } from "../../features/assets/AssetBrowserPanel";
import { ConsolePanel } from "../../features/console/ConsolePanel";
import { InspectorPanel } from "../../features/inspector/InspectorPanel";
import { ProfilerPanel } from "../../features/profiler/ProfilerPanel";
import { TextureAtlasPanel } from "../../features/materials/TextureAtlasPanel";
import { WorldOutlinerPanel } from "../../features/outliner/WorldOutlinerPanel";
import { ViewportPanel } from "../../features/viewport/ViewportPanel";

const STORAGE_KEY = "drusniel.editor.dock-layout.v1";

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
            { type: "leaf", data: { views: ["assets", "atlas", "console", "profiler", "agent"], activeView: "assets", id: "bottom" }, size: 240 },
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
    atlas: { id: "atlas", contentComponent: "atlas", title: "Texture Atlas" },
    console: { id: "console", contentComponent: "console", title: "Console" },
    profiler: { id: "profiler", contentComponent: "profiler", title: "Profiler" },
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
}

export function DockLayout({ resetRequestId }: DockLayoutProps) {
  const apiRef = useRef<DockviewApi | null>(null);
  const lastResetRequestId = useRef(resetRequestId);
  const components = useMemo(
    () => ({
      viewport: (_props: IDockviewPanelProps) => <ViewportPanel />,
      outliner: (_props: IDockviewPanelProps) => <WorldOutlinerPanel />,
      inspector: (_props: IDockviewPanelProps) => <InspectorPanel />,
      assets: (_props: IDockviewPanelProps) => <AssetBrowserPanel />,
      atlas: (_props: IDockviewPanelProps) => <TextureAtlasPanel />,
      console: (_props: IDockviewPanelProps) => <ConsolePanel />,
      profiler: (_props: IDockviewPanelProps) => <ProfilerPanel />,
      agent: (_props: IDockviewPanelProps) => <AgentWorkbenchPanel />,
    }),
    [],
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

  return (
    <main className="dock-layout-root" data-testid="dock-layout">
      <DockviewReact className="dockview-react dockview-theme-dark docklayout" components={components} onReady={handleReady} />
    </main>
  );
}
