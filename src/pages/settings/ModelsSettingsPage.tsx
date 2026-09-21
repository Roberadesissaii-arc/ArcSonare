/**
 * Legacy Models settings page (not linked from Settings nav).
 * Chat uses DeepSeek; voice uses OpenAI Realtime — both configured under Voice & AI keys.
 */
import { SettingsPageHeader } from "../../components/settings/SettingsPageHeader";
import { navigateSettings } from "../../stores/appStore";

export function ModelsSettingsPage() {
  return (
    <div className="settings-section models-settings">
      <SettingsPageHeader
        title="Models"
        description="Chat and voice models are configured under Voice & AI keys. DeepSeek powers chat; OpenAI powers the voice overlay."
      />
      <div className="card sonare-card" style={{ padding: "1.25rem" }}>
        <p style={{ margin: 0, opacity: 0.9 }}>
          Ollama and local model mode have been removed from ArcSonare.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          style={{ marginTop: "1rem" }}
          onClick={() => navigateSettings("voice")}
        >
          Open Voice &amp; AI keys
        </button>
      </div>
    </div>
  );
}
