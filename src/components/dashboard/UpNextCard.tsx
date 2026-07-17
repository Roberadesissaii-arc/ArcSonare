import { UP_NEXT } from "../../data/demoData";
import { integrationIcons } from "../../config/iconRegistry";
import { navigate } from "../../stores/appStore";

/**
 * Today's schedule (local demo data). No footer — fills the side-column
 * card height. Rows match Urgent: hoverable, clickable, no permanent chrome.
 */
export function UpNextCard() {
  const events = UP_NEXT.slice(0, 4);

  return (
    <section className="card sonare-card upnext-card">
      <div className="card-head">
        <span className="card-label">Up Next</span>
      </div>
      <ul className="upnext-list">
        {events.map((event) => (
          <li key={event.title}>
            <button
              type="button"
              className="upnext-row"
              onClick={() => navigate("tasks")}
              aria-label={`Open schedule: ${event.title}`}
            >
              <span className="upnext-time">{event.time}</span>
              <span className="upnext-meta">
                <span className="upnext-title">{event.title}</span>
                <span className="upnext-place">
                  {event.integration ? (
                    <img
                      src={integrationIcons[event.integration]}
                      alt=""
                      width={14}
                      height={14}
                      draggable={false}
                    />
                  ) : null}
                  <span className="upnext-place-text">{event.place}</span>
                </span>
              </span>
              <span className="upnext-dot" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
