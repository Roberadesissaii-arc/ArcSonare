import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SettingsPageHeader } from "../../components/settings/SettingsPageHeader";
import { modelById } from "../../config/modelRegistry";
import type { VoiceActivationMode } from "../../config/prefs";
import { AiKeysCard } from "../../features/voice-settings/AiKeysCard";
import { CustomizeOverlayDrawer } from "../../features/voice-settings/CustomizeOverlayDrawer";
import { InputDeviceCard } from "../../features/voice-settings/InputDeviceCard";
import { ListeningBehaviorCard } from "../../features/voice-settings/ListeningBehaviorCard";
import { LiveAssistantPreviewCard } from "../../features/voice-settings/LiveAssistantPreviewCard";
import { ManageVoicesDrawer } from "../../features/voice-settings/ManageVoicesDrawer";
import { OutputDeviceCard } from "../../features/voice-settings/OutputDeviceCard";
import { VoiceCharactersCard } from "../../features/voice-settings/VoiceCharactersCard";
import { VoiceModeCard } from "../../features/voice-settings/VoiceModeCard";
import { VoicePreviewCard } from "../../features/voice-settings/VoicePreviewCard";
import { characterById } from "../../features/voice-settings/voiceCharacters";
import { wakeWordService } from "../../features/voice/WakeWordService";
import {
  listAudioDevices,
  microphonePermission,
  startLevelMeter,
  type AudioDevice,
  type LevelMeterHandle,
  type MicPermission,
} from "../../services/DeviceService";
import { playOutputTestTone } from "../../services/SoundService";
import { patchPrefs, usePrefs } from "../../stores/settingsStore";

