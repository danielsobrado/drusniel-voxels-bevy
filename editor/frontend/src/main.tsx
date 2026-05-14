import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import { Providers } from "./app/providers";
import { DetachedGameCameraWindow } from "./features/viewport/DetachedGameCameraWindow";
import "./runtime/installRuntimeBridge";
import "dockview-react/dist/styles/dockview.css";
import "./index.css";

const isDetachedGameCameraWindow = new URLSearchParams(window.location.search).get("window") === "game-camera";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isDetachedGameCameraWindow ? (
      <DetachedGameCameraWindow />
    ) : (
      <Providers>
        <App />
      </Providers>
    )}
  </StrictMode>,
);
