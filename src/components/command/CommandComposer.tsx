import { useEffect, useRef, useState } from "react";
import { CloseIcon, ChevronDownIcon, SendIcon, SparkleIcon } from "../Icons";
import { addActivity } from "../../stores/appStore";

const QUICK_ACTIONS = [
  { label: "Summarize updates", prompt: "Summarize today's updates" },
  { label: "Draft email", prompt: "Draft an email about " },
  { label: "Find insights", prompt: "Find insights in " },
  { label: "Create task", prompt: "Create a task: " },
];

const MODES = ["Smart", "Precise", "Creative"] as const;

/**
 * The floating bottom command composer. Submissions are recorded to the
 * local activity log only — no remote model is connected in this phase.
 */
export function CommandComposer() {
  const [value, setValue] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [mode, setMode] = useState<(typeof MODES)[number]>("Smart");
  const [modeOpen, setModeOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!modeOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!modeRef.current?.contains(event.target as Node)) setModeOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [modeOpen]);

  const submit = () => {
    const text = value.trim();
    if (!text) return;
    addActivity(`Command (${mode}): "${text}"`, "command");
    setValue("");
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
      addActivity(`Command (${mode}): "${prompt}"`, "command");
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
        <SparkleIcon size={14} />
        <span>Ask ArcSonare anything...</span>
      </button>
    );
  }

  return (
    <div className="composer">
      <div className="composer-input-row">
        <span className="composer-spark" aria-hidden="true">
          <SparkleIcon size={15} />
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
              {mode}
              <ChevronDownIcon size={13} />
            </button>
            {modeOpen ? (
              <ul className="mode-list" role="listbox" aria-label="Response mode">
                {MODES.map((m) => (
                  <li key={m}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={m === mode}
                      className={`mode-option${m === mode ? " selected" : ""}`}
                      onClick={() => {
                        setMode(m);
                        setModeOpen(false);
                      }}
                    >
                      {m}
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
