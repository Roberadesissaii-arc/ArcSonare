import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ConnectGrid } from "../../components/connect/ConnectGrid";
import { SettingsGroup } from "../../components/settings/SettingsGroup";
import { hasGoogleOAuthClientId } from "../../config/googleOAuth";
import { patchPrefs, usePrefs } from "../../stores/settingsStore";

/** Integration management inside Settings (same grid as the Connect page). */
export function IntegrationsSettingsPage() {
  const prefs = usePrefs();
  const [draft, setDraft] = useState(prefs.integrations.googleOAuthClientId);
  const [secretDraft, setSecretDraft] = useState("");
  const [hasSecret, setHasSecret] = useState(false);
  const [secretNotice, setSecretNotice] = useState<string | null>(null);
  const ready = hasGoogleOAuthClientId();

  useEffect(() => {
    void invoke<boolean>("has_google_oauth_client_secret")
      .then(setHasSecret)
      .catch(() => setHasSecret(false));
  }, []);

  const saveSecret = async () => {
    setSecretNotice(null);
    try {
      await invoke("set_google_oauth_client_secret", {
        secret: secretDraft.trim(),
      });
      setHasSecret(secretDraft.trim().length > 0);
      setSecretDraft("");
      setSecretNotice(
        secretDraft.trim()
          ? "Client Secret saved in Windows Credential Manager."
          : "Client Secret cleared.",
      );
    } catch (err) {
      setSecretNotice(
        err instanceof Error ? err.message : "Could not save Client Secret.",
      );
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">Integrations</h1>
        <p className="page-subtitle">
          Connect your tools to ArcSonare. The Google Client ID identifies this
          app — each person still signs in with their own Gmail.
        </p>
      </header>

      <SettingsGroup
        title="Google OAuth"
        description="From Google Cloud Console → APIs & Services → Credentials. Authorized redirect URI must be exactly http://127.0.0.1:8765/oauth/google. If the consent screen is in Testing, add every Gmail you want to use under Test users."
      >
        <label className="settings-field">
          <span>Client ID</span>
          <input
            type="text"
            value={draft}
            placeholder="123456789-abc.apps.googleusercontent.com"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() =>
              patchPrefs("integrations", {
                googleOAuthClientId: draft.trim(),
              })
            }
          />
        </label>
        <label className="settings-field" style={{ marginTop: 12 }}>
          <span>
            Client Secret{" "}
            {hasSecret ? "(saved)" : "(needed for Web client type)"}
          </span>
          <input
            type="password"
            value={secretDraft}
            placeholder={
              hasSecret
                ? "••••••••  (leave blank to keep, or type new / clear)"
                : "Paste Client Secret if using a Web application OAuth client"
            }
            spellCheck={false}
            autoComplete="new-password"
            onChange={(e) => setSecretDraft(e.target.value)}
          />
        </label>
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-small btn-primary" onClick={() => void saveSecret()}>
            Save Client Secret
          </button>
          {hasSecret ? (
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                setSecretDraft("");
                void invoke("set_google_oauth_client_secret", { secret: "" }).then(
                  () => {
                    setHasSecret(false);
                    setSecretNotice("Client Secret cleared.");
                  },
                );
              }}
            >
              Clear Secret
            </button>
          ) : null}
        </div>
        <p className="page-subtitle" style={{ marginTop: 8, marginBottom: 0 }}>
          {ready
            ? "Client ID is set. Connect opens a Google account picker — any Gmail can sign in (if allowed on the consent screen)."
            : "No Client ID yet — Google Connect buttons stay disabled."}
        </p>
        {secretNotice ? (
          <p className="page-subtitle" style={{ marginTop: 6, marginBottom: 0 }} role="status">
            {secretNotice}
          </p>
        ) : null}
      </SettingsGroup>

      <div className="settings-connect">
        <ConnectGrid />
      </div>
    </div>
  );
}
