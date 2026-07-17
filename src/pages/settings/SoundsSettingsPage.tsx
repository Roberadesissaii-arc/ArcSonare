import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { SettingsPageHeader } from "../../components/settings/SettingsPageHeader";
import {
  DEFAULT_PREFS,
  type SoundEvent,
} from "../../config/prefs";
import { listAudioDevices } from "../../services/DeviceService";
import {
  getSoundPlaybackState,
  playEventSound,
  previewAllSounds,
  stopAllSounds,
  stopPreview,
  subscribeSoundPlayback,
} from "../../services/SoundService";
import { patchPrefs, updatePrefs, usePrefs } from "../../stores/settingsStore";
import { EventSoundsCard } from "../../features/sounds/EventSoundsCard";
import { MasterSoundCard } from "../../features/sounds/MasterSoundCard";
import { QuietHoursCard } from "../../features/sounds/QuietHoursCard";
import { SoundProfileCard } from "../../features/sounds/SoundProfileCard";

function useSoundPlayback() {
  return useSyncExternalStore(subscribeSoundPlayback, getSoundPlaybackState, getSoundPlaybackState);
}

export function SoundsSettingsPage() {
  const prefs = usePrefs();
  const sounds = prefs.sounds;
  const quietHours = prefs.notifications.quietHours;
  const playback = useSoundPlayback();
  const [outputs, setOutputs] = useState<{ id: string; label: string }[]>([]);

  useEffect(() => {
    listAudioDevices()
      .then((list) =>
        setOutputs(
          list.outputs.map((d) => ({
            id: d.deviceId,
            label: d.label || "Output device",
          })),
        ),
      )
      .catch(() => setOutputs([]));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stopPreview();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      stopAllSounds();
    };
  }, []);

  const setSounds = (patch: Partial<typeof sounds>) => {
    if (patch.enabled === false) stopAllSounds();
    patchPrefs("sounds", patch);
  };

  const setEvent = (id: SoundEvent, patch: Partial<{ enabled: boolean; volume: number }>) =>
    updatePrefs((p) => ({
      ...p,
      sounds: {
        ...p.sounds,
        events: {
          ...p.sounds.events,
          [id]: { ...p.sounds.events[id], ...patch },
        },
      },
    }));

  const setQuiet = (patch: Partial<typeof quietHours>) =>
    updatePrefs((p) => ({
      ...p,
      notifications: {
        ...p.notifications,
        quietHours: { ...p.notifications.quietHours, ...patch },
      },
    }));

  const outputOptions = useMemo(() => {
    const base = [
      { value: "system-default", label: "Default output" },
      { value: "follow-voice-output", label: "Follow Voice output" },
    ];
    for (const d of outputs) {
      if (!d.id || d.id === "default") continue;
      base.push({ value: `device:${d.id}`, label: d.label });
    }
    return base;
  }, [outputs]);

  const resetDefaults = () => {
    const ok = window.confirm(
      "Reset sound settings?\n\nThis restores master volume, sound profile, event toggles, event volumes, and output behavior.\n\nVoice and Notification settings are not changed.",
    );
    if (!ok) return;
    stopAllSounds();
    updatePrefs((p) => ({ ...p, sounds: { ...DEFAULT_PREFS.sounds } }));
  };

  const handlePreview = (id: SoundEvent) => {
    if (playback.currentlyPreviewing === id && !playback.previewAllActive) {
      stopPreview();
      return;
    }
    stopPreview();
    playEventSound(id, { preview: true });
  };

  return (
    <div className="sounds-settings-page page">
      <SettingsPageHeader
        title="Sounds"
        description="Restrained interface sounds, generated locally — nothing is bundled or downloaded."
      />

      <div className="sounds-page-grid">
        <MasterSoundCard
          sounds={sounds}
          previewAllActive={playback.previewAllActive}
          onChange={setSounds}
          onPreviewAll={previewAllSounds}
          onReset={resetDefaults}
        />
        <SoundProfileCard
          sounds={sounds}
          amplitude={playback.amplitude}
          previewing={playback.currentlyPreviewing != null || playback.previewAllActive}
          outputOptions={outputOptions}
          onChange={setSounds}
        />
        <EventSoundsCard
          masterEnabled={sounds.enabled}
          events={sounds.events}
          currentlyPreviewing={playback.currentlyPreviewing}
          onToggle={(id, enabled) => setEvent(id, { enabled })}
          onVolume={(id, volume) => setEvent(id, { volume })}
          onPreview={handlePreview}
        />
        <QuietHoursCard quietHours={quietHours} onChange={setQuiet} />
      </div>
    </div>
  );
}
