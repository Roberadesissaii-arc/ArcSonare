import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import "./styles/global.css";
import "./styles/shell.css";
import "./styles/dashboard.css";
import "./styles/cards.css";
import "./styles/agents.css";
import "./styles/voice.css";
import "./styles/overlay.css";
import "./styles/settings.css";
import "./styles/screen-context.css";
import "./styles/quick-menu.css";
import "./styles/responsive.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
