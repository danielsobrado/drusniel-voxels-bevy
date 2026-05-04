import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import { Providers } from "./app/providers";
import "dockview-react/dist/styles/dockview.css";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Providers>
      <App />
    </Providers>
  </StrictMode>,
);
