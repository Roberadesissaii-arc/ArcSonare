import { useState, type FormEvent } from "react";
import { ArcSonareLogo } from "../components/brand/ArcSonareLogo";
import { ArrowRightIcon } from "../components/Icons";
import { OrbitalCommandMap } from "../components/dashboard/OrbitalCommandMap";
import {
  createLocalAccount,
  signInWithUsername,
  unlockWithPassword,
} from "../auth/authService";
import { completeOnboarding } from "../auth/completeOnboarding";
import { useAuthStore } from "../auth/authStore";
import { loadAccountProfile } from "../features/account/accountProfile";
import { loadLocalAccount } from "../auth/localAccount";

export function AuthWelcomePage({ onComplete }: { onComplete?: () => void }) {
  const auth = useAuthStore();
  const locked = auth.state === "locked";
  const needsSignIn = auth.state === "needs-sign-in";

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [profile] = useState(loadAccountProfile);
  const [knownAccount] = useState(loadLocalAccount);

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setMessage("Passwords don't match.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await createLocalAccount(name, username, password);
      completeOnboarding({ unlockOverlay: true });
      onComplete?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function submitUnlock(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await unlockWithPassword(password);
      onComplete?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Something went wrong.");
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  async function submitSignIn(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await signInWithUsername(knownAccount?.username ?? "", password);
      onComplete?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Something went wrong.");
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  const lockStyle = locked || needsSignIn;

  return (
    <main
      className={`auth-welcome ${lockStyle ? "auth-welcome-locked" : "auth-welcome-setup"}`}
    >
      <div className="auth-orbital" aria-hidden="true">
        <OrbitalCommandMap />
      </div>

      <div className={`auth-panel${lockStyle ? " auth-panel-locked" : ""}`}>
        <div className="auth-avatar auth-avatar-circle">
          {locked && profile.avatarDataUrl ? (
            <img src={profile.avatarDataUrl} alt="" />
          ) : (
            <ArcSonareLogo size={lockStyle ? 48 : 56} title="ArcSonare" />
          )}
        </div>

        {lockStyle ? (
          <>
            <header className="auth-lock-identity">
              <h1>
                {needsSignIn
                  ? profile.fullName.trim() ||
                    profile.displayName.trim() ||
                    knownAccount?.displayName ||
                    "Sign in"
                  : auth.user?.displayName ||
                    profile.displayName ||
                    profile.fullName ||
                    "Welcome back"}
              </h1>
            </header>

            <form
              className="auth-unlock-form"
              onSubmit={(e) => void (needsSignIn ? submitSignIn(e) : submitUnlock(e))}
            >
              <label className="auth-lock-password">
                <span className="sr-only">Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={busy ? "Signing in…" : "Enter Password"}
                  autoComplete="current-password"
                  autoFocus
                  required
                  disabled={busy}
                />
                <button
                  type="submit"
                  aria-label="Sign in to ArcSonare"
                  title="Sign in"
                  disabled={busy}
                >
                  <ArrowRightIcon size={13} />
                </button>
              </label>

              {message ? (
                <p className="auth-lock-message" role="alert">
                  {message}
                </p>
              ) : (
                <p className="auth-lock-hint">
                  Your password is required to log in.
                </p>
              )}
            </form>
          </>
        ) : (
          <>
            <header className="auth-card-head">
              <h2>Create your account</h2>
              <p>Your private ArcSonare workspace starts on this device.</p>
            </header>

            <form className="auth-form" onSubmit={(e) => void submitCreate(e)}>
              <div className="auth-form-row">
                <div className="auth-field">
                  <label className="auth-field-label" htmlFor="auth-full-name">
                    Full name
                  </label>
                  <label className="auth-input" htmlFor="auth-full-name">
                    <PersonGlyph />
                    <input
                      id="auth-full-name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your full name"
                      autoComplete="name"
                      autoFocus
                      required
                    />
                  </label>
                </div>

                <div className="auth-field">
                  <label className="auth-field-label" htmlFor="auth-username">
                    Username
                  </label>
                  <label className="auth-input" htmlFor="auth-username">
                    <PersonGlyph />
                    <input
                      id="auth-username"
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="Choose a username"
                      autoComplete="username"
                      required
                    />
                  </label>
                </div>
              </div>

              <div className="auth-form-row">
                <div className="auth-field">
                  <label className="auth-field-label" htmlFor="auth-password">
                    Password
                  </label>
                  <label className="auth-input" htmlFor="auth-password">
                    <PasswordGlyph />
                    <input
                      id="auth-password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 4 characters"
                      autoComplete="new-password"
                      required
                    />
                  </label>
                </div>

                <div className="auth-field">
                  <label
                    className="auth-field-label"
                    htmlFor="auth-confirm-password"
                  >
                    Confirm password
                  </label>
                  <label
                    className="auth-input"
                    htmlFor="auth-confirm-password"
                  >
                    <PasswordGlyph />
                    <input
                      id="auth-confirm-password"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repeat password"
                      autoComplete="new-password"
                      required
                    />
                  </label>
                </div>
              </div>

              <button className="auth-submit" type="submit" disabled={busy}>
                {busy ? "Please wait…" : "Create Account"}
                <ArrowRightIcon size={15} />
              </button>

              {message ? (
                <p className="auth-message auth-message-error" role="alert">
                  {message}
                </p>
              ) : null}
            </form>

            <p className="auth-legal">
              Local account only — your credentials stay on this device.
            </p>
          </>
        )}
      </div>
    </main>
  );
}

function PersonGlyph() {
  return (
    <svg className="auth-glyph" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="7" r="3.2" />
      <path d="M4.2 16.2c1.4-2.4 3.4-3.6 5.8-3.6s4.4 1.2 5.8 3.6" />
    </svg>
  );
}

function PasswordGlyph() {
  return (
    <svg className="auth-glyph" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="4.5" y="9" width="11" height="7.5" rx="1.8" />
      <path d="M6.5 9V6.3a3.5 3.5 0 0 1 7 0V9" />
    </svg>
  );
}
