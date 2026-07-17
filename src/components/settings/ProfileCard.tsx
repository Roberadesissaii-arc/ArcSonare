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
}

/** Wide local-profile card for the Account overview. */
export function ProfileCard({ profile, onChange, onManage }: ProfileCardProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const name = profile.fullName || profile.displayName || "Local user";
  const email = profile.email || "No email on this device";
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
                Local Profile
                <CheckIcon size={11} />
              </span>
            </div>
            <p className="profile-email">{email}</p>
            <p className="profile-status">Signed in locally on this device</p>
          </div>
        </div>

        <button
          type="button"
          className="profile-manage-btn"
          onClick={() => onManage?.()}
          aria-label="Manage account"
        >
          Manage Account
          <ArrowUpRightIcon size={14} />
        </button>
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
