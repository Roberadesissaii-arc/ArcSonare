import { useEffect, useRef, useState, type ComponentType } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ChartIcon,
  CheckIcon,
  CheckSquareIcon,
  ChevronDownIcon,
  CloseIcon,
  CpuIcon,
  LayersIcon,
  ListIcon,
  MailIcon,
  SearchIcon,
  SendIcon,
  SparkleIcon,
  ZapIcon,
} from "../Icons";
import { SonareSparkle } from "../brand/SonareSparkle";
import { addActivity } from "../../stores/appStore";
import { parseOverlayIntent } from "../../features/top-overlay/iconResolver";
import {
  completeCenterWork,
  requireCenterConfig,
  startCenterWork,
} from "../../stores/centerStageStore";
import { askAssistant } from "../../services/AssistantService";
import { getPrefs } from "../../stores/settingsStore";
import { modelById } from "../../config/modelRegistry";

const QUICK_ACTIONS: {
  label: string;
  prompt: string;
  icon: ComponentType<{ size?: number }>;
}[] = [
  { label: "Summarize updates", prompt: "Summarize today's updates", icon: ListIcon },
  { label: "Draft email", prompt: "Draft an email about ", icon: MailIcon },
  { label: "Find insights", prompt: "Find insights in ", icon: ChartIcon },
  { label: "Create task", prompt: "Create a task: ", icon: CheckSquareIcon },
];

interface ComposerMode {
  id: string;
  name: string;
  description: string;
  icon: ComponentType<{ size?: number }>;
  comingLater?: boolean;
}

const MODES: ComposerMode[] = [
  {
    id: "smart",
    name: "Smart mode",
    description: "Uses your default model from Settings → Models",
    icon: SparkleIcon,
  },
  {
    id: "fast",
    name: "Fast mode",
    description: "Prioritizes speed",
    icon: ZapIcon,
    comingLater: true,
  },
  {
    id: "reasoning",
    name: "Reasoning mode",
    description: "Uses deeper step-by-step planning",
    icon: LayersIcon,
    comingLater: true,
  },
  {
    id: "research",
    name: "Research mode",
    description: "Searches connected knowledge and sources",
    icon: SearchIcon,
    comingLater: true,
  },
  {
    id: "local",
    name: "Local mode",
    description: "Always uses Ollama on this computer",
    icon: CpuIcon,
  },
];

/** Ask the selected default model (or force Ollama in Local mode). */
async function runAssistant(text: string, forceLocal: boolean) {
  const role = modelById(getPrefs().models.roles.assistant);
  const title = text.length > 64 ? `${text.slice(0, 61)}…` : text;

  startCenterWork({
    kind: "generic",
    title,
    status: "Thinking…",
    step: forceLocal
      ? "Connecting to Ollama"
      : role
        ? `Using ${role.displayName}`
        : "Connecting…",
    progress: 28,
    contextNote: forceLocal
      ? "Local mode — Ollama on this computer."
      : "Uses your default model from Settings → Models.",
    resultReady: false,
  });

  try {
    const reply = await askAssistant(text, { forceLocal });
    completeCenterWork({
      status: reply.text,
      step: reply.localTool
        ? `Answered with ${reply.localTool}`
        : `Reply from ${reply.sourceLabel}`,
      contextNote: reply.sourceLabel,
    });
    addActivity(`ArcSonare: ${reply.text.slice(0, 120)}`, "agent");
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "The assistant did not reply.";
    requireCenterConfig(message);
  }
}

/**
 * Bottom command composer. General chat goes to Ollama; app/email intents
 * also drive the top overlay when relevant.
 */
