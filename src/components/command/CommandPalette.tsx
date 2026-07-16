import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  BotIcon,
  CalendarIcon,
  GearIcon,
  LayoutIcon,
  ListIcon,
  PlugIcon,
  PlusIcon,
  SearchIcon,
  SparkleIcon,
  WaveIcon,
} from "../Icons";
import {
  addActivity,
  closePalette,
  navigate,
  useAppState,
} from "../../stores/appStore";

interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
}

interface CommandPaletteProps {
  onCreateTask: () => void;
}

/** Ctrl+K command palette: navigation, quick actions and free-form asks. */
export function CommandPalette({ onCreateTask }: CommandPaletteProps) {
  const { paletteOpen } = useAppState();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const actions = useMemo<PaletteAction[]>(
    () => [
      {
        id: "nav-dashboard",
        label: "Go to Dashboard",
        icon: <LayoutIcon size={15} />,
        run: () => navigate("dashboard"),
      },
      {
        id: "nav-tasks",
        label: "Go to Tasks",
        icon: <ListIcon size={15} />,
        run: () => navigate("tasks"),
      },
      {
        id: "nav-agent",
        label: "Go to Agent",
        icon: <BotIcon size={15} />,
        run: () => navigate("agent"),
      },
      {
        id: "nav-connect",
        label: "Go to Connect",
        icon: <PlugIcon size={15} />,
        run: () => navigate("connect"),
      },
      {
        id: "create-task",
        label: "Create task",
        icon: <PlusIcon size={15} />,
        run: onCreateTask,
      },
      {
        id: "voice",
        label: "Activate voice mode",
        icon: <WaveIcon size={15} />,
        run: () =>
          invoke("show_overlay").catch((err) =>
            console.error("[ArcSonare] failed to open voice overlay:", err),
          ),
      },
      {
        id: "urgent",
        label: "Show urgent work",
        icon: <CalendarIcon size={15} />,
        run: () => navigate("tasks", { taskFilter: "urgent" }),
      },
      {
        id: "settings",
        label: "Open Settings",
        icon: <GearIcon size={15} />,
        run: () => navigate("settings"),
      },
    ],
    [onCreateTask],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) => a.label.toLowerCase().includes(q));
  }, [actions, query]);

  useEffect(() => {
    if (paletteOpen) {
      setQuery("");
      setSelected(0);
      // Focus after the dialog mounts.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [paletteOpen]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  if (!paletteOpen) return null;

  const runAction = (action: PaletteAction) => {
    closePalette();
    action.run();
  };

  const submitFreeform = () => {
    const text = query.trim();
    if (!text) return;
    addActivity(`Asked ArcSonare: "${text}"`, "command");
    closePalette();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      closePalette();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((s) => Math.min(s + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (filtered.length > 0) runAction(filtered[Math.min(selected, filtered.length - 1)]);
      else submitFreeform();
    }
  };

  return (
    <div className="palette-backdrop" onPointerDown={closePalette}>
      <div
        className="palette"
        role="dialog"
        aria-label="Command palette"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="palette-input-row">
          <SearchIcon size={16} />
          <input
            ref={inputRef}
            className="palette-input"
            value={query}
            placeholder="Search or ask ArcSonare..."
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Search or ask ArcSonare"
          />
          <span className="palette-hint">Esc</span>
        </div>
        <ul className="palette-list" role="listbox">
          {filtered.map((action, index) => (
            <li key={action.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === selected}
                className={`palette-item${index === selected ? " selected" : ""}`}
                onMouseEnter={() => setSelected(index)}
                onClick={() => runAction(action)}
              >
                <span className="palette-item-icon">{action.icon}</span>
                <span>{action.label}</span>
              </button>
            </li>
          ))}
          {filtered.length === 0 ? (
            <li>
              <button
                type="button"
                className="palette-item selected"
                onClick={submitFreeform}
              >
                <span className="palette-item-icon">
                  <SparkleIcon size={15} />
                </span>
                <span>Ask ArcSonare: “{query.trim()}”</span>
              </button>
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
