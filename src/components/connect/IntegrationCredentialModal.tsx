import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { IntegrationInfo } from "../../data/demoData";
import {
  credentialSpecFor,
  integrationSecureKey,
  type IntegrationCredentialField,
} from "../../config/integrationCatalog";
import { integrationIcons, type IntegrationId } from "../../config/iconRegistry";
import {
  allGoogleScopes,
  getGoogleOAuthClientId,
  GOOGLE_INTEGRATION_IDS,
  GOOGLE_SHARED_ACCOUNT_ID,
  isGoogleIntegration,
  type GoogleOAuthConnectResult,
  type GoogleOAuthStatus,
} from "../../config/googleOAuth";
import { patchPrefs } from "../../stores/settingsStore";
import { CloseIcon } from "../Icons";

type ConnectionState = "connected" | "configured";

interface IntegrationCredentialModalProps {
  integration: IntegrationInfo | null;
  state?: ConnectionState;
  onClose: () => void;
  onConnectionChange: (
    ids: readonly IntegrationId[],
    state: ConnectionState | "disconnected",
    message: string,
  ) => void;
}

const GOOGLE_FIELDS: IntegrationCredentialField[] = [
  {
    key: "clientId",
    label: "OAuth Client ID",
    placeholder: "123456789-abc.apps.googleusercontent.com",
  },
  {
    key: "clientSecret",
    label: "Client Secret",
    placeholder: "Optional when using a desktop OAuth client",
    type: "password",
    optional: true,
  },
];

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function IntegrationCredentialModal({
  integration,
  state,
  onClose,
  onConnectionChange,
}: IntegrationCredentialModalProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const google = integration ? isGoogleIntegration(integration.id) : false;
  const spec = useMemo(
    () => (integration ? credentialSpecFor(integration.id) : undefined),
    [integration],
  );
  const fields = google ? GOOGLE_FIELDS : spec?.fields ?? [];
  const supported = google || Boolean(spec);

  useEffect(() => {
    if (!integration) return;
    setBusy(false);
    setError(null);
    setValues(
      google
        ? { clientId: getGoogleOAuthClientId(), clientSecret: "" }
        : {},
    );
    requestAnimationFrame(() => firstFieldRef.current?.focus());
  }, [google, integration]);

  useEffect(() => {
    if (!integration) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, integration, onClose]);

  if (!integration) return null;

  const missingRequired = fields.some(
    (field) => !field.optional && !values[field.key]?.trim(),
  );

  const connect = async () => {
    if (!supported || missingRequired || busy) return;
    setBusy(true);
    setError(null);

    try {
      if (google) {
        const clientId = values.clientId.trim();
        patchPrefs("integrations", { googleOAuthClientId: clientId });
        const clientSecret = values.clientSecret?.trim() ?? "";
        if (clientSecret) {
          await invoke("set_google_oauth_client_secret", {
            secret: clientSecret,
          });
        }

        await invoke<GoogleOAuthConnectResult>("google_oauth_connect", {
          clientId,
          scopes: allGoogleScopes(),
          accountId: GOOGLE_SHARED_ACCOUNT_ID,
          clientSecret: clientSecret || null,
        });
        const status = await invoke<GoogleOAuthStatus>("google_oauth_status");
        if (!status.connected) {
          throw new Error(
            "Google authorization finished, but ArcSonare could not verify the account.",
          );
        }
        onConnectionChange(
          GOOGLE_INTEGRATION_IDS,
          "connected",
          status.email
            ? `Google connected as ${status.email}.`
            : "Google connected and verified.",
        );
        onClose();
        return;
      }

      const key = integrationSecureKey(integration.id);
      const payload = JSON.stringify(
        Object.fromEntries(
          fields.map((field) => [field.key, values[field.key]?.trim() ?? ""]),
        ),
      );
      await invoke("secure_storage_set", { key, value: payload });
      const stored = await invoke<boolean>("secure_storage_has", { key });
      if (!stored) {
        throw new Error(
          "Windows Credential Manager did not confirm the saved credentials.",
        );
      }
      onConnectionChange(
        [integration.id],
        "configured",
        `${integration.name} credentials were saved and confirmed by Windows Credential Manager.`,
      );
      onClose();
    } catch (connectionError) {
      setError(errorMessage(connectionError));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (google) {
        await invoke("google_oauth_disconnect", {
          accountId: GOOGLE_SHARED_ACCOUNT_ID,
        });
        const status = await invoke<GoogleOAuthStatus>("google_oauth_status");
        if (status.connected) {
          throw new Error("Google still reports an active connection.");
        }
        onConnectionChange(
          GOOGLE_INTEGRATION_IDS,
          "disconnected",
          "Google disconnected.",
        );
      } else {
        const key = integrationSecureKey(integration.id);
        await invoke("secure_storage_remove", { key });
        const stored = await invoke<boolean>("secure_storage_has", { key });
        if (stored) {
          throw new Error("The saved credentials could not be removed.");
        }
        onConnectionChange(
          [integration.id],
          "disconnected",
          `${integration.name} credentials removed.`,
        );
      }
      onClose();
    } catch (disconnectError) {
      setError(errorMessage(disconnectError));
    } finally {
      setBusy(false);
    }
  };

  const docsUrl = google
    ? "https://console.cloud.google.com/apis/credentials"
    : spec?.docsUrl;

  return (
    <div
      className="modal-backdrop"
      onPointerDown={busy ? undefined : onClose}
    >
      <div
        className="modal integration-credential-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="integration-credential-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head integration-credential-head">
          <div className="integration-credential-title">
            <span
              className={`integration-credential-icon integration-icon-${integration.id}`}
            >
              <img src={integrationIcons[integration.id]} alt="" />
            </span>
            <div>
              <h2
                className="modal-title"
                id="integration-credential-title"
              >
                {state ? "Manage" : "Connect"} {integration.name}
              </h2>
              <p>
                {google
                  ? "Enter your Google OAuth application credentials. ArcSonare reports connected only after Google confirms authorization."
                  : supported
                    ? "Credentials remain in Windows Credential Manager. ArcSonare confirms secure storage before updating this connector."
                    : "This connector is listed in the directory, but its secure connection flow is not available yet."}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            <CloseIcon size={15} />
          </button>
        </div>

        {state ? (
          <div className="integration-connection-summary">
            <span className="integration-connection-dot" aria-hidden="true" />
            <div>
              <strong>
                {state === "connected"
                  ? "Connection verified"
                  : "Credentials configured"}
              </strong>
              <small>
                {state === "connected"
                  ? "The provider confirmed this account."
                  : "The encrypted credentials are ready for supported actions."}
              </small>
            </div>
          </div>
        ) : null}

        {!state && supported ? (
          <>
            <div className="integration-credential-fields">
              {fields.map((field, index) => {
                const id = `integration-${integration.id}-${field.key}`;
                return (
                  <label className="modal-field" key={field.key} htmlFor={id}>
                    <span className="modal-label">
                      {field.label}
                      {field.optional ? " (optional)" : ""}
                    </span>
                    {field.multiline ? (
                      <textarea
                        id={id}
                        className="modal-input integration-secret-textarea"
                        value={values[field.key] ?? ""}
                        placeholder={field.placeholder}
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(event) => {
                          setValues((current) => ({
                            ...current,
                            [field.key]: event.target.value,
                          }));
                          setError(null);
                        }}
                      />
                    ) : (
                      <input
                        id={id}
                        ref={index === 0 ? firstFieldRef : undefined}
                        className="modal-input"
                        type={field.type ?? "text"}
                        value={values[field.key] ?? ""}
                        placeholder={field.placeholder}
                        autoComplete={
                          field.type === "password"
                            ? "new-password"
                            : "off"
                        }
                        spellCheck={false}
                        onChange={(event) => {
                          setValues((current) => ({
                            ...current,
                            [field.key]: event.target.value,
                          }));
                          setError(null);
                        }}
                      />
                    )}
                  </label>
                );
              })}
            </div>

            {spec?.note ? (
              <p className="integration-credential-note">{spec.note}</p>
            ) : null}

            {docsUrl ? (
              <a
                className="integration-credential-docs"
                href={docsUrl}
                target="_blank"
                rel="noreferrer"
              >
                <span>
                  <strong>Open credential setup guide</strong>
                  <small>Opens the official {integration.name} setup page</small>
                </span>
                <span aria-hidden="true">↗</span>
              </a>
            ) : null}
          </>
        ) : null}

        {!supported ? (
          <div className="integration-coming-soon">
            <strong>Connection setup is coming soon</strong>
            <p>
              ArcSonare will not mark this connector as connected until a
              verifiable provider flow is available.
            </p>
          </div>
        ) : null}

        {error ? (
          <p className="integration-credential-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="modal-actions">
          {state ? (
            <button
              type="button"
              className="btn integration-disconnect-button"
              disabled={busy}
              onClick={() => void disconnect()}
            >
              {busy ? "Disconnecting…" : "Disconnect"}
            </button>
          ) : null}
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            {supported && !state ? "Cancel" : "Close"}
          </button>
          {supported && !state ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || missingRequired}
              onClick={() => void connect()}
            >
              {busy
                ? google
                  ? "Waiting for Google…"
                  : "Verifying…"
                : "Connect"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export type { ConnectionState };