export function VoiceSettingsPage() {
  const prefs = usePrefs();
  const voice = prefs.voice;

  const [inputs, setInputs] = useState<AudioDevice[]>([]);
  const [outputs, setOutputs] = useState<AudioDevice[]>([]);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [permission, setPermission] = useState<MicPermission>("unknown");
  const [level, setLevel] = useState<number | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [tonePlaying, setTonePlaying] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const meterRef = useRef<LevelMeterHandle | null>(null);
  const toneTimerRef = useRef<number | null>(null);

  const set = (patch: Partial<typeof voice>) => patchPrefs("voice", patch);

  const speechModel = modelById(prefs.models.roles.speech);
  // Previews always offer play; the speech backend boots on demand.
  const speechConfigured = true;
  const backgroundFilterAvailable = Boolean(
    prefs.models.roles.transcription ||
      (speechModel?.supportsAudioOutput && prefs.models.roles.speech),
  );
  const wakeWordReady = wakeWordService.status() === "ready";

  const character = useMemo(
    () => characterById(voice.voiceId || "sonare"),
    [voice.voiceId],
  );

  const refreshDevices = useCallback(
    (requestPermission = false) => {
      setDeviceError(null);
      listAudioDevices({ requestPermission })
        .then((list) => {
          setInputs(list.inputs);
          setOutputs(list.outputs);
          const prefsNow = prefs.voice;
          if (
            prefsNow.inputDeviceId &&
            prefsNow.inputDeviceId !== "default" &&
            list.inputs.length &&
            !list.inputs.some((d) => d.deviceId === prefsNow.inputDeviceId)
          ) {
            patchPrefs("voice", {
              inputDeviceId: list.inputs[0]?.deviceId || "default",
            });
          }
          if (
            prefsNow.outputDeviceId &&
            prefsNow.outputDeviceId !== "default" &&
            list.outputs.length &&
            !list.outputs.some((d) => d.deviceId === prefsNow.outputDeviceId)
          ) {
            patchPrefs("voice", {
              outputDeviceId: list.outputs[0]?.deviceId || "default",
            });
          }
        })
        .catch((err) =>
          setDeviceError(err instanceof Error ? err.message : String(err)),
        );
      microphonePermission().then(setPermission).catch(() => undefined);
    },
    [prefs.voice],
  );

  useEffect(() => {
    refreshDevices(false);
  }, [refreshDevices]);

  useEffect(
    () => () => {
      meterRef.current?.stop();
      if (toneTimerRef.current) window.clearTimeout(toneTimerRef.current);
    },
    [],
  );

  const stopMicTest = () => {
    meterRef.current?.stop();
    meterRef.current = null;
    setLevel(null);
  };

  const startMicTest = async () => {
    setMicError(null);
    try {
      meterRef.current = await startLevelMeter(
        voice.inputDeviceId,
        {
          noiseSuppression: voice.noiseSuppression,
          echoCancellation: voice.echoCancellation,
          autoGainControl: voice.autoGainControl,
        },
        setLevel,
      );
      refreshDevices(false);
    } catch (err) {
      setMicError(
        err instanceof Error ? err.message : "The microphone could not be opened.",
      );
      setLevel(null);
    }
  };

  const playTone = () => {
    if (tonePlaying) {
      setTonePlaying(false);
      if (toneTimerRef.current) window.clearTimeout(toneTimerRef.current);
      return;
    }
    setTonePlaying(true);
    playOutputTestTone(voice.outputVolume);
    toneTimerRef.current = window.setTimeout(() => setTonePlaying(false), 900);
  };

  const openWindowsMicSettings = () => {
    invoke("open_microphone_privacy_settings").catch((err) =>
      console.error("[ArcSonare] could not open Windows settings:", err),
    );
  };

  return (
    <div className="page voice-settings-page">
      <SettingsPageHeader
        title="Voice & AI keys"
        description="OpenAI Realtime for the voice overlay. DeepSeek for dashboard chat. Then mic, speakers, and voice character."
      />

      <AiKeysCard />

      <div className="voice-settings-grid">
        {/* Row 1 — matched heights */}
        <div className="voice-grid-cell voice-grid-preview">
          <LiveAssistantPreviewCard
            onCustomize={() => setCustomizeOpen(true)}
            marbleTint={character.marbleTint}
          />
        </div>
        <div className="voice-grid-cell voice-grid-characters">
          <VoiceCharactersCard
            selectedId={character.id}
            onSelect={(voiceId) => set({ voiceId })}
            onManage={() => setManageOpen(true)}
          />
        </div>

        {/* Row 2 — Output stretches to Input + Listening */}
        <div className="voice-grid-cell voice-grid-input-stack">
          <InputDeviceCard
            devices={inputs}
            value={voice.inputDeviceId}
            onChange={(inputDeviceId) => set({ inputDeviceId })}
            onRefresh={() => refreshDevices(true)}
            level={level}
            permission={permission}
            testing={level !== null}
            error={micError}
            deviceError={deviceError}
            onToggleTest={() => (level !== null ? stopMicTest() : void startMicTest())}
            onOpenWindows={openWindowsMicSettings}
          />
          <ListeningBehaviorCard
            noiseSuppression={voice.noiseSuppression}
            echoCancellation={voice.echoCancellation}
            autoGainControl={voice.autoGainControl}
            backgroundFilter={voice.backgroundFilter}
            backgroundFilterAvailable={backgroundFilterAvailable}
            onChange={set}
          />
        </div>
        <div className="voice-grid-cell voice-grid-output">
          <OutputDeviceCard
            devices={outputs}
            value={voice.outputDeviceId}
            onChange={(outputDeviceId) => set({ outputDeviceId })}
            onRefresh={() => refreshDevices(true)}
            volume={voice.outputVolume}
            onVolume={(outputVolume) => set({ outputVolume })}
            tonePlaying={tonePlaying}
            onToggleTone={playTone}
            muteResponses={voice.muteResponses}
            duckOtherAudio={voice.duckOtherAudio}
            stopOnInterrupt={voice.stopOnInterrupt}
            systemOutputFallback={voice.systemOutputFallback}
            onToggle={set}
          />
        </div>

        {/* Row 3 — matched heights */}
        <div className="voice-grid-cell voice-grid-mode">
          <VoiceModeCard
            value={voice.activationMode}
            onChange={(activationMode: VoiceActivationMode) => set({ activationMode })}
            wakeWordReady={wakeWordReady}
            onConfigureWakeWord={() => setManageOpen(true)}
          />
        </div>
        <div className="voice-grid-cell voice-grid-speak">
          <VoicePreviewCard
            character={character}
            speechConfigured={speechConfigured}
          />
        </div>
      </div>

      {manageOpen ? (
        <ManageVoicesDrawer
          selectedId={character.id}
          speakingSpeed={voice.speakingSpeed}
          pitch={voice.pitch}
          expressiveness={voice.expressiveness}
          onSelect={(voiceId) => set({ voiceId })}
          onSpeed={(speakingSpeed) => set({ speakingSpeed })}
          onPitch={(pitch) => set({ pitch })}
          onExpressiveness={(expressiveness) => set({ expressiveness })}
          onClose={() => setManageOpen(false)}
          speechConfigured={speechConfigured}
        />
      ) : null}

      {customizeOpen ? (
        <CustomizeOverlayDrawer onClose={() => setCustomizeOpen(false)} />
      ) : null}
    </div>
  );
}