export function CommandComposer() {
  const [value, setValue] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [mode, setMode] = useState<ComposerMode>(MODES[0]);
  const [modeOpen, setModeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!modeOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!modeRef.current?.contains(event.target as Node)) setModeOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModeOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [modeOpen]);

  const submit = () => {
    const text = value.trim();
    if (!text || busy) return;
    addActivity(`You: "${text}"`, "command");
    setValue("");
    setBusy(true);

    const lower = text.toLowerCase();
    const intent = parseOverlayIntent(text);

    const finish = () => setBusy(false);

    // Structured intents that should open the overlay.
    if (
      intent.kind === "open" ||
      intent.kind === "search" ||
      intent.kind === "draft-email" ||
      intent.kind === "schedule-meeting" ||
      intent.kind === "screen-context" ||
      intent.kind === "mention" ||
      intent.kind === "clarify"
    ) {
      void invoke("overlay_queue_command", { transcript: text })
        .then(() => invoke("show_overlay"))
        .catch((err) =>
          console.error("[ArcSonare] failed to drive overlay from composer:", err),
        )
        .finally(finish);
      return;
    }

    if (lower.startsWith("create a task") || lower.startsWith("create task")) {
      startCenterWork({
        kind: "create-task",
        title: "Creating task",
        status: "Preparing task form",
        step: text.replace(/^create (a )?task[:\s]*/i, "") || "New task",
        progress: 50,
        contextNote: "Task will be saved locally.",
        resultReady: false,
      });
      window.setTimeout(() => {
        completeCenterWork({
          status: "Open Tasks to finish creating this item.",
          step: "Task draft prepared locally.",
        });
        finish();
      }, 700);
      return;
    }

    // Everything else — including “hello” — uses the selected default model.
    void runAssistant(text, mode.id === "local").finally(finish);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      textareaRef.current?.blur();
    }
  };

  const applyQuickAction = (prompt: string) => {
    if (prompt.endsWith(" ") || prompt.endsWith(":")) {
      setValue(prompt);
      textareaRef.current?.focus();
    } else {
      setValue(prompt);
      window.setTimeout(() => {
        // Let state settle then submit.
        const text = prompt.trim();
        if (!text || busy) return;
        addActivity(`You: "${text}"`, "command");
        setValue("");
        setBusy(true);
        void runAssistant(text, mode.id === "local").finally(() => setBusy(false));
      }, 0);
    }
  };

  if (collapsed) {
    return (
      <button
        type="button"
        className="composer-collapsed"
        onClick={() => setCollapsed(false)}
        aria-label="Expand the command composer"
      >
        <SonareSparkle size={16} />
        <span>Ask ArcSonare anything...</span>
      </button>
    );
  }

  return (
    <div className="composer">
      <div className="composer-input-row">
        <span className="composer-spark" aria-hidden="true">
          <SonareSparkle size={22} />
        </span>
        <textarea
          ref={textareaRef}
          className="composer-input"
          rows={1}
          value={value}
          placeholder={busy ? "ArcSonare is thinking…" : "Ask ArcSonare anything..."}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Ask ArcSonare"
          disabled={busy}
        />
        <button
          type="button"
          className="icon-button"
          onClick={() => setCollapsed(true)}
          aria-label="Collapse the composer"
          title="Collapse"
        >
          <CloseIcon size={14} />
        </button>
      </div>

      <div className="composer-foot">
        <div className="composer-quick">
          {QUICK_ACTIONS.map((qa) => (
            <button
              key={qa.label}
              type="button"
              className="quick-action"
              onClick={() => applyQuickAction(qa.prompt)}
              disabled={busy}
            >
              <qa.icon size={14} />
              {qa.label}
            </button>
          ))}
        </div>
        <div className="composer-right">
          <div className="composer-mode" ref={modeRef}>
            <button
              type="button"
              className="mode-button"
              onClick={() => setModeOpen((v) => !v)}
              aria-haspopup="listbox"
              aria-expanded={modeOpen}
            >
              {mode.name}
              <ChevronDownIcon size={13} />
            </button>
            {modeOpen ? (
              <ul className="mode-list" role="listbox" aria-label="Response mode">
                {MODES.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={m.id === mode.id}
                      className={`mode-option${m.id === mode.id ? " selected" : ""}`}
                      disabled={m.comingLater}
                      onClick={() => {
                        if (m.comingLater) return;
                        setMode(m);
                        setModeOpen(false);
                      }}
                    >
                      <span className="mode-option-icon">
                        <m.icon size={15} />
                      </span>
                      <span className="mode-option-meta">
                        <span className="mode-option-name">
                          {m.name}
                          {m.comingLater ? (
                            <span className="mode-option-soon">Coming later</span>
                          ) : null}
                        </span>
                        <span className="mode-option-desc">{m.description}</span>
                      </span>
                      {m.id === mode.id ? (
                        <span className="mode-option-check">
                          <CheckIcon size={14} />
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <button
            type="button"
            className="composer-send"
            onClick={submit}
            disabled={!value.trim() || busy}
            aria-label="Send command"
            title="Send"
          >
            <SendIcon size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
