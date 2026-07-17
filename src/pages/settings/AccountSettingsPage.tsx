import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SettingsPageHeader } from "../../components/settings/SettingsPageHeader";
import { SettingsCard } from "../../components/settings/SettingsCard";
import { SettingRow } from "../../components/settings/SettingRow";
import { Toggle } from "../../components/settings/Toggle";
import { Dropdown } from "../../components/settings/Dropdown";
import { SegmentedControl } from "../../components/settings/SegmentedControl";
import { ShortcutDisplay } from "../../components/settings/ShortcutDisplay";
import { ColorPicker } from "../../components/settings/ColorPicker";
import { ProfileCard } from "../../components/settings/ProfileCard";
import { SettingsStatus } from "../../components/settings/SettingsStatus";
import { useSettings } from "../../hooks/useSettings";
import { patchPrefs, usePrefs } from "../../stores/settingsStore";
import {
  clearAccountProfile,
  loadAccountProfile,
  saveAccountProfile,
  type AccountProfile,
} from "../../features/account/accountProfile";
import { navigateSettings } from "../../stores/appStore";
import { modelById } from "../../config/modelRegistry";
import type { ThemePreference } from "../../types";

/**
 * Account overview — profile card + equal-height two-column summary cards.
 * Detailed edits live in the expandable Manage panel and other sections.
 */
