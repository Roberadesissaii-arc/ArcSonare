import { useState } from "react";
import { FOCUS } from "../../data/demoData";
import { addActivity } from "../../stores/appStore";
import { DotsIcon } from "../Icons";

/** The current focus block with a subtle subtask timeline (demo data). */
export function FocusCard() {
  const [subtasks, setSubtasks] = useState(FOCUS.subtasks);
  const [active, setActive] = useState(false);
  const [snoozed, setSnoozed] = useState(false);

  const done = subtasks.filter((s) => s.done).length;
  const next = subtasks.find((s) => !s.done)?.label;

  const startPreparation = () => {
    setActive(true);
    setSnoozed(false);
    addActivity(`Started preparation: ${FOCUS.title}`, "system");
  };

  const snooze = () => {
    setSnoozed(true);
    setActive(false);
    addActivity(`Snoozed: ${FOCUS.title}`, "system");
  };

  const toggleSubtask = (index: number) => {
    setSubtasks((prev) =>
      prev.map((s, i) => (i === index ? { ...s, done: !s.done } : s)),
    );
  };

  return (
    <section className={`card focus-card${active ? " focus-active" : ""}`}>
      <div className="card-head">
        <span className="card-label">Focus</span>
        <button type="button" className="icon-button" aria-label="Focus options">
          <DotsIcon size={15} />
        </button>
      </div>

      <h2 className="card-title">{FOCUS.title}</h2>
      <p className="card-text">{FOCUS.description}</p>

      <div className="focus-progress" aria-label={`${done} of ${subtasks.length} subtasks done`}>
        <div className="focus-track">
          {subtasks.map((s, i) => (
            <button
              key={s.label}
              type="button"
              className={`focus-marker${s.done ? " done" : ""}`}
              aria-label={`${s.label} — ${s.done ? "done" : "open"}`}
              title={s.label}
              onClick={() => toggleSubtask(i)}
            />
          ))}
          <span
            className="focus-line"
            style={{
              width: `${(Math.max(done - 0.5, 0) / (subtasks.length - 1)) * 100}%`,
            }}
          />
        </div>
        <span className="focus-progress-text">
          {done} of {subtasks.length} subtasks done
        </span>
        {next ? <span className="focus-next">Next: {next}</span> : null}
      </div>

      <div className="card-actions">
        <button type="button" className="btn" onClick={startPreparation}>
          {active ? "Preparing…" : "Start preparation"}
        </button>
        <button type="button" className="text-action" onClick={snooze}>
          {snoozed ? "Snoozed" : "Snooze"}
        </button>
      </div>
    </section>
  );
}
