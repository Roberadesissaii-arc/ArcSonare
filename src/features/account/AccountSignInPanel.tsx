import { useState, type FormEvent } from "react";
import { createLocalAccount } from "../../auth/authService";

interface AccountSignInPanelProps {
  onClose: () => void;
  onSignedIn: () => void;
}

/** Create a local account without resetting the whole app to first-run welcome. */
export function AccountSignInPanel({ onClose, onSignedIn }: AccountSignInPanelProps) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await createLocalAccount(name, username, password);
      onSignedIn();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="account-signin-backdrop" role="presentation" onClick={onClose}>
      <div
        className="account-signin-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Create account"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="account-signin-head">
          <h2>Create account</h2>
          <p>A local account keeps your tasks and settings on this device.</p>
        </header>

        <form className="account-signin-form" onSubmit={(e) => void submit(e)}>
          <label>
            <span>Your name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
              autoFocus
            />
          </label>

          <label>
            <span>Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
            />
          </label>

          <label>
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
          </label>

          {message ? (
            <p className="field-error" role="alert">
              {message}
            </p>
          ) : null}

          <div className="account-signin-actions">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Working…" : "Create account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
