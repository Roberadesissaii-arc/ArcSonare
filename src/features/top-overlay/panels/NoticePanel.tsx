import { emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { NAVIGATE_EVENT } from "../../capabilities/frontendExecutors";
import type { NoticePayload } from "../overlayTypes";

interface NoticePanelProps {
  data: NoticePayload;
  onDismiss: () => void;
}

async function openMainPage(page: "connect" | "settings") {
  if (page === "settings") {
    await invoke("open_settings");
    return;
  }
  await emit(NAVIGATE_EVENT, { page });
  await invoke("show_main_window");
}

export function NoticePanel({ data, onDismiss }: NoticePanelProps) {
  const onPrimary = () => {
    if (!data.navigateTo) {
      onDismiss();
      return;
    }
    void openMainPage(data.navigateTo)
      .catch((err) => console.error("[ArcSonare] notice navigate failed:", err))
      .finally(onDismiss);
  };

  return (
    <div className="overlay-panel notice-panel">
      <p className="panel-heading">{data.title}</p>
      <p className="panel-body">{data.message}</p>
      {data.code ? <p className="panel-note">Code: {data.code}</p> : null}
      <div className="panel-actions">
        <button type="button" className="btn-ghost" onClick={onDismiss}>
          Dismiss
        </button>
        {data.primaryLabel && data.navigateTo ? (
          <button type="button" className="btn-primary" onClick={onPrimary}>
            {data.primaryLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
