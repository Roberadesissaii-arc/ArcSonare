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
  requireCenterConfig,
  startCenterWork,
  completeCenterWork,
} from "../../stores/centerStageStore";

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
  /** No mode backend exists yet; only honest labels ship. */
  comingLater?: boolean;
}

const MODES: ComposerMode[] = [
  {
    id: "smart",
    name: "Smart mode",
    description: "Automatically chooses the best approach",
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
    description: "Uses available private local models",
    icon: CpuIcon,
    comingLater: true,
  },
];

/**
 * The floating bottom command composer. Submissions are recorded to the
 * local activity log only — no remote model is connected in this phase.
 */
export function CommandComposer() {
  const [value, setValue] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [mode, setMode] = useState<ComposerMode>(MODES[0]);
  const [modeOpen, setModeOpen] = useState(false);
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
    if (!text) return;
    addActivity(`Command (${mode.name}): "${text}"`, "command");
    setValue("");

    const lower = text.toLowerCase();
    const intent = parseOverlayIntent(text);

    // Dashboard center-stage workflows (draft / summarize / insights / task).
    if (lower.startsWith("draft an email") || lower.startsWith("draft email")) {
      startCenterWork({
        kind: "draft-email",
        title: "Drafting email",
        status: "Understanding your request",
        step: "Reviewing the provided context",
        progress: 28,
        contextNote: "Local composer context only — no model is connected yet.",
        resultReady: false,
      });
      window.setTimeout(() => {
        requireCenterConfig(
          "Draft workflow prepared. Configure a model to generate the email.",
        );
      }, 900);
    } else if (lower.startsWith("summarize")) {
      startCenterWork({
        kind: "summarize",
        title: "Summarizing updates",
        status: "Gathering local updates",
        step: "Preparing summary",
        progress: 40,
        contextNote: "Using local demo activity — no remote sources connected.",
        resultReady: false,
      });
      window.setTimeout(() => {
        completeCenterWork({
          status: "Summary ready (demo)",
          step: "Review the key points below.",
        });
      }, 900);
    } else if (lower.startsWith("find insights") || lower.startsWith("find insight")) {
      startCenterWork({
        kind: "find-insights",
        title: "Finding insights",
        status: "Scanning connected sources",
        step: "No live sources connected — preparing demo scope",
        progress: 35,
        contextNote: "Insight search requires connected knowledge sources.",
        resultReady: false,
      });
      window.setTimeout(() => {
        requireCenterConfig(
          "Insight search requires connected sources and a configured model.",
        );
      }, 900);
    } else if (lower.startsWith("create a task") || lower.startsWith("create task")) {
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
      }, 700);
    }

    const drivesOverlay =
      intent.kind === "open" ||
      intent.kind === "search" ||
      intent.kind === "draft-email" ||
      intent.kind === "schedule-meeting" ||
      intent.kind === "create-task" ||
      intent.kind === "screen-context" ||
      intent.kind === "mention" ||
      intent.kind === "clarify";

    // Open-app phrases also drive the top overlay for visual QA.
    if (intent.kind === "open" || intent.kind === "search") {
      void invoke("overlay_queue_command", { transcript: text })
        .then(() => invoke("show_overlay"))
        .catch((err) =>
          console.error("[ArcSonare] failed to drive overlay from composer:", err),
        );
    } else if (drivesOverlay && intent.kind !== "draft-email" && intent.kind !== "create-task") {
      void invoke("overlay_queue_command", { transcript: text })
        .then(() => invoke("show_overlay"))
        .catch((err) =>
          console.error("[ArcSonare] failed to drive overlay from composer:", err),
        );
    }
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
      addActivity(`Command (${mode.name}): "${prompt}"`, "command");
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
          placeholder="Ask ArcSonare anything..."
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Ask ArcSonare"
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
                      onClick={() => {
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
            disabled={!value.trim()}
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
