import { useRef, useState } from "react";
import { ArrowUpRightIcon, CheckIcon } from "../Icons";
import {
  loadAccountProfile,
  profileInitials,
  saveAccountProfile,
  type AccountProfile,
} from "../../features/account/accountProfile";
import { ProfilePhotoEditor } from "./ProfilePhotoEditor";

interface ProfileCardProps {
  profile: AccountProfile;
  onChange: (next: AccountProfile) => void;
  onManage?: () => void;
  /** Open the create-account flow. */
  onSignIn?: () => void;
  /** Log out of the local account (always visible when signed in). */
  onLogout?: () => void;
  logoutBusy?: boolean;
  /** When true, this device has a local account signed in. */
  cloudSignedIn?: boolean;
}

/** Wide profile card for the Account overview. */
export function ProfileCard({
  profile,
  onChange,
  onManage,
  onSignIn,
  onLogout,
  logoutBusy = false,
  cloudSignedIn = false,
}: ProfileCardProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const name =
    profile.fullName.trim() ||
    profile.displayName.trim() ||
    (cloudSignedIn ? "ArcSonare account" : "Your profile");
  const initials = profileInitials(profile);

  const applyAvatar = (dataUrl: string) => {
    const next = { ...profile, avatarDataUrl: dataUrl };
    onChange(next);
    saveAccountProfile(next);
    setEditorOpen(false);
  };

  return (
    <>
      <section className="profile-card">
        <div className="profile-card-shine" aria-hidden="true" />
        <div className="profile-card-main">
          <div className="profile-avatar-wrap">
            <button
              type="button"
              className="profile-avatar"
              onClick={() => setEditorOpen(true)}
              aria-label="Change profile photo"
            >
              {profile.avatarDataUrl ? (
                <img src={profile.avatarDataUrl} alt="" />
              ) : (
                <span>{initials}</span>
              )}
            </button>
            <button
              type="button"
              className="profile-avatar-edit"
              onClick={() => setEditorOpen(true)}
              aria-label="Edit profile photo"
              title="Edit profile photo"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="12" cy="13" r="4" stroke="currentColor" strokeWidth="1.7" />
              </svg>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => applyAvatar(String(reader.result || ""));
                reader.readAsDataURL(file);
                e.target.value = "";
              }}
            />
          </div>

          <div className="profile-card-meta">
            <div className="profile-name-row">
              <h2 className="profile-name">{name}</h2>
              <span className="profile-local-badge">
                {cloudSignedIn ? "Local account" : "Not signed in"}
                <CheckIcon size={11} />
              </span>
            </div>
            <p className="profile-status">
              {cloudSignedIn
                ? "Signed in on this device. Nothing leaves this computer."
                : "This device has no account yet."}
            </p>
          </div>
        </div>

        <div className="profile-card-actions">
          {!cloudSignedIn && onSignIn ? (
            <button
              type="button"
              className="profile-manage-btn profile-signin-btn"
              onClick={() => onSignIn()}
              aria-label="Create a local account"
            >
              Create account
              <ArrowUpRightIcon size={14} />
            </button>
          ) : null}
          {cloudSignedIn && onLogout ? (
            <button
              type="button"
              className="profile-manage-btn profile-logout-btn"
              onClick={() => onLogout()}
              disabled={logoutBusy}
              aria-label="Log out"
            >
              {logoutBusy ? "Logging out…" : "Log out"}
            </button>
          ) : null}
          <button
            type="button"
            className="profile-manage-btn"
            onClick={() => onManage?.()}
            aria-label="Manage account"
          >
            Manage
            <ArrowUpRightIcon size={14} />
          </button>
        </div>
      </section>

      {editorOpen ? (
        <ProfilePhotoEditor
          currentUrl={profile.avatarDataUrl}
          initials={initials}
          onClose={() => setEditorOpen(false)}
          onChooseFile={() => fileRef.current?.click()}
          onRemove={() => applyAvatar("")}
          onUseInitials={() => applyAvatar("")}
        />
      ) : null}
    </>
  );
}

/** Convenience loader used by Account page. */
export function useLoadedProfile(): AccountProfile {
  return loadAccountProfile();
}