export function AccountSettingsPage() {
  const { settings, update } = useSettings();
  const prefs = usePrefs();
  const [profile, setProfile] = useState<AccountProfile>(loadAccountProfile);
  const [managing, setManaging] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [startupBusy, setStartupBusy] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);

  useEffect(() => {
    saveAccountProfile(profile);
  }, []);

  const updateProfile = <K extends keyof AccountProfile>(key: K, value: AccountProfile[K]) => {
    setProfile((p) => ({ ...p, [key]: value }));
    setSaved(null);
  };

  const onSaveProfile = () => {
    saveAccountProfile(profile);
    setSaved("Saved");
    window.setTimeout(() => setSaved(null), 1800);
  };

  const setAutostart = (enabled: boolean) => {
    setStartupBusy(true);
    setStartupError(null);
    invoke("set_autostart", { enabled })
      .catch((err) =>
        setStartupError(
          typeof err === "string" ? err : "The startup setting could not be changed.",
        ),
      )
      .finally(() => setStartupBusy(false));
  };

  const assistantId = prefs.models.roles.assistant;
  const assistantModel = assistantId ? modelById(assistantId) : null;
  const modelOptions = [
    { value: "", label: "Not configured" },
    ...(assistantModel
      ? [{ value: assistantModel.id, label: assistantModel.displayName }]
      : []),
  ];

  const speakingSpeed =
    prefs.voice.speakingSpeed <= 85
      ? "slow"
      : prefs.voice.speakingSpeed >= 120
        ? "fast"
        : "normal";

  const setSpeed = (value: "slow" | "normal" | "fast") => {
    const speakingSpeed = value === "slow" ? 80 : value === "fast" ? 130 : 100;
    patchPrefs("voice", { speakingSpeed });
  };

  const accentValue =
    prefs.appearance.accent === "monochrome"
      ? "violet"
      : (prefs.appearance as { accentColor?: string }).accentColor ?? "violet";

  const setAccentSwatch = (id: string) => {
    if (id === "violet") {
      patchPrefs("appearance", { accent: "violet", accentColor: "violet" } as never);
    } else {
      patchPrefs("appearance", { accent: "violet", accentColor: id } as never);
    }
  };

  const fontSize =
    prefs.appearance.textScale <= 90
      ? "small"
      : prefs.appearance.textScale >= 115
        ? "large"
        : "medium";

  const setFontSize = (value: "small" | "medium" | "large") => {
    const textScale = value === "small" ? 90 : value === "large" ? 120 : 100;
    patchPrefs("appearance", { textScale });
  };

  return (
    <div className="settings-section account-overview">
      <SettingsPageHeader
        title="Settings"
        description="Personalize your ArcSonare experience and manage your preferences."
      />

      <div
        onClick={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest("[data-manage]")) {
            e.preventDefault();
            setManaging(true);
          }
        }}
      >
        <ProfileCard
          profile={profile}
          onChange={(next) => {
            setProfile(next);
            saveAccountProfile(next);
          }}
        />
      </div>

      <div className="settings-card-grid">
        <SettingsCard title="Application" description="Core behavior and startup options.">
          <SettingRow
            label="Start ArcSonare on Windows sign-in"
            description="Registers ArcSonare with Windows startup."
          >
            <Toggle
              checked={settings?.launchAtStartup ?? false}
              onChange={setAutostart}
              label="Start ArcSonare on Windows sign-in"
              disabled={startupBusy}
            />
          </SettingRow>
          {startupError ? (
            <p className="field-error" role="alert">
              {startupError}
            </p>
          ) : null}
          <SettingRow
            label="Global shortcut"
            description="Opens the voice overlay from anywhere."
          >
            <ShortcutDisplay
              shortcut={settings?.globalShortcut}
              onEdit={() => navigateSettings("shortcuts")}
              ariaLabel="Edit global shortcut"
            />
          </SettingRow>
          <SettingRow
            label="Minimize to system tray"
            description="Keep ArcSonare running when the window closes."
          >
            <Toggle
              checked={prefs.general.keepRunningOnClose}
              onChange={(keepRunningOnClose) =>
                patchPrefs("general", { keepRunningOnClose })
              }
              label="Minimize to system tray"
            />
          </SettingRow>
          <SettingRow label="Language" description="Interface language.">
            <Dropdown
              options={[{ value: "en-US", label: "English (United States)" }]}
              value={prefs.general.interfaceLanguage}
              onChange={(interfaceLanguage) =>
                patchPrefs("general", { interfaceLanguage })
              }
              ariaLabel="Language"
            />
          </SettingRow>
          <div className="settings-card-footer">
            <button
              type="button"
              className="settings-card-link"
              onClick={() => navigateSettings("general")}
            >
              Open General →
            </button>
          </div>
        </SettingsCard>

        <SettingsCard title="Voice" description="Configure voice input and responses.">
          <SettingRow
            label="Voice input"
            description={
              prefs.voice.inputDeviceId === "default"
                ? "System default microphone"
                : "Selected input device"
            }
          >
            <button
              type="button"
              className="btn btn-small"
              onClick={() => navigateSettings("voice")}
            >
              Devices
            </button>
          </SettingRow>
          <SettingRow
            label="Voice"
            description={
              prefs.voice.voiceId
                ? "Provider voice selected"
                : "No speech provider configured"
            }
          >
            <button
              type="button"
              className="btn btn-small"
              onClick={() => navigateSettings("voice")}
              disabled={!prefs.voice.voiceId}
              title={
                prefs.voice.voiceId
                  ? "Open voice settings"
                  : "Configure a speech provider first"
              }
            >
              Preview
            </button>
          </SettingRow>
          <SettingRow label="Voice response speed">
            <SegmentedControl
              options={[
                { value: "slow", label: "Slow" },
                { value: "normal", label: "Normal" },
                { value: "fast", label: "Fast" },
              ]}
              value={speakingSpeed}
              onChange={setSpeed}
              ariaLabel="Voice response speed"
            />
          </SettingRow>
          <SettingRow
            label="Auto-voice responses"
            description="Speak replies when a voice turn completes."
          >
            <Toggle
              checked={!prefs.voice.muteResponses}
              onChange={(on) => patchPrefs("voice", { muteResponses: !on })}
              label="Auto-voice responses"
            />
          </SettingRow>
          <div className="settings-card-footer">
            <button
              type="button"
              className="settings-card-link"
              onClick={() => navigateSettings("voice")}
            >
              Open Voice →
            </button>
          </div>
        </SettingsCard>

        <SettingsCard title="Appearance" description="Customize how ArcSonare looks.">
          <SettingRow label="Theme">
            <SegmentedControl<ThemePreference>
              options={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
                { value: "system", label: "System" },
              ]}
              value={settings?.theme ?? "dark"}
              onChange={(theme) => update({ theme })}
              ariaLabel="Theme"
            />
          </SettingRow>
          <SettingRow label="Accent color" description="Highlights and active controls.">
            <ColorPicker value={accentValue} onChange={setAccentSwatch} />
          </SettingRow>
          <SettingRow label="Font size">
            <SegmentedControl
              options={[
                { value: "small", label: "Small" },
                { value: "medium", label: "Medium" },
                { value: "large", label: "Large" },
              ]}
              value={fontSize}
              onChange={setFontSize}
              ariaLabel="Font size"
            />
          </SettingRow>
          <div className="settings-card-footer">
            <button
              type="button"
              className="settings-card-link"
              onClick={() => navigateSettings("appearance")}
            >
              Open Appearance →
            </button>
          </div>
        </SettingsCard>

        <SettingsCard title="Model" description="Select the model ArcSonare should use by default.">
          <SettingRow
            label="Default model"
            description={
              assistantModel
                ? `${assistantModel.displayName} · ${assistantModel.locality === "local" ? "Local" : "Cloud"}`
                : "No default model configured"
            }
          >
            <Dropdown
              options={modelOptions}
              value={assistantModel?.id ?? ""}
              onChange={() => navigateSettings("models")}
              ariaLabel="Default model"
            />
          </SettingRow>
          <SettingRow
            label="Model fallback"
            description="Use another model when the default is unavailable."
          >
            <Toggle
              checked={prefs.models.fallbackWhenUnavailable}
              onChange={(fallbackWhenUnavailable) =>
                patchPrefs("models", { fallbackWhenUnavailable })
              }
              label="Model fallback"
            />
          </SettingRow>
          <SettingRow
            label="Prefer local model"
            description="Favor on-device models when available."
          >
            <Toggle
              checked={prefs.models.preferLocalPrivate}
              onChange={(preferLocalPrivate) =>
                patchPrefs("models", { preferLocalPrivate })
              }
              label="Prefer local model"
            />
          </SettingRow>
          <div className="settings-card-footer">
            <button
              type="button"
              className="settings-card-link"
              onClick={() => navigateSettings("models")}
            >
              Open Models →
            </button>
          </div>
        </SettingsCard>

        <SettingsCard
          title="Notifications"
          description="Manage how and when you’re notified."
        >
          <SettingRow
            label="General notifications"
            description="Desktop and in-app alerts."
          >
            <Toggle
              checked={prefs.notifications.desktop}
              onChange={(desktop) => patchPrefs("notifications", { desktop })}
              label="General notifications"
            />
          </SettingRow>
          <SettingRow
            label="Task & agent notifications"
            description="Progress and completion alerts."
          >
            <Toggle
              checked={
                prefs.notifications.categories["task-completed"] &&
                prefs.notifications.categories["agent-completed"]
              }
              onChange={(enabled) => {
                patchPrefs("notifications", {
                  categories: {
                    ...prefs.notifications.categories,
                    "task-completed": enabled,
                    "task-overdue": enabled,
                    "agent-completed": enabled,
                    "agent-failed": enabled,
                  },
                });
              }}
              label="Task and agent notifications"
            />
          </SettingRow>
          <div className="settings-card-footer">
            <button
              type="button"
              className="settings-card-link"
              onClick={() => navigateSettings("notifications")}
            >
              Manage notifications →
            </button>
          </div>
        </SettingsCard>

        <SettingsCard
          title="Data & Privacy"
          description="Control your data and privacy settings."
        >
          <SettingRow
            label="Usage analytics"
            description="Optional diagnostics. Off unless you opt in."
          >
            <Toggle
              checked={prefs.dataPrivacy.diagnostics}
              onChange={(diagnostics) =>
                patchPrefs("dataPrivacy", { diagnostics })
              }
              label="Usage analytics"
            />
          </SettingRow>
          <SettingRow
            label="Conversation history"
            description="Command and activity history on this device."
          >
            <button
              type="button"
              className="btn btn-small"
              onClick={() => navigateSettings("data-privacy")}
            >
              Manage ↗
            </button>
          </SettingRow>
          <SettingRow
            label="Store voice transcripts"
            description="Keep transcripts after processing."
          >
            <Toggle
              checked={prefs.dataPrivacy.storeTranscripts}
              onChange={(storeTranscripts) =>
                patchPrefs("dataPrivacy", { storeTranscripts })
              }
              label="Store voice transcripts"
            />
          </SettingRow>
          <div className="settings-card-footer">
            <button
              type="button"
              className="settings-card-link"
              onClick={() => navigateSettings("data-privacy")}
            >
              Open Data & Privacy →
            </button>
          </div>
        </SettingsCard>
      </div>

      {managing ? (
        <div className="account-manage-panel">
          <SettingsCard
            title="Manage local profile"
            description="Edit the local profile stored on this device."
            footer={
              <div className="card-actions">
                <button type="button" className="btn" onClick={() => setManaging(false)}>
                  Done
                </button>
                <button type="button" className="btn" onClick={onSaveProfile}>
                  Save changes
                </button>
                <SettingsStatus message={saved} tone="success" />
              </div>
            }
          >
            <label className="settings-field">
              <span>Full name</span>
              <input
                value={profile.fullName}
                onChange={(e) => updateProfile("fullName", e.target.value)}
              />
            </label>
            <label className="settings-field">
              <span>Display name</span>
              <input
                value={profile.displayName}
                onChange={(e) => updateProfile("displayName", e.target.value)}
              />
            </label>
            <label className="settings-field">
              <span>Email address</span>
              <input
                type="email"
                value={profile.email}
                onChange={(e) => updateProfile("email", e.target.value)}
                placeholder="Optional"
              />
            </label>
            <label className="settings-field">
              <span>Time zone</span>
              <input
                value={profile.timeZone}
                onChange={(e) => updateProfile("timeZone", e.target.value)}
              />
            </label>
            <label className="settings-field">
              <span>Preferred language</span>
              <input
                value={profile.language}
                onChange={(e) => updateProfile("language", e.target.value)}
              />
            </label>
            <SettingRow label="Account status" description="Cloud accounts are not available yet.">
              <span className="badge-muted">Local only</span>
            </SettingRow>
            <div className="card-actions" style={{ marginTop: 12 }}>
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
                <button
                  type="button"
                  className="text-action"
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete local profile data
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => {
                      clearAccountProfile();
                      setProfile(loadAccountProfile());
                      setConfirmDelete(false);
                      setManaging(false);
                    }}
                  >
                    Confirm delete
                  </button>
                  <button
                    type="button"
                    className="text-action"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
          </SettingsCard>
        </div>
      ) : null}
    </div>
  );
}
