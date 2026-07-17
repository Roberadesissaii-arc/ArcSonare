import { UP_NEXT } from "../../data/demoData";
import { integrationIcons } from "../../config/iconRegistry";
import { addActivity } from "../../stores/appStore";

/** Today's schedule (local demo data — no calendar API exists yet). */
export function UpNextCard() {
  const viewCalendar = () => {
    // No calendar integration exists yet; record the intent locally.
    addActivity("Opened calendar view (connect a calendar to see real events)", "system");
  };

  return (
    <section className="card sonare-card upnext-card">
      <div className="card-head">
        <span className="card-label">Up Next</span>
      </div>
      <ul className="upnext-list">
        {UP_NEXT.map((event, index) => (
          <li key={event.title} className={`upnext-row${index === 0 ? " current" : ""}`}>
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
                {event.place}
              </span>
            </span>
            <span className="upnext-dot" aria-hidden="true" />
          </li>
        ))}
      </ul>
      <button type="button" className="card-footer-link" onClick={viewCalendar}>
        View calendar →
      </button>
    </section>
  );
}
