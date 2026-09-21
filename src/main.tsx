import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import "./styles/global.css";
import "./styles/shell.css";
import "./styles/dashboard.css";
import "./styles/cards.css";
import "./styles/watch.css";
import "./styles/meeting.css";
import "./styles/agents.css";
import "./styles/data-privacy.css";
import "./styles/voice.css";
import "./styles/voice-lab.css";
import "./styles/overlay.css";
import "./styles/settings.css";
import "./styles/display-mapping.css";
import "./styles/conversation-logs.css";
import "./styles/quick-menu.css";
import "./styles/responsive.css";
import "./styles/auth.css";
import { installTraceConsoleHook } from "./features/capabilities/executionTrace";
import { installEvalConsoleHook } from "./features/capabilities/evalRunner";

// Developer-only: `window.__arcsonareTrace.all()` shows which capability the
// model actually called. Never rendered in chat.
installTraceConsoleHook();
// Dev-only model evaluation through the Rust broker — the credential never
// reaches JavaScript, and no shell environment variable is required.
installEvalConsoleHook();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
