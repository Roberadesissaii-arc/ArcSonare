import { useEffect, useState } from "react";
import { SettingsGroup } from "../../components/settings/SettingsGroup";
import { setProfileDisplayName } from "../../stores/appStore";

const PROFILE_KEY = "arcsonare.accountProfile.v1";

export interface AccountProfile {
  fullName: string;
  displayName: string;
  email: string;
  timeZone: string;
  language: string;
  pronunciation: string;
  avatarDataUrl: string;
}

const DEFAULT_PROFILE: AccountProfile = {
  fullName: "Robera",
  displayName: "Robera",
  email: "",
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  language: "English",
  pronunciation: "",
  avatarDataUrl: "",
};

function loadProfile(): AccountProfile {
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (raw) return { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return { ...DEFAULT_PROFILE };
}

function saveProfile(profile: AccountProfile) {
  window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

/** Local profile — no fake cloud account. */
export function AccountSettingsPage() {
  const [profile, setProfile] = useState<AccountProfile>(loadProfile);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setProfileDisplayName(profile.displayName || profile.fullName || "Robera");
    // Only on mount — hydrate greeting from saved profile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = <K extends keyof AccountProfile>(key: K, value: AccountProfile[K]) => {
    setProfile((p) => ({ ...p, [key]: value }));
    setSaved(false);
  };

  const onSave = () => {
    saveProfile(profile);
    setProfileDisplayName(profile.displayName || profile.fullName || "Robera");
    setSaved(true);
  };

  const onAvatar = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => update("avatarDataUrl", String(reader.result || ""));
    reader.readAsDataURL(file);
  };

  const deleteLocal = () => {
    window.localStorage.removeItem(PROFILE_KEY);
    const reset = { ...DEFAULT_PROFILE };
    setProfile(reset);
    setProfileDisplayName("Robera");
    setConfirmDelete(false);
    setSaved(false);
  };

  return (
    <div className="settings-section">
      <header className="settings-section-head">
        <h1>Account</h1>
        <p>Manage your local ArcSonare profile. No cloud account is required.</p>
      </header>

      <SettingsGroup title="Local profile">
        <div className="account-avatar-row">
          <div className="account-avatar" aria-hidden="true">
            {profile.avatarDataUrl ? (
              <img src={profile.avatarDataUrl} alt="" />
            ) : (
              <span>{(profile.displayName || "A").slice(0, 1).toUpperCase()}</span>
            )}
          </div>
          <label className="btn-pill account-avatar-btn">
            Change profile picture
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => onAvatar(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>

        <label className="settings-field">
          <span>Full name</span>
          <input value={profile.fullName} onChange={(e) => update("fullName", e.target.value)} />
        </label>
        <label className="settings-field">
          <span>Display name</span>
          <input
            value={profile.displayName}
            onChange={(e) => update("displayName", e.target.value)}
          />
        </label>
        <label className="settings-field">
          <span>Email address</span>
          <input
            type="email"
            value={profile.email}
            onChange={(e) => update("email", e.target.value)}
            placeholder="Optional"
          />
        </label>
        <label className="settings-field">
          <span>Time zone</span>
          <input value={profile.timeZone} onChange={(e) => update("timeZone", e.target.value)} />
        </label>
        <label className="settings-field">
          <span>Preferred language</span>
          <input value={profile.language} onChange={(e) => update("language", e.target.value)} />
        </label>
        <label className="settings-field">
          <span>Pronunciation of name</span>
          <input
            value={profile.pronunciation}
            onChange={(e) => update("pronunciation", e.target.value)}
            placeholder="Optional"
          />
        </label>
        <div className="card-actions">
          <button type="button" className="btn-pill" onClick={onSave}>
            Save changes
          </button>
          {saved ? <span className="card-text">Saved</span> : null}
        </div>
      </SettingsGroup>

      <SettingsGroup title="Account status">
        <p className="card-text">ArcSonare is currently using a local profile.</p>
        <p className="card-text">Cloud-account connection: Not available</p>
        <p className="card-text">Sync status: Local only</p>
      </SettingsGroup>

      <SettingsGroup title="Data controls">
        <button
          type="button"
          className="text-action"
          onClick={() => {
            const blob = new Blob([JSON.stringify(profile, null, 2)], {
              type: "application/json",
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "arcsonare-profile.json";
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Export profile
        </button>
        {!confirmDelete ? (
          <button type="button" className="text-action" onClick={() => setConfirmDelete(true)}>
            Delete local profile data
          </button>
        ) : (
          <div className="card-actions">
            <button type="button" className="btn-pill" onClick={deleteLocal}>
              Confirm delete
            </button>
            <button type="button" className="text-action" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </div>
        )}
      </SettingsGroup>
    </div>
  );
}
