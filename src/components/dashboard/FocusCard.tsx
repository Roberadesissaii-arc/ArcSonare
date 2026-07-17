import { useState } from "react";
import { FOCUS } from "../../data/demoData";
import { addActivity } from "../../stores/appStore";
import { DotsIcon } from "../Icons";

/** The current focus block with milestone timeline below the actions. */
export function FocusCard() {
  const [subtasks, setSubtasks] = useState(FOCUS.subtasks);
  const [active, setActive] = useState(false);
  const [snoozed, setSnoozed] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);

  const done = subtasks.filter((s) => s.done).length;
  const next = subtasks.find((s) => !s.done)?.label;
  const currentIndex = subtasks.findIndex((s) => !s.done);

  const startPreparation = () => {
    setActive(true);
    setSnoozed(false);
    addActivity(`Started preparation: ${FOCUS.title}`, "system");
  };

  const snooze = (minutes: number) => {
    setSnoozed(true);
    setActive(false);
    setSnoozeOpen(false);
    addActivity(`Snoozed ${FOCUS.title} for ${minutes} min`, "system");
  };

  const toggleSubtask = (index: number) => {
    setSubtasks((prev) =>
      prev.map((s, i) => (i === index ? { ...s, done: !s.done } : s)),
    );
  };

  const progressWidth =
    subtasks.length <= 1
      ? 0
      : (Math.max(done - 0.5, 0) / (subtasks.length - 1)) * 100;

  return (
    <section className={`card sonare-card focus-card${active ? " focus-active" : ""}`}>
      <div className="card-head">
        <span className="card-label">Focus</span>
        <button type="button" className="icon-button" aria-label="Focus options">
          <DotsIcon size={15} />
        </button>
      </div>

      <h2 className="card-title">{FOCUS.title}</h2>
      <p className="card-text">{FOCUS.description}</p>

      <div className="card-actions">
        <button type="button" className="btn-pill" onClick={startPreparation}>
          {active ? "Preparing…" : "Start preparation"}
        </button>
        <div style={{ position: "relative" }}>
          <button
            type="button"
            className="text-action"
            onClick={() => setSnoozeOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={snoozeOpen}
          >
            {snoozed ? "Snoozed" : "Snooze"}
          </button>
          {snoozeOpen ? (
            <div className="mode-list" role="menu" style={{ right: 0, left: "auto", minWidth: 140 }}>
              {[15, 30, 60].map((m) => (
                <button
                  key={m}
                  type="button"
                  role="menuitem"
                  className="mode-option"
                  onClick={() => snooze(m)}
                >
                  {m} minutes
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div
        className="focus-progress"
        aria-label={`${done} of ${subtasks.length} subtasks done`}
      >
        <div className="focus-track">
          {subtasks.map((s, i) => {
            const isCurrent = !s.done && i === currentIndex;
            return (
              <button
                key={s.label}
                type="button"
                className={`focus-marker${s.done ? " done" : ""}${isCurrent ? " current" : ""}`}
                aria-label={`${s.label} — ${s.done ? "done" : isCurrent ? "current" : "open"}`}
                title={s.label}
                onClick={() => toggleSubtask(i)}
              />
            );
          })}
          <span className="focus-line" style={{ width: `${progressWidth}%` }} />
        </div>
        <div className="focus-progress-foot">
          <span className="focus-progress-text">
            {done} of {subtasks.length} subtasks done
          </span>
          {next ? <span className="focus-next">Next: {next}</span> : null}
        </div>
      </div>
    </section>
  );
}
