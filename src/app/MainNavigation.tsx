import { navigate, useAppState, type MainPage } from "../stores/appStore";

const TABS: { id: MainPage; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "tasks", label: "Tasks" },
  { id: "agent", label: "Agent" },
  { id: "connect", label: "Connect" },
];

/** Rounded capsule navigation in the header center. */
export function MainNavigation() {
  const { page } = useAppState();
  return (
    <nav className="main-nav" aria-label="Primary">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`main-nav-tab${tab.id === page ? " active" : ""}`}
          aria-current={tab.id === page ? "page" : undefined}
          onClick={() => navigate(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
