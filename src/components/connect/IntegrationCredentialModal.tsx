import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { IntegrationInfo } from "../../data/demoData";
import {
  capabilitiesFor,
  credentialSpecFor,
  integrationSecureKey,
  type IntegrationCredentialField,
} from "../../config/integrationCatalog";
import {
  FRAMED_INTEGRATION_IDS,
  integrationIcons,
  type IntegrationId,
} from "../../config/iconRegistry";
import {
  allGoogleScopes,
  getGoogleOAuthClientId,
  GOOGLE_INTEGRATION_IDS,
  GOOGLE_SHARED_ACCOUNT_ID,
  isGoogleIntegration,
  type GoogleAccountSummary,
  type GoogleOAuthConnectResult,
  type GoogleOAuthStatus,
} from "../../config/googleOAuth";
import { patchPrefs } from "../../stores/settingsStore";
import { Plus, Trash2, X } from "lucide-react";

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
  const [googleAccounts, setGoogleAccounts] = useState<GoogleAccountSummary[]>([]);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const google = integration ? isGoogleIntegration(integration.id) : false;
  const spec = useMemo(
    () => (integration ? credentialSpecFor(integration.id) : undefined),
    [integration],
  );
  const fields = google ? GOOGLE_FIELDS : spec?.fields ?? [];
  const supported = google || Boolean(spec);
  const capabilities = useMemo(
    () => (integration ? capabilitiesFor(integration.id) : []),
    [integration],
  );

  useEffect(() => {
    if (!integration) return;
    setBusy(false);
    setError(null);
    setShowAddAccount(false);
    setValues(
      google
        ? { clientId: getGoogleOAuthClientId(), clientSecret: "" }
        : {},
    );
    requestAnimationFrame(() => firstFieldRef.current?.focus());
  }, [google, integration]);

  useEffect(() => {
    if (!integration || !google) {
      setGoogleAccounts([]);
      return;
    }
    let cancelled = false;
    invoke<GoogleAccountSummary[]>("google_oauth_list_accounts")
      .then((accounts) => {
        if (!cancelled) setGoogleAccounts(accounts);
      })
      .catch((listError) => {
        console.error("[connect] failed to list Google accounts", listError);
      });
    return () => {
      cancelled = true;
    };
  }, [google, integration]);

  const refreshGoogleAccounts = async () => {
    try {
      const accounts = await invoke<GoogleAccountSummary[]>(
        "google_oauth_list_accounts",
      );
      setGoogleAccounts(accounts);
      return accounts;
    } catch (listError) {
      console.error("[connect] failed to list Google accounts", listError);
      return googleAccounts;
    }
  };

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

  const connect = async (opts?: { addAccount?: boolean }) => {
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

        const result = await invoke<GoogleOAuthConnectResult>(
          "google_oauth_connect",
          {
            clientId,
            scopes: allGoogleScopes(),
            accountId: GOOGLE_SHARED_ACCOUNT_ID,
            clientSecret: clientSecret || null,
          },
        );
        const status = await invoke<GoogleOAuthStatus>("google_oauth_status");
        if (!status.connected) {
          throw new Error(
            "Google authorization finished, but ArcSonare could not verify the account.",
          );
        }
        await refreshGoogleAccounts();
        onConnectionChange(
          GOOGLE_INTEGRATION_IDS,
          "connected",
          result.email
            ? opts?.addAccount
              ? `Added ${result.email} to your connected Google accounts.`
              : `Google connected as ${result.email}.`
            : "Google connected and verified.",
        );
        if (opts?.addAccount) {
          setShowAddAccount(false);
          setValues({ clientId: getGoogleOAuthClientId(), clientSecret: "" });
        } else {
          onClose();
        }
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
        const accounts =
          googleAccounts.length > 0
            ? googleAccounts
            : [{ accountId: GOOGLE_SHARED_ACCOUNT_ID, active: true }];
        for (const account of accounts) {
          await invoke("google_oauth_disconnect", {
            accountId: account.accountId,
          });
        }
        const status = await invoke<GoogleOAuthStatus>("google_oauth_status");
        if (status.connected) {
          throw new Error("Google still reports an active connection.");
        }
        setGoogleAccounts([]);
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

  const removeGoogleAccount = async (accountId: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await invoke("google_oauth_disconnect", { accountId });
      await refreshGoogleAccounts();
      const status = await invoke<GoogleOAuthStatus>("google_oauth_status");
      onConnectionChange(
        GOOGLE_INTEGRATION_IDS,
        status.connected ? "connected" : "disconnected",
        status.connected
          ? "Google account removed."
          : "Google disconnected.",
      );
    } catch (removeError) {
      setError(errorMessage(removeError));
    } finally {
      setBusy(false);
    }
  };

  const switchGoogleAccount = async (accountId: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await invoke("google_oauth_set_active_account", { accountId });
      await refreshGoogleAccounts();
    } catch (switchError) {
      setError(errorMessage(switchError));
    } finally {
      setBusy(false);
    }
  };

  const docsUrl = google
    ? "https://console.cloud.google.com/apis/credentials"
    : spec?.docsUrl;

  const isAddingGoogleAccount = Boolean(state && google && showAddAccount);
  const showCredentialForm = (!state && supported) || isAddingGoogleAccount;

  return (
    <div
      className="modal-backdrop"
      onPointerDown={busy ? undefined : onClose}
    >
      <div
        className={`modal integration-credential-modal${
          google && state ? " has-account-manager" : ""
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="integration-credential-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head integration-credential-head">
          <div className="integration-credential-title">
            <span
              className={`integration-credential-icon integration-icon-${integration.id}${
                FRAMED_INTEGRATION_IDS.has(integration.id) ? " is-framed" : ""
              }`}
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
            <X size={17} />
          </button>
        </div>

        {capabilities.length > 0 ? (
          <div className="integration-credential-capabilities">
            <span className="integration-credential-capabilities-label">
              What this connects
            </span>
            <div className="integration-credential-capabilities-grid">
              {capabilities.map((capability) => (
                <div
                  className="integration-credential-capability"
                  key={capability}
                >
                  <span
                    className="integration-credential-capability-dot"
                    aria-hidden="true"
                  />
                  {capability}
                </div>
              ))}
            </div>
          </div>
        ) : null}

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

        {state && google ? (
          <div className="integration-google-accounts">
            <div className="integration-google-accounts-head">
              <span className="integration-credential-capabilities-label">
                Connected accounts
              </span>
              <button
                type="button"
                className="integration-add-account-button"
                disabled={busy || showAddAccount}
                onClick={() => setShowAddAccount(true)}
              >
                <Plus size={13} />
                Add account
              </button>
            </div>
            <div className="integration-google-accounts-list">
              {googleAccounts.map((account) => (
                <div
                  className={`integration-google-account${
                    account.active ? " is-active" : ""
                  }`}
                  key={account.accountId}
                >
                  <div className="integration-google-account-info">
                    <span className="integration-google-account-email">
                      {account.email ?? "Google account"}
                    </span>
                    {account.active ? (
                      <span className="integration-google-account-badge">
                        Active
                      </span>
                    ) : null}
                  </div>
                  <div className="integration-google-account-actions">
                    {!account.active ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void switchGoogleAccount(account.accountId)}
                      >
                        Use
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Remove ${account.email ?? "this account"}`}
                      onClick={() => void removeGoogleAccount(account.accountId)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {showCredentialForm ? (
          <>
            {isAddingGoogleAccount ? (
              <p className="integration-credential-add-account-hint">
                Sign in with a different Google account. Existing accounts
                stay connected.
              </p>
            ) : null}
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
              <button
                type="button"
                className="integration-credential-docs"
                onClick={() => {
                  void invoke("overlay_open_url", { url: docsUrl }).catch(
                    (openError) => setError(errorMessage(openError)),
                  );
                }}
              >
                <span>
                  <strong>Open credential setup guide</strong>
                  <small>Opens the official {integration.name} setup page</small>
                </span>
                <span aria-hidden="true">↗</span>
              </button>
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
          {state && !isAddingGoogleAccount ? (
            <button
              type="button"
              className="btn integration-disconnect-button"
              disabled={busy}
              onClick={() => void disconnect()}
            >
              {busy ? "Disconnecting…" : "Disconnect"}
            </button>
          ) : null}
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              if (isAddingGoogleAccount) {
                setShowAddAccount(false);
                setError(null);
                return;
              }
              onClose();
            }}
          >
            {showCredentialForm ? "Cancel" : "Close"}
          </button>
          {showCredentialForm ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || missingRequired}
              onClick={() => void connect({ addAccount: isAddingGoogleAccount })}
            >
              {busy
                ? google
                  ? "Waiting for Google…"
                  : "Verifying…"
                : isAddingGoogleAccount
                  ? "Add account"
                  : "Connect"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export type { ConnectionState };
